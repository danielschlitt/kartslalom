import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  endlauf26Documents,
  endlauf26Drivers,
  endlauf26Entries,
  endlauf26Events,
  endlauf26Predictions,
  endlauf26Quotes,
  endlauf26ResultImages,
  endlauf26Results,
  endlauf26SeasonResults,
  endlauf26Teams,
} from "@/db/schema";
import {
  computeEndlauf26Championship,
  pointsForPlace,
  rankEndlaufEntries,
  type Endlauf26Championship,
  type Endlauf26Row,
  type EndlaufDriverInput,
  type EndlaufEntryRuns,
  type EndlaufEventInfo,
  type EndlaufRankable,
} from "@/lib/endlauf26/ranking";
import { namesMatch, nameTokens } from "@/lib/endlauf26/names";
import type {
  EndlaufResultImageMeta,
  EndlaufResultImportItem,
  EndlaufResultRow,
  PoolDriver,
} from "@/lib/endlauf26/results-types";

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
 * Nachrücker (nominated). Everything else in `endlauf26_drivers` is a
 * replacement candidate and must not show up anywhere public.
 */
const inFieldCondition = or(
  eq(endlauf26Drivers.qualified, true),
  eq(endlauf26Drivers.nominated, true),
);

function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

/* ───────────────────────── live timing entries ───────────────────────── */

export interface EndlaufEntry extends EndlaufRankable {
  firstName: string;
  lastName: string;
  teamName: string;
  verband: string | null;
  region: string | null;
  seasonPosition: number | null;
  qualified: boolean;
  withdrawn: boolean;
  nominated: boolean;
  startingOrder: number | null;
  positionRun1: number | null;
  positionRun2: number | null;
  positionLive: number | null;
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
 * Live-timing entries of an event (optionally one age class), start-list order.
 *
 * Withdrawn drivers are hidden by default — they must not appear in start
 * lists or live boards. Ranking passes `includeWithdrawn` so a driver who
 * set a time before withdrawing keeps a consistent position.
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
      qualified: endlauf26Drivers.qualified,
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
    qualified: r.qualified,
    withdrawn: r.withdrawn,
    nominated: r.nominated,
    startingOrder: r.entry.startingOrder,
    positionRun1: r.entry.positionRun1,
    positionRun2: r.entry.positionRun2,
    positionLive: r.entry.positionLive,
  }));
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

/* ───────────────────────── official results ───────────────────────── */

function mapResult(
  r: typeof endlauf26Results.$inferSelect,
  d: {
    firstName: string;
    lastName: string;
    teamName: string;
    qualified: boolean;
    nominated: boolean;
    withdrawn: boolean;
  },
): EndlaufResultRow {
  return {
    id: r.id,
    eventId: r.eventId,
    driverId: r.driverId,
    ageClass: r.ageClass,
    position: r.position,
    startPosition: r.startPosition,
    wertung: r.wertung,
    testTime: num(r.testTime),
    run1Time: num(r.run1Time),
    run1Penalty: r.run1Penalty,
    run2Time: num(r.run2Time),
    run2Penalty: r.run2Penalty,
    totalPenalty: r.totalPenalty,
    totalTime: num(r.totalTime),
    points: r.points,
    sheetTeam: r.sheetTeam,
    sheetAdacId: r.sheetAdacId,
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    imageId: r.imageId,
    firstName: d.firstName,
    lastName: d.lastName,
    teamName: d.teamName,
    qualified: d.qualified,
    nominated: d.nominated,
    withdrawn: d.withdrawn,
  };
}

