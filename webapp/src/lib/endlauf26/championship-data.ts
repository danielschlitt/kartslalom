/**
 * Endläufe 2026 — the championship table straight from the database.
 *
 * Deliberately *not* behind the `server-only` guard of `lib/dal/endlauf26.ts`
 * and parameterised by the drizzle instance, so that scripts (the seed, which
 * has to re-derive start orders after every deploy) can use the very same
 * computation as the web app. The DAL re-exports these with its own `db`.
 */

import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../../db/schema";
import {
  endlauf26Drivers,
  endlauf26Events,
  endlauf26Results,
  endlauf26SeasonResults,
  endlauf26Teams,
} from "../../db/schema";
import {
  computeEndlauf26Championship,
  pointsForPlace,
  type Endlauf26Championship,
  type Endlauf26Row,
  type EndlaufDriverInput,
  type EndlaufEventInfo,
} from "./ranking";
import { namesMatch, nameTokens } from "./names";

export type Endlauf26Db = NodePgDatabase<typeof schema>;

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

export function mapEvent(e: typeof endlauf26Events.$inferSelect): EndlaufEvent {
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

export function toEventInfo(e: EndlaufEvent): EndlaufEventInfo {
  return {
    eventId: e.id,
    number: e.number,
    slug: e.slug,
    name: e.name,
    factor: e.factor,
  };
}

export async function loadEndlaufEvents(
  db: Endlauf26Db,
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

/**
 * The Endlauf field: drivers qualified via the standings list plus
 * Nachrücker (nominated). Everything else in `endlauf26_drivers` is a
 * replacement candidate and must not show up anywhere public.
 */
export const inFieldCondition = or(
  eq(endlauf26Drivers.qualified, true),
  eq(endlauf26Drivers.nominated, true),
);

export function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

export interface EndlaufChampionshipData {
  championship: Endlauf26Championship;
  events: EndlaufEvent[];
  drivers: EndlaufDriverInput[];
  rows: Endlauf26Row[];
  /** eventId → set of age classes with an imported result list */
  scored: Map<number, Set<number>>;
}

/**
 * hmj drivers who hold a DKM spot in the current (official) hmj standings —
 * as a predicate on ADAC rows. Matching is by name (tolerant) and age class,
 * because the two championships share drivers by name only.
 */
async function hmjDkmQualifiedPredicate(
  db: Endlauf26Db,
): Promise<(row: Endlauf26Row) => boolean> {
  const hmj = await loadEndlaufChampionship(db, "hmj");
  const qualified = hmj.rows
    .filter((r) => r.dkmVia === "hmj")
    .map((r) => ({ ageClass: r.ageClass, tokens: nameTokens(r.lastName, r.firstName) }));
  return (row) => {
    const tokens = nameTokens(row.lastName, row.firstName);
    return qualified.some((q) => q.ageClass === row.ageClass && namesMatch(tokens, q.tokens));
  };
}

export async function loadEndlaufChampionship(
  db: Endlauf26Db,
  championship: Endlauf26Championship,
  opts: { applyDrops?: boolean } = {},
): Promise<EndlaufChampionshipData> {
  const events = await loadEndlaufEvents(db, championship);
  const eventIds = events.map((e) => e.id);
  // The ADAC DKM spot skips drivers already qualified through hmj.
  const qualifiedElsewhere =
    championship === "adac_hth" ? await hmjDkmQualifiedPredicate(db) : undefined;

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
    return { championship, events, drivers: [], rows: [], scored: new Map() };
  }

  const [seasonRows, resultRows] = await Promise.all([
    db
      .select()
      .from(endlauf26SeasonResults)
      .where(inArray(endlauf26SeasonResults.driverId, driverIds)),
    eventIds.length
      ? db
          .select({
            eventId: endlauf26Results.eventId,
            driverId: endlauf26Results.driverId,
            ageClass: endlauf26Results.ageClass,
            position: endlauf26Results.position,
            points: endlauf26Results.points,
          })
          .from(endlauf26Results)
          .where(inArray(endlauf26Results.eventId, eventIds))
      : Promise.resolve(
          [] as {
            eventId: number;
            driverId: number;
            ageClass: number;
            position: number | null;
            points: number | null;
          }[],
        ),
  ]);

  // A class is scored at an event as soon as any result row exists for it.
  const scored = new Map<number, Set<number>>();
  for (const r of resultRows) {
    const s = scored.get(r.eventId) ?? new Set<number>();
    s.add(r.ageClass);
    scored.set(r.eventId, s);
  }

  const seasonByDriver = new Map<number, typeof seasonRows>();
  for (const s of seasonRows) {
    seasonByDriver.set(s.driverId, [...(seasonByDriver.get(s.driverId) ?? []), s]);
  }
  const resultsByDriver = new Map<number, typeof resultRows>();
  for (const r of resultRows) {
    resultsByDriver.set(r.driverId, [...(resultsByDriver.get(r.driverId) ?? []), r]);
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
    endlaufResults: events.map((ev) => {
      const r = (resultsByDriver.get(d.id) ?? []).find((x) => x.eventId === ev.id) ?? null;
      const started = r !== null && r.position !== null;
      return {
        eventId: ev.id,
        finishPosition: r?.position ?? null,
        // Printed "ADAC Punkte" are authoritative; fall back to the scale.
        pointsAwarded: started ? (r!.points ?? pointsForPlace(r!.position)) : 0,
        started,
        scored: scored.get(ev.id)?.has(d.ageClass) ?? false,
      };
    }),
  }));

  const rows = computeEndlauf26Championship(
    championship,
    drivers,
    events.map(toEventInfo),
    { applyDrops: opts.applyDrops, qualifiedElsewhere },
  );

  return { championship, events, drivers, rows, scored };
}
