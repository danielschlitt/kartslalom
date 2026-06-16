import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  ageClasses,
  drivers,
  eventAgeClassFinalizations,
  pointsScale,
  raceEntries,
  raceEvents,
  runs,
  teams,
  type runTypeEnum,
} from "@/db/schema";

async function getAllFinalizationKeys(): Promise<Set<string>> {
  const rows = await db
    .select({
      raceEventId: eventAgeClassFinalizations.raceEventId,
      ageClassId: eventAgeClassFinalizations.ageClassId,
    })
    .from(eventAgeClassFinalizations);
  return new Set(rows.map((r) => `${r.raceEventId}|${r.ageClassId}`));
}
import {
  type EntryRuns,
  type RankableEntry,
  type DriverChampionshipInput,
  type DriverRaceResult,
  type Series,
} from "@/lib/ranking";

type RunTypeDb = (typeof runTypeEnum.enumValues)[number];

export async function getAllAgeClasses() {
  return db.select().from(ageClasses).orderBy(asc(ageClasses.sortOrder));
}

/**
 * Age classes that currently have at least one championship driver assigned.
 * Used to render the per-class championship cards on the home page so we
 * don't surface empty Altersklassen.
 */
export async function getActiveAgeClasses() {
  const rows = await db
    .selectDistinct({
      id: ageClasses.id,
      name: ageClasses.name,
      sortOrder: ageClasses.sortOrder,
    })
    .from(ageClasses)
    .innerJoin(drivers, eq(drivers.ageClassId, ageClasses.id))
    .orderBy(asc(ageClasses.sortOrder));
  return rows;
}

export async function getAllRaceEvents() {
  return db
    .select({
      id: raceEvents.id,
      number: raceEvents.number,
      name: raceEvents.name,
      eventDate: raceEvents.eventDate,
      isHmj: raceEvents.isHmj,
      kartType: raceEvents.kartType,
      status: raceEvents.status,
      liveAgeClassId: raceEvents.liveAgeClassId,
      hostTeamName: teams.name,
    })
    .from(raceEvents)
    .leftJoin(teams, eq(teams.id, raceEvents.hostTeamId))
    .orderBy(asc(raceEvents.number));
}