/** Official results of an event (optionally one class), ordered by printed position. */
export async function getEndlaufResults(
  eventId: number,
  ageClass?: number,
): Promise<EndlaufResultRow[]> {
  const rows = await db
    .select({
      r: endlauf26Results,
      firstName: endlauf26Drivers.firstName,
      lastName: endlauf26Drivers.lastName,
      qualified: endlauf26Drivers.qualified,
      nominated: endlauf26Drivers.nominated,
      withdrawn: endlauf26Drivers.withdrawn,
      teamName: endlauf26Teams.name,
    })
    .from(endlauf26Results)
    .innerJoin(endlauf26Drivers, eq(endlauf26Drivers.id, endlauf26Results.driverId))
    .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
    .where(
      and(
        eq(endlauf26Results.eventId, eventId),
        ageClass === undefined ? undefined : eq(endlauf26Results.ageClass, ageClass),
      ),
    )
    .orderBy(
      asc(endlauf26Results.ageClass),
      sql`${endlauf26Results.position} nulls last`,
      asc(endlauf26Drivers.lastName),
    );
  return rows.map(({ r, ...d }) => mapResult(r, d));
}

/** Official results of every Endlauf of a championship (for statistics). */
export async function getEndlaufResultsForChampionship(
  championship: Endlauf26Championship,
): Promise<EndlaufResultRow[]> {
  const rows = await db
    .select({
      r: endlauf26Results,
      firstName: endlauf26Drivers.firstName,
      lastName: endlauf26Drivers.lastName,
      qualified: endlauf26Drivers.qualified,
      nominated: endlauf26Drivers.nominated,
      withdrawn: endlauf26Drivers.withdrawn,
      teamName: endlauf26Teams.name,
    })
    .from(endlauf26Results)
    .innerJoin(endlauf26Events, eq(endlauf26Events.id, endlauf26Results.eventId))
    .innerJoin(endlauf26Drivers, eq(endlauf26Drivers.id, endlauf26Results.driverId))
    .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
    .where(eq(endlauf26Events.championship, championship))
    .orderBy(
      asc(endlauf26Events.number),
      asc(endlauf26Results.ageClass),
      sql`${endlauf26Results.position} nulls last`,
    );
  return rows.map(({ r, ...d }) => mapResult(r, d));
}

/** Age classes of an event with an imported result list (= scored). */
export async function getScoredClasses(eventId: number): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ ageClass: endlauf26Results.ageClass })
    .from(endlauf26Results)
    .where(eq(endlauf26Results.eventId, eventId));
  return new Set(rows.map((r) => r.ageClass));
}

export async function getResultImages(
  eventId: number,
  ageClass?: number,
): Promise<EndlaufResultImageMeta[]> {
  const rows = await db
    .select({
      id: endlauf26ResultImages.id,
      eventId: endlauf26ResultImages.eventId,
      ageClass: endlauf26ResultImages.ageClass,
      mime: endlauf26ResultImages.mime,
      size: endlauf26ResultImages.size,
      uploadedAt: endlauf26ResultImages.uploadedAt,
      rowCount: sql<number>`(select count(*)::int from ${endlauf26Results} where ${endlauf26Results.imageId} = ${endlauf26ResultImages.id})`,
    })
    .from(endlauf26ResultImages)
    .where(
      and(
        eq(endlauf26ResultImages.eventId, eventId),
        ageClass === undefined ? undefined : eq(endlauf26ResultImages.ageClass, ageClass),
      ),
    )
    .orderBy(asc(endlauf26ResultImages.ageClass), asc(endlauf26ResultImages.uploadedAt));
  return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() }));
}

export async function getResultImage(id: number) {
  const [row] = await db
    .select()
    .from(endlauf26ResultImages)
    .where(eq(endlauf26ResultImages.id, id))
    .limit(1);
  return row ?? null;
}

export async function deleteResultImage(id: number): Promise<boolean> {
  const res = await db
    .delete(endlauf26ResultImages)
    .where(eq(endlauf26ResultImages.id, id))
    .returning({ id: endlauf26ResultImages.id });
  return res.length > 0;
}

/** Remove the whole imported result list of one class (rows + photos). */
export async function deleteClassResults(eventId: number, ageClass: number) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(endlauf26Results)
      .where(and(eq(endlauf26Results.eventId, eventId), eq(endlauf26Results.ageClass, ageClass)))
      .returning({ id: endlauf26Results.id });
    const imgs = await tx
      .delete(endlauf26ResultImages)
      .where(
        and(
          eq(endlauf26ResultImages.eventId, eventId),
          eq(endlauf26ResultImages.ageClass, ageClass),
        ),
      )
      .returning({ id: endlauf26ResultImages.id });
    return { rows: rows.length, images: imgs.length };
  });
}

