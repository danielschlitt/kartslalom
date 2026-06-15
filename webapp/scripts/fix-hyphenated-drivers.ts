/**
 * Repair corrupted driver/team rows in the database:
 *
 *   1. Hyphenated driver names — legacy seed split on every `-` instead of `" - "`,
 *      creating bogus teams like `Leon - MSC Rodenstein`.
 *   2. Known team-name typos (e.g. `Scuderia Wiebaden` → `Scuderia Wiesbaden`).
 *   3. Orphan teams not listed in `data/race-teams.txt`.
 *
 * Unlike a name-exact match, step 1 moves **every** driver still sitting on a bogus
 * team onto the correct driver row derived from `race-drivers.txt`, even when the
 * stored first/last name no longer matches the legacy prediction.
 *
 * Safe to re-run.
 *
 * Run:  cd webapp && npm run db:fix-names
 *       (or `make fix-names` / `make server-db-fix-names` on production)
 *
 * After updating this script or `data/`, redeploy (`make deploy`) so the container
 * ships the latest files before running `make server-db-fix-names`.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { fileURLToPath } from "node:url";

import * as schema from "../src/db/schema";
import {
  findLegacyCorruption,
  normalizeTeamName,
  parseTeams,
  readDataFile,
  resolveDataDir,
  type ParsedDriver,
} from "./lib/parse-data";

const __filename = fileURLToPath(import.meta.url);
const DATA_DIR = resolveDataDir(__filename);

/** Wrong team name → correct team name (merge drivers, delete wrong row). */
const TEAM_TYPO_FIXES: { wrong: string; correct: string }[] = [
  { wrong: "Scuderia Wiebaden", correct: "Scuderia Wiesbaden" },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("ENV ERROR - DATABASE_URL is missing");

const db = drizzle(databaseUrl, { schema });

function buildValidTeamNames(): Set<string> {
  const valid = new Set(parseTeams(DATA_DIR));
  const eventLines = readDataFile(DATA_DIR, "race-events.txt");
  const eventRe =
    /^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*Race\s*#\d+:\s*([^()]+?)\s*(?:\([^)]*\))?$/i;
  for (const line of eventLines) {
    const m = eventRe.exec(line);
    if (m) valid.add(normalizeTeamName(m[4]));
  }
  for (const fix of TEAM_TYPO_FIXES) {
    valid.add(normalizeTeamName(fix.correct));
  }
  return valid;
}

function isValidTeamName(name: string, validNames: Set<string>): boolean {
  return validNames.has(normalizeTeamName(name));
}

async function loadAllTeams() {
  return db.select().from(schema.teams);
}

async function findTeamByName(name: string, teams?: Awaited<ReturnType<typeof loadAllTeams>>) {
  const all = teams ?? (await loadAllTeams());
  const normalized = normalizeTeamName(name);
  return (
    all.find(
      (t) => t.name === name || normalizeTeamName(t.name) === normalized,
    ) ?? null
  );
}

async function ensureTeam(name: string) {
  const existing = await findTeamByName(name);
  if (existing) return existing;
  const [inserted] = await db
    .insert(schema.teams)
    .values({ name })
    .returning();
  return inserted;
}

async function driversOnTeam(teamId: number) {
  return db
    .select()
    .from(schema.drivers)
    .where(eq(schema.drivers.teamId, teamId));
}

async function findDriver(
  firstName: string,
  lastName: string,
  teamId: number,
) {
  const rows = await db
    .select()
    .from(schema.drivers)
    .where(
      and(
        eq(schema.drivers.firstName, firstName),
        eq(schema.drivers.lastName, lastName),
        eq(schema.drivers.teamId, teamId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function hostTeamIds(): Promise<Set<number>> {
  const hostRows = await db
    .select({ hostTeamId: schema.raceEvents.hostTeamId })
    .from(schema.raceEvents);
  return new Set(hostRows.map((r) => r.hostTeamId));
}

async function mergeOrRewriteDriver(
  bogusDriverId: number,
  correctFirstName: string,
  correctLastName: string,
  correctTeamId: number,
) {
  const correctDriver = await findDriver(
    correctFirstName,
    correctLastName,
    correctTeamId,
  );

  if (correctDriver && correctDriver.id !== bogusDriverId) {
    console.log(
      `[merge] ${correctLastName} ${correctFirstName}: ` +
        `entries from driver #${bogusDriverId} → driver #${correctDriver.id}`,
    );
    await db.transaction(async (tx) => {
      await tx
        .update(schema.raceEntries)
        .set({ driverId: correctDriver.id })
        .where(eq(schema.raceEntries.driverId, bogusDriverId));
      await tx
        .delete(schema.drivers)
        .where(eq(schema.drivers.id, bogusDriverId));
    });
    return correctDriver.id;
  }

  console.log(
    `[rewrite] driver #${bogusDriverId} → ` +
      `${correctLastName} ${correctFirstName} (team #${correctTeamId})`,
  );
  await db
    .update(schema.drivers)
    .set({
      firstName: correctFirstName,
      lastName: correctLastName,
      teamId: correctTeamId,
    })
    .where(eq(schema.drivers.id, bogusDriverId));
  return bogusDriverId;
}

async function deleteTeamIfUnused(teamId: number, teamName: string) {
  const remainingDrivers = await db
    .select({ id: schema.drivers.id })
    .from(schema.drivers)
    .where(eq(schema.drivers.teamId, teamId))
    .limit(1);
  const hosts = await hostTeamIds();
  if (remainingDrivers.length === 0 && !hosts.has(teamId)) {
    console.log(`[delete] team "${teamName}"`);
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
    return true;
  }
  return false;
}

/** Map normalized bogus team name → correct driver from race-drivers.txt. */
function corruptionByBogusTeam(
  corruptions: ReturnType<typeof findLegacyCorruption>,
): Map<string, ParsedDriver> {
  const map = new Map<string, ParsedDriver>();
  for (const { correct, legacy } of corruptions) {
    map.set(normalizeTeamName(legacy.teamName), correct);
  }
  return map;
}

async function fixDriversOnBogusTeam(
  bogusTeam: { id: number; name: string },
  correct: ParsedDriver,
) {
  const correctTeam = await ensureTeam(correct.teamName);
  const drivers = await driversOnTeam(bogusTeam.id);
  if (drivers.length === 0) return;

  console.log(
    `[bogus-team] "${bogusTeam.name}" → ${correct.lastName} ${correct.firstName} (${correct.teamName}), ` +
      `${drivers.length} driver(s)`,
  );

  for (const driver of drivers) {
    await mergeOrRewriteDriver(
      driver.id,
      correct.firstName,
      correct.lastName,
      correctTeam.id,
    );
  }

  await deleteTeamIfUnused(bogusTeam.id, bogusTeam.name);
}

async function fixLegacyCorruptions() {
  const corruptions = findLegacyCorruption(DATA_DIR);
  const byBogusTeam = corruptionByBogusTeam(corruptions);

  console.log(
    `Legacy hyphen corruption: ${corruptions.length} mapping(s) from data file`,
  );

  // Pass 1: exact legacy driver name match (original behaviour).
  for (const { correct, legacy } of corruptions) {
    const bogusTeam = await findTeamByName(legacy.teamName);
    if (!bogusTeam) continue;

    const bogusDriver = await findDriver(
      legacy.firstName,
      legacy.lastName,
      bogusTeam.id,
    );
    if (!bogusDriver) continue;

    const correctTeam = await ensureTeam(correct.teamName);
    await mergeOrRewriteDriver(
      bogusDriver.id,
      correct.firstName,
      correct.lastName,
      correctTeam.id,
    );
    await deleteTeamIfUnused(bogusTeam.id, bogusTeam.name);
  }

  // Pass 2: any remaining driver on a known bogus team — move all of them.
  const allTeams = await loadAllTeams();
  for (const team of allTeams) {
    const correct = byBogusTeam.get(normalizeTeamName(team.name));
    if (!correct) continue;

    const remaining = await driversOnTeam(team.id);
    if (remaining.length === 0) continue;

    await fixDriversOnBogusTeam(team, correct);
  }
}

async function fixInvalidTeamsBySuffix(validNames: Set<string>) {
  const allTeams = await loadAllTeams();
  const hosts = await hostTeamIds();

  for (const team of allTeams) {
    if (hosts.has(team.id)) continue;
    if (isValidTeamName(team.name, validNames)) continue;

    // Pattern: "WrongPart - RealClub" where RealClub is a valid team name.
    const parts = team.name.split(" - ");
    if (parts.length < 2) continue;

    const suffix = normalizeTeamName(parts[parts.length - 1]);
    if (!validNames.has(suffix)) continue;

    const drivers = await driversOnTeam(team.id);
    if (drivers.length === 0) continue;

    console.log(
      `[suffix-team] "${team.name}" looks bogus (suffix "${suffix}"), ` +
        `${drivers.length} driver(s) — deleting team after moving drivers to "${suffix}"`,
    );

    const realTeam = await ensureTeam(suffix);
    for (const driver of drivers) {
      // Keep the driver's name but move to the real club so they at least
      // accumulate under the correct Verein. A later seed/fix pass can still
      // rename if needed.
      const existing = await findDriver(
        driver.firstName,
        driver.lastName,
        realTeam.id,
      );
      if (existing && existing.id !== driver.id) {
        await mergeOrRewriteDriver(
          driver.id,
          existing.firstName,
          existing.lastName,
          realTeam.id,
        );
      } else {
        console.log(
          `[move] driver #${driver.id} ${driver.lastName} ${driver.firstName} → team "${suffix}"`,
        );
        await db
          .update(schema.drivers)
          .set({ teamId: realTeam.id })
          .where(eq(schema.drivers.id, driver.id));
      }
    }

    await deleteTeamIfUnused(team.id, team.name);
  }
}

async function fixTeamTypos() {
  for (const { wrong, correct } of TEAM_TYPO_FIXES) {
    const wrongTeam = await findTeamByName(wrong);
    if (!wrongTeam) {
      console.log(`[skip] typo team "${wrong}" not found`);
      continue;
    }

    const correctTeam = await ensureTeam(correct);
    if (wrongTeam.id === correctTeam.id) continue;

    const drivers = await driversOnTeam(wrongTeam.id);
    console.log(
      `[typo] "${wrong}" → "${correct}", ${drivers.length} driver(s)`,
    );

    for (const driver of drivers) {
      await mergeOrRewriteDriver(
        driver.id,
        driver.firstName,
        driver.lastName,
        correctTeam.id,
      );
    }

    await deleteTeamIfUnused(wrongTeam.id, wrong);
  }
}

async function deleteOrphanTeams(validNames: Set<string>) {
  const allTeams = await loadAllTeams();
  const hosts = await hostTeamIds();

  for (const team of allTeams) {
    if (isValidTeamName(team.name, validNames) || hosts.has(team.id)) continue;

    const driverRows = await driversOnTeam(team.id);
    if (driverRows.length > 0) {
      console.log(
        `[keep] team "${team.name}" not in race-teams.txt but still has ${driverRows.length} driver(s)`,
      );
      continue;
    }

    console.log(`[delete] orphan team "${team.name}" (not in race-teams.txt)`);
    await db.delete(schema.teams).where(eq(schema.teams.id, team.id));
  }
}

async function main() {
  console.log("Repairing driver/team data…");

  const validNames = buildValidTeamNames();
  console.log(`  ${validNames.size} valid team name(s) from data files`);

  await fixLegacyCorruptions();
  await fixInvalidTeamsBySuffix(validNames);
  await fixTeamTypos();
  await deleteOrphanTeams(validNames);

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
