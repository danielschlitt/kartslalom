import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  endlauf26Drivers,
  endlauf26Entries,
  endlauf26Events,
  endlauf26Finalizations,
  endlauf26SeasonResults,
  endlauf26Teams,
} from "@/db/schema";
import {
  computeEndlauf26Championship,
  finalizeEndlaufClass,
  rankEndlaufEntries,
  type Endlauf26Championship,
  type Endlauf26Row,
  type EndlaufDriverInput,
  type EndlaufEntryRuns,
  type EndlaufEventInfo,
  type EndlaufRankable,
} from "@/lib/endlauf26/ranking";

export type EndlaufEventStatus = "upcoming" | "live" | "completed";

export interface EndlaufEvent {
  id: number;
  championship: Endlauf26Championship;
  number: number;
  slug: string;
  name: string;
  eventDate: string | null;
  factor: number;
  status: EndlaufEventStatus;
  liveAgeClass: number | null;
  liveEntryId: number | null;
}

function mapEvent(e: typeof endlauf26Events.$inferSelect): EndlaufEvent {
  return {
    id: e.id,
    championship: e.championship,
    number: e.number,
    slug: e.slug,
    name: e.name,
    eventDate: e.eventDate,
    factor: Number(e.factor),
    status: e.status,
    liveAgeClass: e.liveAgeClass,
    liveEntryId: e.liveEntryId,
  };
}

export async function getEndlaufEvents(
  championship?: Endlauf26Championship,
): Promise<EndlaufEvent[]> {
  const q = db.select().from(endlauf26Events);
  const rows = championship
    ? await q
        .where(eq(endlauf26Events.championship, championship))
        .orderBy(asc(endlauf26Events.number))
    : await q.orderBy(asc(endlauf26Events.championship), asc(endlauf26Events.number));
  return rows.map(mapEvent);
}

export async function getEndlaufEvent(eventId: number): Promise<EndlaufEvent | null> {
  const [row] = await db
    .select()
    .from(endlauf26Events)
    .where(eq(endlauf26Events.id, eventId))
    .limit(1);
  return row ? mapEvent(row) : null;
}

export async function getEndlaufEventBySlug(
  championship: Endlauf26Championship,
  slug: string,
): Promise<EndlaufEvent | null> {
  const [row] = await db
    .select()
    .from(endlauf26Events)
    .where(
      and(
        eq(endlauf26Events.championship, championship),
        eq(endlauf26Events.slug, slug),
      ),
    )
    .limit(1);
  return row ? mapEvent(row) : null;
}

/** The live Endlauf event (any championship unless given). */
export async function getLiveEndlaufEvent(
  championship?: Endlauf26Championship,
): Promise<EndlaufEvent | null> {
  const rows = await db
    .select()
    .from(endlauf26Events)
    .where(
      championship
        ? and(
            eq(endlauf26Events.status, "live"),
            eq(endlauf26Events.championship, championship),
          )
        : eq(endlauf26Events.status, "live"),
    )
    .limit(1);
  return rows[0] ? mapEvent(rows[0]) : null;
}

export function toEventInfo(e: EndlaufEvent): EndlaufEventInfo {
  return {
    eventId: e.id,
    number: e.number,
    slug: e.slug,
    name: e.name,
    factor: e.factor,
  };
}

/* ───────────────────────────── entries ───────────────────────────── */

export interface EndlaufEntry extends EndlaufRankable {
  firstName: string;
  lastName: string;
  teamName: string;
  verband: string | null;
  region: string | null;
  seasonPosition: number | null;
  startingOrder: number | null;
  positionRun1: number | null;
  positionRun2: number | null;
  positionLive: number | null;
  finishPosition: number | null;
  pointsAwarded: number;
}

function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function entryRuns(e: typeof endlauf26Entries.$inferSelect): EndlaufEntryRuns {
  const mk = (t: string | null, p: number) =>
    t === null ? null : { timeSeconds: Number(t), penaltySeconds: p };
  return {
    test: mk(e.testTime, e.testPenalty),
    first: mk(e.run1Time, e.run1Penalty),
    second: mk(e.run2Time, e.run2Penalty),
  };
}