/**
 * Every driver of (championship, class) — the field and the Nachrücker pool —
 * as matching candidates for a photographed result list of `eventId`.
 */
export async function getClassPool(
  championship: Endlauf26Championship,
  ageClass: number,
  eventId: number,
): Promise<PoolDriver[]> {
  const rows = await db
    .select({
      d: endlauf26Drivers,
      teamName: endlauf26Teams.name,
      startingOrder: endlauf26Entries.startingOrder,
    })
    .from(endlauf26Drivers)
    .innerJoin(endlauf26Teams, eq(endlauf26Teams.id, endlauf26Drivers.teamId))
    .leftJoin(
      endlauf26Entries,
      and(
        eq(endlauf26Entries.driverId, endlauf26Drivers.id),
        eq(endlauf26Entries.eventId, eventId),
      ),
    )
    .where(
      and(
        eq(endlauf26Drivers.championship, championship),
        eq(endlauf26Drivers.ageClass, ageClass),
      ),
    )
    .orderBy(
      desc(endlauf26Drivers.qualified),
      desc(endlauf26Drivers.nominated),
      asc(endlauf26Drivers.seasonPosition),
      asc(endlauf26Drivers.lastName),
    );
  return rows.map(({ d, teamName, startingOrder }) => ({
    driverId: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    teamName,
    adacId: d.adacId,
    qualified: d.qualified,
    nominated: d.nominated,
    withdrawn: d.withdrawn,
    startingOrder: startingOrder ?? null,
  }));
}

export interface ImportOutcome {
  written: number;
  imageId: number | null;
  /** Drivers that were not in the field and are now Nachrücker. */
  nominated: string[];
  /** Withdrawn drivers that appeared on the list and were re-activated. */
  reactivated: string[];
  /** Drivers whose Ausweis-Nr. was filled in from the list. */
  adacIdsSet: number;
}

export type ImportError = "invalid_driver" | "driver_wrong_class";

/**
 * Write reviewed rows of a result list. Existing rows of the same drivers are
 * replaced (a class may span two photos — rows of other drivers stay), the
 * photo is stored, non-field drivers become Nachrücker, withdrawn drivers are
 * re-activated, missing Ausweis numbers / Wertung are filled in on the driver.
 */