/** The single event with status `live`, if any. Only one may be live at a time. */
export async function getLiveEvent() {
  const rows = await db
    .select({
      id: raceEvents.id,
      number: raceEvents.number,
      name: raceEvents.name,
      eventDate: raceEvents.eventDate,
      isHmj: raceEvents.isHmj,
      kartType: raceEvents.kartType,
      status: raceEvents.status,
      liveAgeClassId: raceEvents.liveAgeClassId,
      hostTeamName: teams.name,
    })
    .from(raceEvents)
    .leftJoin(teams, eq(teams.id, raceEvents.hostTeamId))
    .where(eq(raceEvents.status, "live"))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRaceEvent(eventId: number) {
  const rows = await db
    .select({
      id: raceEvents.id,
      number: raceEvents.number,
      name: raceEvents.name,
      eventDate: raceEvents.eventDate,
      isHmj: raceEvents.isHmj,
      kartType: raceEvents.kartType,
      status: raceEvents.status,
      liveAgeClassId: raceEvents.liveAgeClassId,
      hostTeamName: teams.name,
    })
    .from(raceEvents)
    .leftJoin(teams, eq(teams.id, raceEvents.hostTeamId))
    .where(eq(raceEvents.id, eventId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getFinalizedAgeClassIds(
  eventId: number,
): Promise<Set<number>> {
  const rows = await db
    .select({ ageClassId: eventAgeClassFinalizations.ageClassId })
    .from(eventAgeClassFinalizations)
    .where(eq(eventAgeClassFinalizations.raceEventId, eventId));
  return new Set(rows.map((r) => r.ageClassId));
}

export async function getPointsScale(): Promise<Map<number, number>> {
  const rows = await db.select().from(pointsScale);
  return new Map(rows.map((r) => [r.place, r.points]));
}

export interface EnrichedEntry extends RankableEntry {
  firstName: string;
  lastName: string;
  teamName: string;
  ageClassName: string;
  ageClassSortOrder: number;
  startingOrder: number | null;
}

/** Fetch every entry of a race event with its three runs, ready for ranking. */
export async function getEnrichedEntriesForEvent(
  eventId: number,
): Promise<EnrichedEntry[]> {
  const entryRows = await db
    .select({
      entryId: raceEntries.id,
      driverId: raceEntries.driverId,
      ageClassId: raceEntries.ageClassId,
      ageClassName: ageClasses.name,
      ageClassSortOrder: ageClasses.sortOrder,
      startingOrder: raceEntries.startingOrder,
      pointsAwarded: raceEntries.pointsAwarded,
      finishPosition: raceEntries.finishPosition,
      driverType: drivers.driverType,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      teamName: teams.name,
    })
    .from(raceEntries)
    .innerJoin(drivers, eq(drivers.id, raceEntries.driverId))
    .innerJoin(ageClasses, eq(ageClasses.id, raceEntries.ageClassId))
    .innerJoin(teams, eq(teams.id, drivers.teamId))
    .where(eq(raceEntries.raceEventId, eventId))
    .orderBy(asc(ageClasses.sortOrder), asc(drivers.lastName));

  if (entryRows.length === 0) return [];

  const runRows = await db
    .select()
    .from(runs)
    .innerJoin(
      raceEntries,
      eq(raceEntries.id, runs.raceEntryId),
    )
    .where(eq(raceEntries.raceEventId, eventId));

  const runsByEntry = new Map<number, EntryRuns>();
  for (const e of entryRows) {
    runsByEntry.set(e.entryId, { test: null, first: null, second: null });
  }
  for (const row of runRows) {
    const slot = runsByEntry.get(row.runs.raceEntryId);
    if (!slot) continue;
    const time =
      row.runs.timeSeconds === null ? null : Number(row.runs.timeSeconds);
    slot[row.runs.runType as RunTypeDb] = {
      timeSeconds: time,
      penaltySeconds: row.runs.penaltySeconds,
    };
  }

  return entryRows.map((e) => ({
    entryId: e.entryId,
    driverId: e.driverId,
    driverType: e.driverType,
    ageClassId: e.ageClassId,
    runs: runsByEntry.get(e.entryId)!,
    storedPointsAwarded: e.pointsAwarded,
    storedFinishPosition: e.finishPosition,
    startingOrder: e.startingOrder,
    firstName: e.firstName,
    lastName: e.lastName,
    teamName: e.teamName,
    ageClassName: e.ageClassName,
    ageClassSortOrder: e.ageClassSortOrder,
  }));
}

/* ─────────────────────── Championship aggregation ────────────────────── */

export const HTS_RACES = [1, 2, 3, 4, 5, 6, 7, 8];
export const HMJ_RACES = [1, 3, 5, 7, 8];

export function seriesRaceNumbers(series: Series): number[] {
  return series === "hts" ? HTS_RACES : HMJ_RACES;
}

/**
 * Race numbers whose event is `completed` — only these may be used as
 * Streichergebnisse in the championship aggregation.
 */
export async function getCompletedRaceNumbers(): Promise<number[]> {
  const rows = await db
    .select({ number: raceEvents.number, status: raceEvents.status })
    .from(raceEvents);
  return rows.filter((r) => r.status === "completed").map((r) => r.number);
}

/**
 * Build per-driver race results across all events. Events with no entry for a
 * driver count as 0 points / not started (but are still droppable when the
 * class was finalized for them).
 */
export async function getChampionshipDrivers(): Promise<
  DriverChampionshipInput[]
> {
  const entryRows = await db
    .select({
      raceEventId: raceEntries.raceEventId,
      raceNumber: raceEvents.number,
      isHmj: raceEvents.isHmj,
      pointsAwarded: raceEntries.pointsAwarded,
      finishPosition: raceEntries.finishPosition,
      driverId: raceEntries.driverId,
      driverType: drivers.driverType,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      teamId: drivers.teamId,
      teamName: teams.name,
      ageClassId: drivers.ageClassId,
      ageClassName: ageClasses.name,
      yearOfBirth: drivers.yearOfBirth,
      adacId: drivers.adacId,
    })
    .from(raceEntries)
    .innerJoin(raceEvents, eq(raceEvents.id, raceEntries.raceEventId))
    .innerJoin(drivers, eq(drivers.id, raceEntries.driverId))
    .innerJoin(teams, eq(teams.id, drivers.teamId))
    .innerJoin(ageClasses, eq(ageClasses.id, drivers.ageClassId));

  const [runRows, finalizationKeys] = await Promise.all([
    db
      .select({
        raceEntryId: runs.raceEntryId,
        raceEventId: raceEntries.raceEventId,
        driverId: raceEntries.driverId,
        penaltySeconds: runs.penaltySeconds,
        runType: runs.runType,
      })
      .from(runs)
      .innerJoin(raceEntries, eq(raceEntries.id, runs.raceEntryId)),
    getAllFinalizationKeys(),
  ]);

  const penaltyByDriverEvent = new Map<string, number>();
  for (const r of runRows) {
    if (r.runType === "test") continue;
    const key = `${r.driverId}|${r.raceEventId}`;
    penaltyByDriverEvent.set(
      key,
      (penaltyByDriverEvent.get(key) ?? 0) + r.penaltySeconds,
    );
  }

  const byDriver = new Map<number, DriverChampionshipInput>();
  for (const row of entryRows) {
    let entry = byDriver.get(row.driverId);
    if (!entry) {
      entry = {
        driverId: row.driverId,
        firstName: row.firstName,
        lastName: row.lastName,
        teamId: row.teamId,
        teamName: row.teamName,
        ageClassId: row.ageClassId,
        ageClassName: row.ageClassName,
        yearOfBirth: row.yearOfBirth,
        adacId: row.adacId,
        driverType: row.driverType,
        results: [],
      };
      byDriver.set(row.driverId, entry);
    }

    const result: DriverRaceResult = {
      raceEventId: row.raceEventId,
      raceNumber: row.raceNumber,
      isHmj: row.isHmj,
      pointsAwarded: row.pointsAwarded,
      finishPosition: row.finishPosition ?? null,
      participated:
        row.pointsAwarded > 0 ||
        row.finishPosition !== null && row.finishPosition !== undefined,
      penaltySecondsTotal:
        penaltyByDriverEvent.get(`${row.driverId}|${row.raceEventId}`) ?? 0,
      finalized: finalizationKeys.has(`${row.raceEventId}|${row.ageClassId}`),
    };
    entry.results.push(result);
  }

  return [...byDriver.values()];
}
