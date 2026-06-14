/**
 * Pure ranking + championship logic. No DB or React imports here so it stays
 * easy to unit-test and re-use on both server and client.
 */

export type RunType = "test" | "first" | "second";
export type DriverType = "championship" | "vorstarter" | "gaststarter";

export interface RunValue {
  timeSeconds: number | null;
  penaltySeconds: number;
}

export interface EntryRuns {
  test: RunValue | null;
  first: RunValue | null;
  second: RunValue | null;
}

export interface RankableEntry {
  entryId: number;
  driverId: number;
  driverType: DriverType;
  ageClassId: number;
  runs: EntryRuns;
  /** Stored points awarded for this entry (used when no live recomputation). */
  storedPointsAwarded?: number;
  /** Stored finish position (used when no live recomputation). */
  storedFinishPosition?: number | null;
}

export type Metric = "first" | "second" | "best" | "sum";
export type PenaltyMode = "with" | "without" | "only";

export interface ViewMode {
  metric: Metric;
  penaltyMode: PenaltyMode;
}

export const DEFAULT_VIEW: ViewMode = { metric: "best", penaltyMode: "with" };

const SCORING_RUNS: RunType[] = ["first", "second"];

/**
 * Compute the metric a single entry is ranked by under the given view.
 * Returns null when the entry has no usable time for that view.
 */
export function entryMetricValue(
  runs: EntryRuns,
  view: ViewMode,
): number | null {
  const r1 = runs.first;
  const r2 = runs.second;

  const value = (r: RunValue | null): number | null => {
    if (!r) return null;
    if (view.penaltyMode === "only") return r.penaltySeconds;
    if (r.timeSeconds === null) return null;
    return view.penaltyMode === "with"
      ? r.timeSeconds + r.penaltySeconds
      : r.timeSeconds;
  };

  switch (view.metric) {
    case "first":
      return value(r1);
    case "second":
      return value(r2);
    case "best": {
      const a = value(r1);
      const b = value(r2);
      if (a === null) return b;
      if (b === null) return a;
      return Math.min(a, b);
    }
    case "sum": {
      const a = value(r1);
      const b = value(r2);
      if (a === null && b === null) return null;
      // If only one run exists we still want the entry rankable.
      return (a ?? 0) + (b ?? 0);
    }
  }
}

export interface RankedEntry<T extends RankableEntry = RankableEntry> {
  entry: T;
  metricValue: number | null;
  finishPosition: number | null;
  pointsAwarded: number;
  /** True when a championship driver could not be ranked (no time). */
  isPending: boolean;
}

/**
 * Rank all entries in a single age class for a single race.
 * - All driver types are included in finish position.
 * - Only championship drivers consume points slots.
 * - Entries without a metric value rank after timed entries (DNF-style) and
 *   receive 0 points.
 */
export function rankRaceEntries<T extends RankableEntry>(
  entries: readonly T[],
  pointsScale: ReadonlyMap<number, number>,
  view: ViewMode = DEFAULT_VIEW,
): RankedEntry<T>[] {
  const withMetric = entries.map((entry) => ({
    entry,
    metricValue: entryMetricValue(entry.runs, view),
  }));

  withMetric.sort((a, b) => {
    const av = a.metricValue;
    const bv = b.metricValue;
    if (av === null && bv === null) return a.entry.driverId - b.entry.driverId;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.entry.driverId - b.entry.driverId;
    return av - bv;
  });

  let championshipRank = 0;

  return withMetric.map((row, idx) => {
    const ranked = row.metricValue !== null;
    const finishPosition = ranked ? idx + 1 : null;
    let pointsAwarded = 0;

    if (ranked && row.entry.driverType === "championship") {
      championshipRank += 1;
      pointsAwarded = pointsScale.get(championshipRank) ?? 0;
    }

    return {
      entry: row.entry,
      metricValue: row.metricValue,
      finishPosition,
      pointsAwarded,
      isPending: row.entry.driverType === "championship" && !ranked,
    };
  });
}

const EMPTY_POINTS_SCALE: ReadonlyMap<number, number> = new Map();

/**
 * Rank an age class purely for live display: positions are derived from run
 * times like {@link rankRaceEntries}, but no championship points are awarded.
 * Use this on the /live page so the provisional view never implies points
 * that have not been officially assigned yet.
 */
export function rankLiveStandings<T extends RankableEntry>(
  entries: readonly T[],
  view: ViewMode = DEFAULT_VIEW,
): RankedEntry<T>[] {
  const ranked = rankRaceEntries(entries, EMPTY_POINTS_SCALE, view);
  return ranked.map((r) => ({ ...r, pointsAwarded: 0 }));
}

export interface ManualResult {
  entryId: number;
  finishPosition: number | null;
  pointsAwarded: number;
}

/**
 * Convert a set of manually-assigned finishing positions for one age class
 * into the points each entry should receive.
 *
 * - Only championship drivers consume points slots; vorstarter/gaststarter
 *   keep their assigned position but never receive points.
 * - Entries with `null` position (DNF / not entered) get 0 points.
 * - Slot order follows the assigned positions (1, 2, 3, ...) — gaps and ties
 *   in the input are tolerated; the caller is expected to validate uniqueness
 *   before invoking this helper.
 */