export async function importEndlaufResults(
  event: EndlaufEvent,
  ageClass: number,
  items: EndlaufResultImportItem[],
  image: { mime: string; data: Buffer } | null,
): Promise<{ ok: true; outcome: ImportOutcome } | { ok: false; error: ImportError }> {
  const driverIds = items.map((i) => i.driverId);
  const drivers = driverIds.length
    ? await db
        .select()
        .from(endlauf26Drivers)
        .where(inArray(endlauf26Drivers.id, driverIds))
    : [];
  const byId = new Map(drivers.map((d) => [d.id, d]));
  for (const id of driverIds) {
    const d = byId.get(id);
    if (!d || d.championship !== event.championship) return { ok: false, error: "invalid_driver" };
    if (d.ageClass !== ageClass) return { ok: false, error: "driver_wrong_class" };
  }

  const fmt = (t: number | null) => (t === null ? null : t.toFixed(3));
  const outcome: ImportOutcome = {
    written: 0,
    imageId: null,
    nominated: [],
    reactivated: [],
    adacIdsSet: 0,
  };

  await db.transaction(async (tx) => {
    if (image) {
      const [img] = await tx
        .insert(endlauf26ResultImages)
        .values({
          eventId: event.id,
          ageClass,
          mime: image.mime,
          size: image.data.byteLength,
          data: image.data,
        })
        .returning({ id: endlauf26ResultImages.id });
      outcome.imageId = img.id;
    }

    for (const it of items) {
      const values = {
        eventId: event.id,
        driverId: it.driverId,
        ageClass,
        position: it.position,
        startPosition: it.startPosition,
        wertung: it.wertung,
        testTime: fmt(it.testTime),
        run1Time: fmt(it.run1Time),
        run1Penalty: it.run1Penalty,
        run2Time: fmt(it.run2Time),
        run2Penalty: it.run2Penalty,
        totalPenalty: it.totalPenalty,
        totalTime: fmt(it.totalTime),
        points: it.points,
        sheetTeam: it.sheetTeam,
        sheetAdacId: it.sheetAdacId,
        warnings: it.warnings,
        imageId: outcome.imageId,
        importedAt: new Date(),
      };
      await tx
        .insert(endlauf26Results)
        .values(values)
        .onConflictDoUpdate({
          target: [endlauf26Results.eventId, endlauf26Results.driverId],
          set: { ...values },
        });
      outcome.written += 1;

      const d = byId.get(it.driverId)!;
      const patch: Partial<typeof endlauf26Drivers.$inferInsert> = {};
      if (!d.adacId && it.sheetAdacId) {
        patch.adacId = it.sheetAdacId;
        outcome.adacIdsSet += 1;
      }
      if (it.wertung && d.wertung !== it.wertung) patch.wertung = it.wertung;
      if (Object.keys(patch).length > 0) {
        await tx.update(endlauf26Drivers).set(patch).where(eq(endlauf26Drivers.id, d.id));
      }
    }
  });

  // Field changes outside the transaction — they renumber start lists etc.
  for (const it of items) {
    const d = byId.get(it.driverId)!;
    if (!d.qualified && !d.nominated) {
      await setEndlaufDriverNominated(d.id, true);
      outcome.nominated.push(`${d.lastName} ${d.firstName}`);
    } else if (d.withdrawn) {
      await setEndlaufDriverWithdrawn(d.id, false);
      outcome.reactivated.push(`${d.lastName} ${d.firstName}`);
    }
  }

  return { ok: true, outcome };
}

/**
 * Start from scratch for one Endlauf: official results and photos are
 * deleted, live times are cleared, the live state is reset. Drivers, the
 * field (Nachrücker/Abmeldungen) and start orders are kept.
 */
export async function resetEndlaufEvent(eventId: number) {
  return db.transaction(async (tx) => {
    const results = await tx
      .delete(endlauf26Results)
      .where(eq(endlauf26Results.eventId, eventId))
      .returning({ id: endlauf26Results.id });
    const images = await tx
      .delete(endlauf26ResultImages)
      .where(eq(endlauf26ResultImages.eventId, eventId))
      .returning({ id: endlauf26ResultImages.id });
    const entries = await tx
      .update(endlauf26Entries)
      .set({
        testTime: null,
        testPenalty: 0,
        run1Time: null,
        run1Penalty: 0,
        run2Time: null,
        run2Penalty: 0,
        positionRun1: null,
        positionRun2: null,
        positionLive: null,
        updatedAt: new Date(),
      })
      .where(eq(endlauf26Entries.eventId, eventId))
      .returning({ id: endlauf26Entries.id });
    await tx
      .update(endlauf26Events)
      .set({ status: "upcoming", liveAgeClass: null, liveEntryId: null })
      .where(eq(endlauf26Events.id, eventId));
    return { results: results.length, images: images.length, entries: entries.length };
  });
}

/* ─────────────────────────── championship ─────────────────────────── */

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
async function hmjDkmQualifiedPredicate(): Promise<(row: Endlauf26Row) => boolean> {
  const hmj = await getEndlaufChampionship("hmj");
  const qualified = hmj.rows
    .filter((r) => r.dkmVia === "hmj")
    .map((r) => ({ ageClass: r.ageClass, tokens: nameTokens(r.lastName, r.firstName) }));
  return (row) => {
    const tokens = nameTokens(row.lastName, row.firstName);
    return qualified.some((q) => q.ageClass === row.ageClass && namesMatch(tokens, q.tokens));
  };
}