export async function getEndlaufEntriesForEvent(
  eventId: number,
  ageClass?: number,
): Promise<EndlaufEntry[]> {
  const rows = await db
    .select({
      entry: endlauf26Entries,
      firstName: endlauf26Drivers.firstName,
      lastName: endlauf26Drivers.lastName,
      verband: endlauf26Drivers.verband,
      region: endlauf26Drivers.region,
      seasonPosition: endlauf26Drivers.seasonPosition,
      teamName: endlauf26Teams.name,
    })
    .from(endlauf26Entries)
    .innerJoin(endlauf26Drivers, eq(endlauf26Drivers.id, endlauf26Entries.driverId))
    .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
    .where(
      ageClass === undefined
        ? eq(endlauf26Entries.eventId, eventId)
        : and(
            eq(endlauf26Entries.eventId, eventId),
            eq(endlauf26Entries.ageClass, ageClass),
          ),
    )
    .orderBy(
      asc(endlauf26Entries.ageClass),
      asc(endlauf26Entries.startingOrder),
      asc(endlauf26Drivers.lastName),
    );

  return rows.map((r) => ({
    entryId: r.entry.id,
    driverId: r.entry.driverId,
    ageClass: r.entry.ageClass,
    runs: entryRuns(r.entry),
    firstName: r.firstName,
    lastName: r.lastName,
    teamName: r.teamName,
    verband: r.verband,
    region: r.region,
    seasonPosition: r.seasonPosition,
    startingOrder: r.entry.startingOrder,
    positionRun1: r.entry.positionRun1,
    positionRun2: r.entry.positionRun2,
    positionLive: r.entry.positionLive,
    finishPosition: r.entry.finishPosition,
    pointsAwarded: r.entry.pointsAwarded,
  }));
}

export async function getFinalizedClasses(eventId: number): Promise<Set<number>> {
  const rows = await db
    .select({ ageClass: endlauf26Finalizations.ageClass })
    .from(endlauf26Finalizations)
    .where(eq(endlauf26Finalizations.eventId, eventId));
  return new Set(rows.map((r) => r.ageClass));
}

/**
 * Recompute and store the three live positions for one age class of an
 * event. Called after every time/penalty save.
 */
export async function recomputeLivePositions(eventId: number, ageClass: number) {
  const entries = await getEndlaufEntriesForEvent(eventId, ageClass);
  const positions = rankEndlaufEntries(entries);
  await db.transaction(async (tx) => {
    for (const p of positions) {
      await tx
        .update(endlauf26Entries)
        .set({
          positionRun1: p.positionRun1,
          positionRun2: p.positionRun2,
          positionLive: p.positionLive,
        })
        .where(eq(endlauf26Entries.id, p.entryId));
    }
  });
  return positions;
}

/**
 * Derive official finish positions + base points for a finalized class and
 * store them. Returns number of entries written.
 */
export async function writeFinalResults(eventId: number, ageClass: number) {
  const entries = await getEndlaufEntriesForEvent(eventId, ageClass);
  const results = finalizeEndlaufClass(entries);
  const live = rankEndlaufEntries(entries);
  await db.transaction(async (tx) => {
    for (const r of results) {
      const l = live.find((x) => x.entryId === r.entryId)!;
      await tx
        .update(endlauf26Entries)
        .set({
          finishPosition: r.finishPosition,
          pointsAwarded: r.pointsAwarded,
          positionRun1: l.positionRun1,
          positionRun2: l.positionRun2,
          positionLive: l.positionLive,
        })
        .where(eq(endlauf26Entries.id, r.entryId));
    }
  });
  return results.length;
}

/* ─────────────────────────── championship ─────────────────────────── */

export interface EndlaufChampionshipData {
  championship: Endlauf26Championship;
  events: EndlaufEvent[];
  drivers: EndlaufDriverInput[];
  rows: Endlauf26Row[];
  /** eventId → set of finalized age classes */
  finalized: Map<number, Set<number>>;
}

