import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  ageClasses,
  drivers,
  raceEntries,
  raceEvents,
  runs,
  teams,
} from "@/db/schema";
import { parseCsv } from "@/lib/csv";

interface ImportRow {
  race_event: string; // either race number ("6") or full name ("#6 MSC Affolterbach")
  event_date: string; // optional, ignored if event matched
  age_class: string; // "Altersklasse I"
  driver_name: string; // "Glatter Jonas" or "Lastname Firstname"
  team: string;
  test_time: string;
  test_penalty: string;
  run1_time: string;
  run1_penalty: string;
  run2_time: string;
  run2_penalty: string;
}

interface ImportError {
  row: number;
  reason: string;
  raw?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const csvText = await req.text();
  if (!csvText.trim()) {
    return NextResponse.json({ error: "empty_body" }, { status: 400 });
  }

  const { headers, rows } = parseCsv(csvText);
  const required = [
    "race_event",
    "age_class",
    "driver_name",
    "team",
    "run1_time",
    "run2_time",
  ];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "missing_columns", missing, headers },
      { status: 400 },
    );
  }

  const allEvents = await db.select().from(raceEvents);
  const eventByNumber = new Map(allEvents.map((e) => [e.number, e] as const));
  const eventByName = new Map(allEvents.map((e) => [e.name, e] as const));

  const allTeams = await db.select().from(teams);
  const teamByName = new Map(allTeams.map((t) => [t.name, t] as const));

  const allClasses = await db.select().from(ageClasses);
  const classByName = new Map(allClasses.map((c) => [c.name, c] as const));

  const allDrivers = await db.select().from(drivers);
  const driverByKey = new Map<string, (typeof allDrivers)[number]>();
  for (const d of allDrivers) {
    driverByKey.set(`${d.firstName}|${d.lastName}|${d.teamId}`, d);
  }

  const errors: ImportError[] = [];
  let upserted = 0;
  let runsWritten = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as unknown as ImportRow;
    const lineNo = i + 2;

    const eventRef = (r.race_event ?? "").trim();
    const event = matchEvent(eventRef, eventByNumber, eventByName);
    if (!event) {
      errors.push({ row: lineNo, reason: `event not found: ${eventRef}` });
      continue;
    }

    const team = teamByName.get((r.team ?? "").trim());
    if (!team) {
      errors.push({ row: lineNo, reason: `team not found: ${r.team}` });
      continue;
    }

    const ageClass = classByName.get((r.age_class ?? "").trim());
    if (!ageClass) {
      errors.push({
        row: lineNo,
        reason: `age class not found: ${r.age_class}`,
      });
      continue;
    }

    const { firstName, lastName } = parseDriverName(r.driver_name ?? "");
    if (!firstName || !lastName) {
      errors.push({ row: lineNo, reason: `driver name invalid: ${r.driver_name}` });
      continue;
    }

    const driverKey = `${firstName}|${lastName}|${team.id}`;
    const driver = driverByKey.get(driverKey);
    if (!driver) {
      errors.push({
        row: lineNo,
        reason: `driver not found: ${lastName} ${firstName} (${team.name})`,
      });
      continue;
    }

    // Upsert race entry
    const [entry] = await db
      .insert(raceEntries)
      .values({
        raceEventId: event.id,
        driverId: driver.id,
        ageClassId: ageClass.id,
      })
      .onConflictDoUpdate({
        target: [raceEntries.raceEventId, raceEntries.driverId],
        set: { ageClassId: ageClass.id },
      })
      .returning();

    upserted++;

    runsWritten += await upsertRun(entry.id, "test", r.test_time, r.test_penalty);
    runsWritten += await upsertRun(entry.id, "first", r.run1_time, r.run1_penalty);
    runsWritten += await upsertRun(entry.id, "second", r.run2_time, r.run2_penalty);
  }

  return NextResponse.json({
    ok: true,
    rowsParsed: rows.length,
    entriesUpserted: upserted,
    runsWritten,
    errors,
  });
}

function matchEvent(
  ref: string,
  byNumber: Map<number, { id: number; number: number; name: string }>,
  byName: Map<string, { id: number; number: number; name: string }>,
) {
  if (!ref) return null;
  const n = Number(ref.replace(/^#/, ""));
  if (Number.isFinite(n) && byNumber.has(n)) return byNumber.get(n);
  if (byName.has(ref)) return byName.get(ref);
  for (const [name, ev] of byName) {
    if (name.endsWith(ref)) return ev;
  }
  return null;
}

function parseDriverName(s: string) {
  const trimmed = s.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return { firstName: "", lastName: "" };
  const lastName = parts.shift() ?? "";
  const firstName = parts.join(" ");
  return { firstName, lastName };
}

async function upsertRun(
  entryId: number,
  runType: "test" | "first" | "second",
  timeRaw: string | undefined,
  penaltyRaw: string | undefined,
): Promise<number> {
  const timeStr = (timeRaw ?? "").trim().replace(",", ".");
  const time = timeStr === "" ? null : Number(timeStr);
  if (time !== null && !Number.isFinite(time)) return 0;

  const penalty = (penaltyRaw ?? "").trim() === ""
    ? 0
    : Number((penaltyRaw ?? "").trim());
  if (!Number.isFinite(penalty) || penalty < 0) return 0;

  if (time === null && penalty === 0) {
    await db
      .delete(runs)
      .where(and(eq(runs.raceEntryId, entryId), eq(runs.runType, runType)));
    return 0;
  }

  await db
    .insert(runs)
    .values({
      raceEntryId: entryId,
      runType,
      timeSeconds: time === null ? null : String(time),
      penaltySeconds: penalty,
    })
    .onConflictDoUpdate({
      target: [runs.raceEntryId, runs.runType],
      set: {
        timeSeconds: time === null ? null : String(time),
        penaltySeconds: penalty,
        updatedAt: new Date(),
      },
    });
  return 1;
}