export async function getEndlaufChampionship(
  championship: Endlauf26Championship,
  opts: { applyDrops?: boolean } = {},
): Promise<EndlaufChampionshipData> {
  const events = await getEndlaufEvents(championship);
  const eventIds = events.map((e) => e.id);
  // The ADAC DKM spot skips drivers already qualified through hmj.
  const qualifiedElsewhere =
    championship === "adac_hth" ? await hmjDkmQualifiedPredicate() : undefined;

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
  adacId: string | null;
  seasonPosition: number | null;
  seasonPoints: number | null;
  seasonRaces: number;
  qualified: boolean;
  withdrawn: boolean;
  nominated: boolean;
  /** Live times or an official result exist — the nomination can no longer be revoked. */
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
  const [rows, timed, resulted] = await Promise.all([
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
    db
      .selectDistinct({ driverId: endlauf26Results.driverId })
      .from(endlauf26Results)
      .innerJoin(endlauf26Events, eq(endlauf26Events.id, endlauf26Results.eventId))
      .where(eq(endlauf26Events.championship, championship)),
  ]);
  const lockedIds = new Set([...timed, ...resulted].map((t) => t.driverId));
  return rows.map(({ d, teamName }) => ({
    driverId: d.id,
    firstName: d.firstName,
    lastName: d.lastName,
    teamName,
    ageClass: d.ageClass,
    verband: d.verband,
    region: d.region,
    adacId: d.adacId,
    seasonPosition: d.seasonPosition,
    seasonPoints: num(d.seasonPoints),
    seasonRaces: d.seasonRaces,
    qualified: d.qualified,
    withdrawn: d.withdrawn,
    nominated: d.nominated,
    hasTimes: lockedIds.has(d.id),
  }));
}

/** Whether any live entry of (event, class) already has a time. */
async function classIsUnderway(eventId: number, ageClass: number): Promise<boolean> {
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
 * Renumber the live start order 1..n of one age class for every event of the
 * championship whose class has not started yet (no live times). The
 * relative order is preserved, so manual tweaks survive; withdrawn drivers
 * are skipped and a fresh entry with order 0 ends up first (the replacement
 * has the worst pre-Endlauf standing → starts first).
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
 * Nominate a Nachrücker (creates its live entries for every Endlauf,
 * starting first in classes that have not started yet) — or revoke a
 * nomination, which is only possible while no live time and no official
 * result exist for the driver.
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
    const [resulted] = await db
      .select({ id: endlauf26Results.id })
      .from(endlauf26Results)
      .where(eq(endlauf26Results.driverId, driverId))
      .limit(1);
    if (resulted) return "has_times";
    await db.delete(endlauf26Entries).where(eq(endlauf26Entries.driverId, driverId));
    await db
      .update(endlauf26Drivers)
      .set({ nominated: false, withdrawn: false })
      .where(eq(endlauf26Drivers.id, driverId));
  }

  await compactStartingOrders(d.championship, d.ageClass);
  return "ok";
}

/* ─────────────────────────── clubs ─────────────────────────── */

export async function getKnownClubs(championship: Endlauf26Championship): Promise<string[]> {
  const rows = await db
    .select({ name: endlauf26Teams.name })
    .from(endlauf26Teams)
    .where(eq(endlauf26Teams.championship, championship))
    .orderBy(asc(endlauf26Teams.name));
  return rows.map((r) => r.name);
}