export function assignPointsFromManualPositions<T extends RankableEntry>(
  entries: readonly T[],
  positionsByEntryId: ReadonlyMap<number, number | null>,
  pointsScale: ReadonlyMap<number, number>,
): ManualResult[] {
  const withPos = entries.map((entry) => ({
    entry,
    finishPosition: positionsByEntryId.get(entry.entryId) ?? null,
  }));

  withPos.sort((a, b) => {
    const ap = a.finishPosition;
    const bp = b.finishPosition;
    if (ap === null && bp === null) return a.entry.driverId - b.entry.driverId;
    if (ap === null) return 1;
    if (bp === null) return -1;
    if (ap === bp) return a.entry.driverId - b.entry.driverId;
    return ap - bp;
  });

  let championshipRank = 0;
  return withPos.map((row) => {
    let pointsAwarded = 0;
    if (
      row.finishPosition !== null &&
      row.entry.driverType === "championship"
    ) {
      championshipRank += 1;
      pointsAwarded = pointsScale.get(championshipRank) ?? 0;
    }
    return {
      entryId: row.entry.entryId,
      finishPosition: row.finishPosition,
      pointsAwarded,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Highlights                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export type RunColumn = "raw" | "total";

export interface RunHighlight {
  /** Cell is the fastest in its own run (run1 raw, run1 total, …). */
  fastestInRun: { raw: boolean; total: boolean };
  /** Cell belongs to the run that is the overall best across run1/run2. */
  fastestOverall: { raw: boolean; total: boolean };
}

export interface EntryHighlights {
  first: RunHighlight;
  second: RunHighlight;
}

interface BestPerColumn {
  run1Raw: number | null;
  run1Total: number | null;
  run2Raw: number | null;
  run2Total: number | null;
  bestRaw: number | null;
  bestTotal: number | null;
}

/**
 * Compute per-class fastest-times metadata so the UI can colour cells.
 * Green = fastest in that column for that run.
 * Violet = belongs to the run that holds the overall fastest time across
 * both Wertungsläufe (raw or total).
 */
export function computeHighlights<T extends RankableEntry>(
  entries: readonly T[],
): Map<number, EntryHighlights> {
  const best: BestPerColumn = {
    run1Raw: null,
    run1Total: null,
    run2Raw: null,
    run2Total: null,
    bestRaw: null,
    bestTotal: null,
  };

  const min = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.min(a, b);

  for (const e of entries) {
    const r1 = e.runs.first;
    const r2 = e.runs.second;
    if (r1?.timeSeconds !== null && r1?.timeSeconds !== undefined) {
      best.run1Raw = min(best.run1Raw, r1.timeSeconds);
      best.run1Total = min(best.run1Total, r1.timeSeconds + r1.penaltySeconds);
    }
    if (r2?.timeSeconds !== null && r2?.timeSeconds !== undefined) {
      best.run2Raw = min(best.run2Raw, r2.timeSeconds);
      best.run2Total = min(best.run2Total, r2.timeSeconds + r2.penaltySeconds);
    }
  }

  best.bestRaw = min(best.run1Raw, best.run2Raw);
  best.bestTotal = min(best.run1Total, best.run2Total);

  const out = new Map<number, EntryHighlights>();

  for (const e of entries) {
    const hl: EntryHighlights = {
      first: {
        fastestInRun: { raw: false, total: false },
        fastestOverall: { raw: false, total: false },
      },
      second: {
        fastestInRun: { raw: false, total: false },
        fastestOverall: { raw: false, total: false },
      },
    };

    const mark = (
      r: RunValue | null,
      slot: RunHighlight,
      runRaw: number | null,
      runTotal: number | null,
    ) => {
      if (!r || r.timeSeconds === null) return;
      const total = r.timeSeconds + r.penaltySeconds;
      slot.fastestInRun.raw = runRaw !== null && r.timeSeconds === runRaw;
      slot.fastestInRun.total = runTotal !== null && total === runTotal;
      slot.fastestOverall.raw =
        best.bestRaw !== null && r.timeSeconds === best.bestRaw;
      slot.fastestOverall.total =
        best.bestTotal !== null && total === best.bestTotal;
    };

    mark(e.runs.first, hl.first, best.run1Raw, best.run1Total);
    mark(e.runs.second, hl.second, best.run2Raw, best.run2Total);

    out.set(e.entryId, hl);
  }

  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Championship                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DriverRaceResult {
  raceEventId: number;
  raceNumber: number;
  isHmj: boolean;
  pointsAwarded: number;
  participated: boolean;
  penaltySecondsTotal: number;
}

export interface DriverChampionshipInput {
  driverId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  ageClassId: number;
  ageClassName: string;
  driverType: DriverType;
  results: DriverRaceResult[];
}

export interface ChampionshipRow {
  driverId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  ageClassId: number;
  ageClassName: string;
  driverType: DriverType;
  /** Per-event points keyed by raceNumber. */
  perRace: Record<number, number>;
  /** Race numbers whose points have been dropped per series rules. */
  droppedRaceNumbers: number[];
  startedRaces: number;
  totalPoints: number;
  totalPenaltySeconds: number;
  rank: number;
}

export type Series = "hts" | "hmj";

export interface ChampionshipOptions {
  series: Series;
  /** Race numbers belonging to the series (used to scope perRace + drops). */
  seriesRaceNumbers: number[];
  /**
   * Race numbers that are eligible for "Streichergebnis" (drop). Only races
   * whose event is `completed` should be passed here — upcoming/live races
   * cannot be dropped because they have not happened yet.
   */
  completedRaceNumbers: readonly number[];
  /**
   * When `false`, no Streichergebnisse are applied — every race counts and
   * `totalPoints` sums all per-race points. Defaults to `true`.
   */
  applyDrops?: boolean;
}

const DROP_COUNT: Record<Series, number> = { hts: 2, hmj: 1 };

/**
 * Aggregate per-driver race results into a championship table with shared
 * ranks (ties keep the same rank, the next rank is offset by the tie size).
 *
 * Ranks are computed **per age class** — each Altersklasse has its own
 * championship, so #1 in Altersklasse I and #1 in Altersklasse II coexist.
 *
 * Vorstarter and Gaststarter never accrue championship points and are
 * filtered out.
 */
export function computeChampionship(
  drivers: readonly DriverChampionshipInput[],
  options: ChampionshipOptions,
): ChampionshipRow[] {
  const { seriesRaceNumbers, completedRaceNumbers } = options;
  const applyDrops = options.applyDrops !== false;
  const dropCount = applyDrops ? DROP_COUNT[options.series] : 0;
  const completedSet = new Set(completedRaceNumbers);

  const rows: ChampionshipRow[] = drivers
    .filter((d) => d.driverType === "championship")
    .map((d) => {
      const seriesResults = d.results.filter((r) =>
        seriesRaceNumbers.includes(r.raceNumber),
      );

      const perRace: Record<number, number> = {};
      for (const num of seriesRaceNumbers) perRace[num] = 0;
      for (const r of seriesResults) perRace[r.raceNumber] = r.pointsAwarded;

      const startedRaces = seriesResults.filter((r) => r.participated).length;
      const totalPenaltySeconds = seriesResults.reduce(
        (s, r) => s + r.penaltySecondsTotal,
        0,
      );

      const droppable = seriesRaceNumbers.filter((n) => completedSet.has(n));
      const dropped = pickDroppedRaces(droppable, perRace, dropCount);
      const totalPoints = seriesRaceNumbers.reduce((sum, num) => {
        if (dropped.includes(num)) return sum;
        return sum + (perRace[num] ?? 0);
      }, 0);

      return {
        driverId: d.driverId,
        firstName: d.firstName,
        lastName: d.lastName,
        teamName: d.teamName,
        ageClassId: d.ageClassId,
        ageClassName: d.ageClassName,
        driverType: d.driverType,
        perRace,
        droppedRaceNumbers: dropped,
        startedRaces,
        totalPoints,
        totalPenaltySeconds,
        rank: 0,
      };
    });

  // Bucket by age class, sort + rank within each class, then concatenate.
  const byClass = new Map<number, ChampionshipRow[]>();
  for (const row of rows) {
    const arr = byClass.get(row.ageClassId) ?? [];
    arr.push(row);
    byClass.set(row.ageClassId, arr);
  }

  const result: ChampionshipRow[] = [];
  for (const classRows of byClass.values()) {
    classRows.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.startedRaces !== a.startedRaces)
        return b.startedRaces - a.startedRaces;
      return a.lastName.localeCompare(b.lastName);
    });

    // Shared ranks within the class: ties get the same rank, the next rank
    // skips the tie size (1, 2, 3, 3, 5).
    let i = 0;
    while (i < classRows.length) {
      let j = i + 1;
      while (
        j < classRows.length &&
        classRows[j].totalPoints === classRows[i].totalPoints &&
        classRows[j].startedRaces === classRows[i].startedRaces
      ) {
        j += 1;
      }
      for (let k = i; k < j; k++) classRows[k].rank = i + 1;
      i = j;
    }
    result.push(...classRows);
  }

  return result;
}

/**
 * Drop the lowest-scoring `dropCount` races for a single driver from the
 * given pool of droppable race numbers. Ties at the threshold prefer the
 * higher race number so the latest bad result is the one struck.
 */
function pickDroppedRaces(
  droppable: number[],
  perRace: Record<number, number>,
  dropCount: number,
): number[] {
  if (dropCount <= 0 || droppable.length === 0) return [];
  const ordered = [...droppable].sort((a, b) => {
    const pa = perRace[a] ?? 0;
    const pb = perRace[b] ?? 0;
    if (pa !== pb) return pa - pb;
    return b - a;
  });
  return ordered.slice(0, Math.min(dropCount, ordered.length)).sort();
}
