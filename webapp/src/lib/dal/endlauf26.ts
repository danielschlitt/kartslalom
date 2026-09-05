import "server-only";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
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

/* ───────────────────────────── field ───────────────────────────── */

/**
 * The Endlauf field: drivers qualified via the standings list plus
 * Nachnominierungen. Everything else in `endlauf26_drivers` is a
 * replacement candidate and must not show up anywhere public.
 */
const inFieldCondition = or(
  eq(endlauf26Drivers.qualified, true),
  eq(endlauf26Drivers.nominated, true),
);

/* ───────────────────────────── entries ───────────────────────────── */

export interface EndlaufEntry extends EndlaufRankable {
  firstName: string;
  lastName: string;
  teamName: string;
  verband: string | null;
  region: string | null;
  seasonPosition: number | null;
  withdrawn: boolean;
  nominated: boolean;
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

/**
 * Entries of an event (optionally one age class), start-list order.
 *
 * Withdrawn drivers are hidden by default — they must not appear in start
 * lists or live boards. Ranking/finalization pass `includeWithdrawn` so a
 * driver who set a time before withdrawing keeps a consistent position.
 */
export async function getEndlaufEntriesForEvent(
  eventId: number,
  ageClass?: number,
  opts: { includeWithdrawn?: boolean } = {},
): Promise<EndlaufEntry[]> {
  const rows = await db
    .select({
      entry: endlauf26Entries,
      firstName: endlauf26Drivers.firstName,
      lastName: endlauf26Drivers.lastName,
      verband: endlauf26Drivers.verband,
      region: endlauf26Drivers.region,
      seasonPosition: endlauf26Drivers.seasonPosition,
      withdrawn: endlauf26Drivers.withdrawn,
      nominated: endlauf26Drivers.nominated,
      teamName: endlauf26Teams.name,
    })
    .from(endlauf26Entries)
    .innerJoin(endlauf26Drivers, eq(endlauf26Drivers.id, endlauf26Entries.driverId))
    .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
    .where(
      and(
        eq(endlauf26Entries.eventId, eventId),
        ageClass === undefined ? undefined : eq(endlauf26Entries.ageClass, ageClass),
        inFieldCondition,
        opts.includeWithdrawn ? undefined : eq(endlauf26Drivers.withdrawn, false),
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
    withdrawn: r.withdrawn,
    nominated: r.nominated,
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
  const entries = await getEndlaufEntriesForEvent(eventId, ageClass, {
    includeWithdrawn: true,
  });
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
  const entries = await getEndlaufEntriesForEvent(eventId, ageClass, {
    includeWithdrawn: true,
  });
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
    .where(and(eq(endlauf26Drivers.championship, championship), inFieldCondition))
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
    withdrawn: d.withdrawn,
    nominated: d.nominated,
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

/* ─────────────────────────── field management ─────────────────────────── */

export interface EndlaufFieldDriver {
  driverId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  ageClass: number;
  verband: string | null;
  region: string | null;
  seasonPosition: number | null;
  seasonPoints: number | null;
  seasonRaces: number;
  qualified: boolean;
  withdrawn: boolean;
  nominated: boolean;
  /** Some Endlauf time (training or Wertungslauf) is stored for this driver. */
  hasTimes: boolean;
}

const hasAnyTime = or(
  isNotNull(endlauf26Entries.testTime),
  isNotNull(endlauf26Entries.run1Time),
  isNotNull(endlauf26Entries.run2Time),
);

/**
 * Every imported driver of a championship — the field (qualified or
 * nominated) as well as the replacement candidates — for the admin page.
 */
export async function getEndlaufFieldDrivers(
  championship: Endlauf26Championship,
): Promise<EndlaufFieldDriver[]> {
  const [rows, timed] = await Promise.all([
    db
      .select({ d: endlauf26Drivers, teamName: endlauf26Teams.name })
      .from(endlauf26Drivers)
      .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
      .where(eq(endlauf26Drivers.championship, championship))
      .orderBy(
        asc(endlauf26Drivers.ageClass),
        asc(endlauf26Drivers.seasonPosition),
        asc(endlauf26Drivers.lastName),
      ),
    db
      .selectDistinct({ driverId: endlauf26Entries.driverId })
      .from(endlauf26Entries)
      .innerJoin(endlauf26Events, eq(endlauf26Events.id, endlauf26Entries.eventId))
      .where(and(eq(endlauf26Events.championship, championship), hasAnyTime)),
  ]);
  const timedIds = new Set(timed.map((t) => t.driverId));
  return rows.map(({ d, teamName }) => ({
    driverId: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    teamName,
    ageClass: d.ageClass,
    verband: d.verband,
    region: d.region,
    seasonPosition: d.seasonPosition,
    seasonPoints: num(d.seasonPoints),
    seasonRaces: d.seasonRaces,
    qualified: d.qualified,
    withdrawn: d.withdrawn,
    nominated: d.nominated,
    hasTimes: timedIds.has(d.id),
  }));
}

/** Whether any entry of (event, class) already has a time or the class is finalized. */
async function classIsUnderway(eventId: number, ageClass: number): Promise<boolean> {
  const [fin] = await db
    .select({ id: endlauf26Finalizations.id })
    .from(endlauf26Finalizations)
    .where(
      and(
        eq(endlauf26Finalizations.eventId, eventId),
        eq(endlauf26Finalizations.ageClass, ageClass),
      ),
    )
    .limit(1);
  if (fin) return true;
  const [timed] = await db
    .select({ id: endlauf26Entries.id })
    .from(endlauf26Entries)
    .where(
      and(
        eq(endlauf26Entries.eventId, eventId),
        eq(endlauf26Entries.ageClass, ageClass),
        hasAnyTime,
      ),
    )
    .limit(1);
  return !!timed;
}

/**
 * Renumber the starting order 1..n of one age class for every event of the
 * championship whose class has not started yet (no times, not finalized).
 * The relative order is preserved, so manual tweaks survive; withdrawn
 * drivers are skipped and a fresh entry with order 0 ends up first (the
 * replacement has the worst pre-Endlauf standing → starts first).
 */
async function compactStartingOrders(
  championship: Endlauf26Championship,
  ageClass: number,
): Promise<void> {
  const events = await db
    .select({ id: endlauf26Events.id })
    .from(endlauf26Events)
    .where(eq(endlauf26Events.championship, championship));

  for (const ev of events) {
    if (await classIsUnderway(ev.id, ageClass)) continue;
    const entries = await db
      .select({
        id: endlauf26Entries.id,
        startingOrder: endlauf26Entries.startingOrder,
        lastName: endlauf26Drivers.lastName,
      })
      .from(endlauf26Entries)
      .innerJoin(endlauf26Drivers, eq(endlauf26Drivers.id, endlauf26Entries.driverId))
      .where(
        and(
          eq(endlauf26Entries.eventId, ev.id),
          eq(endlauf26Entries.ageClass, ageClass),
          inFieldCondition,
          eq(endlauf26Drivers.withdrawn, false),
        ),
      );
    entries.sort((a, b) => {
      const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.lastName.localeCompare(b.lastName, "de");
    });
    await db.transaction(async (tx) => {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].startingOrder === i + 1) continue;
        await tx
          .update(endlauf26Entries)
          .set({ startingOrder: i + 1 })
          .where(eq(endlauf26Entries.id, entries[i].id));
      }
    });
  }
}

export type FieldChangeResult =
  | "ok"
  | "not_found"
  | "not_in_field"
  | "already_qualified"
  | "has_times";

/**
 * Flag a driver of the field as not competing (or take it back). The entries
 * stay in place — they are hidden from start lists by `withdrawn`, and the
 * remaining drivers are renumbered for classes that have not started yet.
 */
export async function setEndlaufDriverWithdrawn(
  driverId: number,
  withdrawn: boolean,
): Promise<FieldChangeResult> {
  const [d] = await db
    .select()
    .from(endlauf26Drivers)
    .where(eq(endlauf26Drivers.id, driverId))
    .limit(1);
  if (!d) return "not_found";
  if (!d.qualified && !d.nominated) return "not_in_field";
  if (d.withdrawn !== withdrawn) {
    await db
      .update(endlauf26Drivers)
      .set({ withdrawn })
      .where(eq(endlauf26Drivers.id, driverId));
  }
  await compactStartingOrders(d.championship, d.ageClass);
  return "ok";
}

/**
 * Nominate a replacement candidate (creates its entries for every Endlauf,
 * starting first in classes that have not started yet) — or revoke a
 * nomination, which is only possible while no time has been recorded.
 */
export async function setEndlaufDriverNominated(
  driverId: number,
  nominated: boolean,
): Promise<FieldChangeResult> {
  const [d] = await db
    .select()
    .from(endlauf26Drivers)
    .where(eq(endlauf26Drivers.id, driverId))
    .limit(1);
  if (!d) return "not_found";
  if (d.qualified) return "already_qualified";

  if (nominated) {
    await db
      .update(endlauf26Drivers)
      .set({ nominated: true, withdrawn: false })
      .where(eq(endlauf26Drivers.id, driverId));
    const events = await getEndlaufEvents(d.championship);
    for (const ev of events) {
      // Classes already underway keep their order — the newcomer is appended.
      let startingOrder = 0;
      if (await classIsUnderway(ev.id, d.ageClass)) {
        const [m] = await db
          .select({ max: sql<number | null>`max(${endlauf26Entries.startingOrder})` })
          .from(endlauf26Entries)
          .where(
            and(
              eq(endlauf26Entries.eventId, ev.id),
              eq(endlauf26Entries.ageClass, d.ageClass),
            ),
          );
        startingOrder = (m?.max ?? 0) + 1;
      }
      await db
        .insert(endlauf26Entries)
        .values({ eventId: ev.id, driverId, ageClass: d.ageClass, startingOrder })
        .onConflictDoNothing();
    }
  } else {
    const [timed] = await db
      .select({ id: endlauf26Entries.id })
      .from(endlauf26Entries)
      .where(and(eq(endlauf26Entries.driverId, driverId), hasAnyTime))
      .limit(1);
    if (timed) return "has_times";
    await db.delete(endlauf26Entries).where(eq(endlauf26Entries.driverId, driverId));
    await db
      .update(endlauf26Drivers)
      .set({ nominated: false, withdrawn: false })
      .where(eq(endlauf26Drivers.id, driverId));
  }

  await compactStartingOrders(d.championship, d.ageClass);
  return "ok";
}