/** Add a club that was missing from the imported lists. Idempotent. */
export async function createClub(
  championship: Endlauf26Championship,
  name: string,
): Promise<{ id: number; created: boolean }> {
  const inserted = await db
    .insert(endlauf26Teams)
    .values({ championship, name })
    .onConflictDoNothing()
    .returning({ id: endlauf26Teams.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };
  const [row] = await db
    .select({ id: endlauf26Teams.id })
    .from(endlauf26Teams)
    .where(and(eq(endlauf26Teams.championship, championship), eq(endlauf26Teams.name, name)))
    .limit(1);
  return { id: row.id, created: false };
}

/* ─────────────────────────── documents ─────────────────────────── */

export interface EndlaufDocumentMeta {
  id: number;
  championship: Endlauf26Championship;
  key: string;
  filename: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

export async function getDocuments(
  championship: Endlauf26Championship,
): Promise<EndlaufDocumentMeta[]> {
  const rows = await db
    .select({
      id: endlauf26Documents.id,
      championship: endlauf26Documents.championship,
      key: endlauf26Documents.key,
      filename: endlauf26Documents.filename,
      mime: endlauf26Documents.mime,
      size: endlauf26Documents.size,
      uploadedAt: endlauf26Documents.uploadedAt,
    })
    .from(endlauf26Documents)
    .where(eq(endlauf26Documents.championship, championship))
    .orderBy(asc(endlauf26Documents.key));
  return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() }));
}

export async function getDocument(id: number) {
  const [row] = await db
    .select()
    .from(endlauf26Documents)
    .where(eq(endlauf26Documents.id, id))
    .limit(1);
  return row ?? null;
}

export async function upsertDocument(doc: {
  championship: Endlauf26Championship;
  key: string;
  filename: string;
  mime: string;
  data: Buffer;
}): Promise<number> {
  const values = {
    championship: doc.championship,
    key: doc.key,
    filename: doc.filename,
    mime: doc.mime,
    size: doc.data.byteLength,
    data: doc.data,
    uploadedAt: new Date(),
  };
  const [row] = await db
    .insert(endlauf26Documents)
    .values(values)
    .onConflictDoUpdate({
      target: [endlauf26Documents.championship, endlauf26Documents.key],
      set: values,
    })
    .returning({ id: endlauf26Documents.id });
  return row.id;
}

export async function deleteDocument(id: number): Promise<boolean> {
  const res = await db
    .delete(endlauf26Documents)
    .where(eq(endlauf26Documents.id, id))
    .returning({ id: endlauf26Documents.id });
  return res.length > 0;
}

/* ───────────────────────── AI prediction cache ───────────────────────── */

export interface CachedPrediction {
  stateHash: string;
  text: string;
  model: string;
  createdAt: string;
}

export async function getCachedPrediction(driverId: number): Promise<CachedPrediction | null> {
  const [row] = await db
    .select()
    .from(endlauf26Predictions)
    .where(eq(endlauf26Predictions.driverId, driverId))
    .limit(1);
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

export async function saveCachedPrediction(p: {
  driverId: number;
  stateHash: string;
  text: string;
  model: string;
}): Promise<void> {
  await db
    .insert(endlauf26Predictions)
    .values(p)
    .onConflictDoUpdate({
      target: endlauf26Predictions.driverId,
      set: { stateHash: p.stateHash, text: p.text, model: p.model, createdAt: new Date() },
    });
}

/* ───────────────────────── AI quotes cache (teams page) ───────────────────────── */

export interface CachedQuotes {
  stateHash: string;
  quotes: string[];
  model: string;
  createdAt: string;
}

export async function getCachedQuotes(
  championship: Endlauf26Championship,
  subject: string,
): Promise<CachedQuotes | null> {
  const [row] = await db
    .select()
    .from(endlauf26Quotes)
    .where(and(eq(endlauf26Quotes.championship, championship), eq(endlauf26Quotes.subject, subject)))
    .limit(1);
  if (!row) return null;
  const quotes = Array.isArray(row.quotes)
    ? (row.quotes as unknown[]).filter((q): q is string => typeof q === "string")
    : [];
  return { stateHash: row.stateHash, quotes, model: row.model, createdAt: row.createdAt.toISOString() };
}

export async function saveCachedQuotes(p: {
  championship: Endlauf26Championship;
  subject: string;
  stateHash: string;
  quotes: string[];
  model: string;
}): Promise<void> {
  await db
    .insert(endlauf26Quotes)
    .values(p)
    .onConflictDoUpdate({
      target: [endlauf26Quotes.championship, endlauf26Quotes.subject],
      set: { stateHash: p.stateHash, quotes: p.quotes, model: p.model, createdAt: new Date() },
    });
}
