/**
 * Seed the kartslalom database from the txt files in `data/`.
 *
 * Idempotent: re-running will leave the data in the same final state because
 * we use ON CONFLICT upserts on natural keys (team name, driver name+team,
 * race number, race entry event+driver).
 *
 * Run:  cd webapp && npm run db:seed
 *       (or `make seed-db` from the project root)
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

import * as schema from "../src/db/schema";
import {
  parseDrivers,
  parseTeams,
  readDataFile,
  resolveDataDir,
} from "./lib/parse-data";

const __filename = fileURLToPath(import.meta.url);
const DATA_DIR = resolveDataDir(__filename);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("ENV ERROR - DATABASE_URL is missing");

const db = drizzle(databaseUrl, { schema });

/* ────────────────────────── parsing helpers ──────────────────────────── */

const AGE_CLASS_NAMES = [
  "Altersklasse I",
  "Altersklasse II",
  "Altersklasse III",
  "Altersklasse IV",
  "Altersklasse V",
  "Altersklasse VI",
  "Altersklasse VII",
];

const SUPPORTED_AGE_CLASSES = new Set([
  "Altersklasse I",
  "Altersklasse II",
  "Altersklasse III",
  "Altersklasse IV",
  "Altersklasse V",
  "Altersklasse VI",
  "Altersklasse VII",
]);

interface ParsedEvent {
  number: number;
  date: string; // ISO yyyy-mm-dd
  teamName: string;
  isHmj: boolean;
  kartType: "electric" | "gasoline";
}