export async function getEndlaufChampionship(
  championship: Endlauf26Championship,
  opts: { applyDrops?: boolean } = {},
): Promise<EndlaufChampionshipData> {
  const events = await getEndlaufEvents(championship);
  const eventIds = events.map((e) => e.id);

  const driverRows = await db
    .select({
      d: endlauf26Drivers,
      teamName: endlauf26Teams.name,
    })
    .from(endlauf26Drivers)
    .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
    .where(eq(endlauf26Drivers.championship, championship))
    .orderBy(asc(endlauf26Drivers.ageClass), asc(endlauf26Drivers.lastName));

  const driverIds = driverRows.map((r) => r.d.id);
  if (driverIds.length === 0) {
    return { championship, events, drivers: [], rows: [], finalized: new Map() };
  }

  const [seasonRows, entryRows, finalRows] = await Promise.all([
    db
      .select()
      .from(endlauf26SeasonResults)
      .where(inArray(endlauf26SeasonResults.driverId, driverIds)),
    eventIds.length
      ? db
          .select()
          .from(endlauf26Entries)
          .where(inArray(endlauf26Entries.eventId, eventIds))
      : Promise.resolve([] as (typeof endlauf26Entries.$inferSelect)[]),
    eventIds.length
      ? db
          .select()
          .from(endlauf26Finalizations)
          .where(inArray(endlauf26Finalizations.eventId, eventIds))
      : Promise.resolve([] as (typeof endlauf26Finalizations.$inferSelect)[]),
  ]);

  const finalized = new Map<number, Set<number>>();
  for (const f of finalRows) {
    const s = finalized.get(f.eventId) ?? new Set<number>();
    s.add(f.ageClass);
    finalized.set(f.eventId, s);
  }

  const seasonByDriver = new Map<number, typeof seasonRows>();
  for (const s of seasonRows) {
    seasonByDriver.set(s.driverId, [...(seasonByDriver.get(s.driverId) ?? []), s]);
  }
  const entriesByDriver = new Map<number, typeof entryRows>();
  for (const e of entryRows) {
    entriesByDriver.set(e.driverId, [...(entriesByDriver.get(e.driverId) ?? []), e]);
  }

  const drivers: EndlaufDriverInput[] = driverRows.map(({ d, teamName }) => ({
    driverId: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    teamId: d.teamId,
    teamName,
    ageClass: d.ageClass,
    verband: d.verband,
    region: d.region,
    adacId: d.adacId,
    yearOfBirth: d.yearOfBirth,
    seasonPosition: d.seasonPosition,
    seasonPoints: num(d.seasonPoints),
    seasonRaces: d.seasonRaces,
    seasonResults: (seasonByDriver.get(d.id) ?? [])
      .sort((a, b) => a.raceNumber - b.raceNumber)
      .map((s) => ({
        raceNumber: s.raceNumber,
        finishPosition: s.finishPosition,
        points: s.points,
      })),
    endlaufResults: (entriesByDriver.get(d.id) ?? []).map((e) => ({
      eventId: e.eventId,
      finishPosition: e.finishPosition,
      pointsAwarded: e.pointsAwarded,
      started:
        e.run1Time !== null || e.run2Time !== null || e.finishPosition !== null,
      finalized: finalized.get(e.eventId)?.has(e.ageClass) ?? false,
    })),
  }));

  const rows = computeEndlauf26Championship(
    championship,
    drivers,
    events.map(toEventInfo),
    { applyDrops: opts.applyDrops },
  );

  return { championship, events, drivers, rows, finalized };
}

export async function getEndlaufDriver(driverId: number) {
  const [row] = await db
    .select({ d: endlauf26Drivers, teamName: endlauf26Teams.name })
    .from(endlauf26Drivers)
    .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
    .where(eq(endlauf26Drivers.id, driverId))
    .limit(1);
  return row ?? null;
}