function parseEvents(): ParsedEvent[] {
  const lines = readDataFile(DATA_DIR, "race-events.txt");
  const re =
    /^(\d{2})\.(\d{2})\.(\d{4})\s*-\s*Race\s*#(\d+):\s*([^()]+?)\s*(?:\(([^)]+)\))?$/i;
  const out: ParsedEvent[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) {
      console.warn(`  skip event line: ${line}`);
      continue;
    }
    const [, dd, mm, yyyy, num, team, parens] = m;
    const flags = (parens ?? "").toLowerCase();
    out.push({
      number: Number(num),
      date: `${yyyy}-${mm}-${dd}`,
      teamName: team.trim(),
      isHmj: flags.includes("hmj"),
      kartType: flags.includes("electric") ? "electric" : "gasoline",
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

function parsePoints(): { place: number; points: number }[] {
  return readDataFile(DATA_DIR, "championship-points.txt").map((line) => {
    const [place, points] = line.split(":").map((s) => s.trim());
    return { place: Number(place), points: Number(points) };
  });
}

/* ────────────────────────────── seed ────────────────────────────────── */

async function seed() {
  console.log("Parsing data files…");
  const events = parseEvents();
  const teamsList = parseTeams(DATA_DIR);
  const points = parsePoints();
  const drivers = parseDrivers(DATA_DIR);
  console.log(
    `  events=${events.length}, teams=${teamsList.length}, points=${points.length}, drivers=${drivers.length}`,
  );

  // 1. Age classes
  console.log("Seeding age classes…");
  for (let i = 0; i < AGE_CLASS_NAMES.length; i++) {
    await db
      .insert(schema.ageClasses)
      .values({ name: AGE_CLASS_NAMES[i], sortOrder: i + 1 })
      .onConflictDoNothing();
  }

  // 2. Teams (incl. host teams from events and driver teams)
  const teamSet = new Set<string>(teamsList);
  for (const e of events) teamSet.add(e.teamName);
  for (const d of drivers) teamSet.add(d.teamName);
  console.log(`Seeding ${teamSet.size} teams…`);
  for (const name of teamSet) {
    await db.insert(schema.teams).values({ name }).onConflictDoNothing();
  }

  // 3. Points scale
  console.log("Seeding points scale…");
  for (const p of points) {
    await db
      .insert(schema.pointsScale)
      .values(p)
      .onConflictDoUpdate({
        target: schema.pointsScale.place,
        set: { points: p.points },
      });
  }

  // 4. Race events
  console.log("Seeding race events…");
  const dbTeams = await db.select().from(schema.teams);
  const teamIdByName = new Map(dbTeams.map((t) => [t.name, t.id] as const));

  for (const e of events) {
    const hostTeamId = teamIdByName.get(e.teamName);
    if (!hostTeamId) {
      console.warn(`  team not found for event #${e.number}: ${e.teamName}`);
      continue;
    }
    const status = e.number <= 6 ? "completed" : "upcoming";
    await db
      .insert(schema.raceEvents)
      .values({
        number: e.number,
        eventDate: e.date,
        name: `#${e.number} ${e.teamName}`,
        hostTeamId,
        isHmj: e.isHmj,
        kartType: e.kartType,
        status,
      })
      .onConflictDoUpdate({
        target: schema.raceEvents.number,
        set: {
          eventDate: e.date,
          name: `#${e.number} ${e.teamName}`,
          hostTeamId,
          isHmj: e.isHmj,
          kartType: e.kartType,
          status,
        },
      });
  }

  // 5. Drivers (only Altersklasse I–III as per plan)
  const dbAgeClasses = await db.select().from(schema.ageClasses);
  const ageClassIdByName = new Map(
    dbAgeClasses.map((c) => [c.name, c.id] as const),
  );

  const supportedDrivers = drivers.filter((d) =>
    SUPPORTED_AGE_CLASSES.has(d.ageClass),
  );
  console.log(`Seeding ${supportedDrivers.length} championship drivers…`);

  for (const d of supportedDrivers) {
    const teamId = teamIdByName.get(d.teamName);
    const ageClassId = ageClassIdByName.get(d.ageClass);
    if (!teamId || !ageClassId) {
      console.warn(`  driver missing team/age class: ${d.firstName} ${d.lastName}`);
      continue;
    }
    await db
      .insert(schema.drivers)
      .values({
        firstName: d.firstName,
        lastName: d.lastName,
        teamId,
        ageClassId,
        driverType: "championship",
      })
      .onConflictDoNothing();
  }

  // 6. Race entries for races 1–6 with finish position + computed points
  console.log("Seeding race entries for races 1–6 (with stored points)…");
  const dbDrivers = await db.select().from(schema.drivers);
  const driverByKey = new Map(
    dbDrivers.map(
      (d) => [`${d.firstName}|${d.lastName}|${d.teamId}`, d] as const,
    ),
  );
  const dbEvents = await db
    .select()
    .from(schema.raceEvents)
    .orderBy(schema.raceEvents.number);
  const eventByNumber = new Map(dbEvents.map((e) => [e.number, e] as const));
  const pointsByPlace = new Map(points.map((p) => [p.place, p.points] as const));

  for (const d of supportedDrivers) {
    const teamId = teamIdByName.get(d.teamName);
    const ageClassId = ageClassIdByName.get(d.ageClass);
    if (!teamId || !ageClassId) continue;
    const driver = driverByKey.get(`${d.firstName}|${d.lastName}|${teamId}`);
    if (!driver) continue;

    for (let i = 0; i < 6; i++) {
      const raceNumber = i + 1;
      const event = eventByNumber.get(raceNumber);
      if (!event) continue;
      const place = d.positions[i] ?? 0;
      const participated = place > 0;
      const points = participated ? (pointsByPlace.get(place) ?? 0) : 0;

      await db
        .insert(schema.raceEntries)
        .values({
          raceEventId: event.id,
          driverId: driver.id,
          ageClassId,
          startingOrder: null,
          finishPosition: participated ? place : null,
          pointsAwarded: points,
        })
        .onConflictDoUpdate({
          target: [
            schema.raceEntries.raceEventId,
            schema.raceEntries.driverId,
          ],
          set: {
            finishPosition: participated ? place : null,
            pointsAwarded: points,
            ageClassId,
          },
        });
    }
  }

  // 7. Race entries for upcoming races 7–8 (championship drivers, no positions)
  console.log("Seeding race entries for races 7–8 (empty, ready for live)…");
  for (const d of supportedDrivers) {
    const teamId = teamIdByName.get(d.teamName);
    const ageClassId = ageClassIdByName.get(d.ageClass);
    if (!teamId || !ageClassId) continue;
    const driver = driverByKey.get(`${d.firstName}|${d.lastName}|${teamId}`);
    if (!driver) continue;

    for (let raceNumber = 7; raceNumber <= 8; raceNumber++) {
      const event = eventByNumber.get(raceNumber);
      if (!event) continue;
      await db
        .insert(schema.raceEntries)
        .values({
          raceEventId: event.id,
          driverId: driver.id,
          ageClassId,
          startingOrder: null,
          finishPosition: null,
          pointsAwarded: 0,
        })
        .onConflictDoNothing();
    }
  }

  // 8. Mark age classes in completed events (races 1–6) as finalized
  console.log("Seeding age-class finalizations for races 1–6…");
  for (let raceNumber = 1; raceNumber <= 6; raceNumber++) {
    const event = eventByNumber.get(raceNumber);
    if (!event) continue;
    for (const ageClassId of ageClassIdByName.values()) {
      await db
        .insert(schema.eventAgeClassFinalizations)
        .values({ raceEventId: event.id, ageClassId })
        .onConflictDoNothing();
    }
  }

  // Sanity print
  const counts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM teams) AS teams,
      (SELECT COUNT(*) FROM age_classes) AS age_classes,
      (SELECT COUNT(*) FROM drivers) AS drivers,
      (SELECT COUNT(*) FROM race_events) AS race_events,
      (SELECT COUNT(*) FROM race_entries) AS race_entries,
      (SELECT COUNT(*) FROM points_scale) AS points_scale
  `);
  console.log("Done.", counts.rows[0]);

  // Drizzle's pg client keeps the pool open; force exit.
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
