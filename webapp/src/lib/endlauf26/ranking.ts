/**
 * Endläufe 2026 — pure ranking + championship logic (no DB / React imports).
 *
 * Two championships with different rules:
 *
 *  hmj (Hessische Jugend-Landesmeisterschaft)
 *   - 5 regular-season races + 2 Endläufe (Langgöns 1/2, factor 1.25)
 *   - best 6 of 7 count → exactly one Streichergebnis (lowest effective
 *     points; tie → the later race is struck)
 *   - ties: total points → countback (more better positions among counted
 *     results) → younger driver wins → otherwise shared place
 *
 *  adac_hth (ADAC Hessen-Thüringen)
 *   - the field is the final start list (data/endlauf26/adac-hth_endlauf2026.csv)
 *   - regional-championship position counts as one race (position → points;
 *     several drivers may carry the same position/points)
 *   - 3 Endläufe (Crumbach, Reinheim, Malsfeld ×1.1), no Streichergebnis
 *   - a driver who misses a (scored) Endlauf is excluded from the ranking
 *   - same tie-break chain as hmj
 *   - one DKM spot per class 1–5: the winner, or — if already qualified via
 *     hmj — the next driver who is not (`assignDkmSpots`)
 *
 *  Field changes (both championships):
 *   - `withdrawn` drivers announced they will not compete. They keep their
 *     row (season points are still shown) but are excluded from the ranking
 *     in both championships — unranked, sorted to the bottom of the class.
 *   - `nominated` drivers (Nachrücker) were not qualified via the list but
 *     fill a vacated spot. They are scored exactly like qualified drivers.
 *
 *  Endlauf results come exclusively from the imported official result lists
 *  (`endlauf26_results`): the printed position is the source of truth, the
 *  printed "ADAC Punkte" are the base points. Live timing never feeds the
 *  championship.
 */

export type Endlauf26Championship = "hmj" | "adac_hth";

export const ENDLAUF26_SLUGS: Record<Endlauf26Championship, string> = {
  hmj: "hmj",
  adac_hth: "adac-hth",
};

export const ENDLAUF26_LABELS: Record<
  Endlauf26Championship,
  { short: string; long: string; subtitle: string }
> = {
  hmj: {
    short: "hmj",
    long: "hmj – Hessische Meisterschaft",
    subtitle:
      "Hessische Jugend-Landesmeisterschaft im Kartslalom · 5 Läufe + 2 Endläufe (×1,25) · beste 6 zählen",
  },
  adac_hth: {
    short: "ADAC Hessen-Thüringen",
    long: "ADAC Hessen-Thüringen Endläufe",
    subtitle:
      "Regionen Nord · Süd · Ost · Saisonplatz + 3 Endläufe (Malsfeld ×1,1) · alle Endläufe Pflicht",
  },
};

export function championshipFromSlug(
  slug: string,
): Endlauf26Championship | null {
  for (const key of Object.keys(ENDLAUF26_SLUGS) as Endlauf26Championship[]) {
    if (ENDLAUF26_SLUGS[key] === slug) return key;
  }
  return null;
}

export const ENDLAUF26_AGE_CLASSES = [1, 2, 3, 4, 5, 6] as const;

export function ageClassName(n: number): string {
  return `Klasse ${n}`;
}

/* ─────────────────── national finals (DKM der dmsj) ─────────────────── */

/**
 * hmj: the top positions of the final hmj standings per age class go to the
 * "Deutsche Kartslalom Meisterschaft der dmsj" (national finals).
 * Class 6 has no national final.
 */
export const HMJ_DKM_SPOTS: Readonly<Record<number, number>> = {
  1: 2,
  2: 3,
  3: 3,
  4: 3,
  5: 2,
};

/**
 * adac_hth: the ADAC Hessen-Thüringen Endläufe award the last DKM spot per
 * age class. It goes to the winner — unless the winner is already qualified
 * through the hmj standings, then to the runner-up, and so on.
 */
export const ADAC_DKM_SPOTS: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
};

export const DKM_NAME = "Deutsche Kartslalom Meisterschaft der dmsj";

/** Number of national-finals spots an age class awards in this championship (0 for class 6). */
export function dkmSpots(championship: Endlauf26Championship, ageClass: number): number {
  const table = championship === "hmj" ? HMJ_DKM_SPOTS : ADAC_DKM_SPOTS;
  return table[ageClass] ?? 0;
}

/**
 * Championship a driver holds a DKM spot through. In the adac_hth table a
 * driver already qualified via hmj is marked `"hmj"` and does not consume
 * the ADAC spot.
 */
export type DkmVia = Endlauf26Championship;

/**
 * Assign the national-finals spots of every age class (sets `row.dkmVia`).
 *
 *  - hmj: ranks 1…n (n = HMJ_DKM_SPOTS) qualify.
 *  - adac_hth: drivers for whom `qualifiedElsewhere` is true are marked
 *    `"hmj"`; the best-ranked remaining driver(s) of the class get the ADAC
 *    spot (a genuine dead heat on that rank flags all of them).
 *
 * Excluded / unranked rows never qualify.
 */
export function assignDkmSpots(
  championship: Endlauf26Championship,
  rows: Endlauf26Row[],
  qualifiedElsewhere: (row: Endlauf26Row) => boolean = () => false,
): void {
  const byClass = new Map<number, Endlauf26Row[]>();
  for (const r of rows) {
    r.dkmVia = null;
    byClass.set(r.ageClass, [...(byClass.get(r.ageClass) ?? []), r]);
  }
  for (const [ageClass, list] of byClass) {
    const spots = dkmSpots(championship, ageClass);
    if (championship === "hmj") {
      for (const r of list) {
        if (!r.excluded && r.rank !== null && r.rank <= spots) r.dkmVia = "hmj";
      }
      continue;
    }
    const contenders: Endlauf26Row[] = [];
    for (const r of list) {
      if (r.excluded || r.rank === null) continue;
      if (qualifiedElsewhere(r)) r.dkmVia = "hmj";
      else contenders.push(r);
    }
    if (spots <= 0 || contenders.length === 0) continue;
    // The `spots` best ranks among the contenders; every row on such a rank gets a spot.
    const ranks = [...new Set(contenders.map((r) => r.rank as number))]
      .sort((a, b) => a - b)
      .slice(0, spots);
    for (const r of contenders) if (ranks.includes(r.rank as number)) r.dkmVia = "adac_hth";
  }
}

/* ────────────────────────────── points ────────────────────────────── */

const POINTS_TABLE: readonly number[] = [
  0, 40, 37, 35, 33, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18,
  17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

/** Points for a finishing place; everyone beyond place 35 who started gets 1. */
export function pointsForPlace(place: number | null): number {
  if (place === null || place < 1) return 0;
  return POINTS_TABLE[place] ?? 1;
}

/* ─────────────────────────── live ranking ─────────────────────────── */

export interface EndlaufRunValue {
  timeSeconds: number | null;
  penaltySeconds: number;
}

export interface EndlaufEntryRuns {
  test: EndlaufRunValue | null;
  first: EndlaufRunValue | null;
  second: EndlaufRunValue | null;
}

export interface EndlaufRankable {
  entryId: number;
  driverId: number;
  ageClass: number;
  runs: EndlaufEntryRuns;
}

export interface EndlaufLivePositions {
  entryId: number;
  /** Standing in Wertungslauf 1 (null without a time). */
  positionRun1: number | null;
  /** Standing in Wertungslauf 2 alone. */
  positionRun2: number | null;
  /**
   * Overall standing: Lauf 1 + Lauf 2 incl. penalties (the official
   * Kart-Slalom scoring). Drivers with fewer completed runs rank behind
   * those with more, so the board reads like a provisional classification
   * while Lauf 2 is still running.
   */
  positionLive: number | null;
  /** Sum of the completed Wertungsläufe incl. penalties. */
  liveTotal: number | null;
  completedRuns: number;
  started: boolean;
}

export function runTotal(r: EndlaufRunValue | null): number | null {
  if (!r || r.timeSeconds === null) return null;
  return r.timeSeconds + r.penaltySeconds;
}

/** Lauf 1 + Lauf 2 incl. penalties over the runs that exist (null without any). */
export function liveTotal(runs: EndlaufEntryRuns): number | null {
  const a = runTotal(runs.first);
  const b = runTotal(runs.second);
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export function completedRuns(runs: EndlaufEntryRuns): number {
  return (runTotal(runs.first) === null ? 0 : 1) + (runTotal(runs.second) === null ? 0 : 1);
}

/** Shared positions for equal values; entries without value get null. */
function positionsFor(
  values: { entryId: number; value: number | null }[],
): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const sorted = values
    .filter((v) => v.value !== null)
    .sort((a, b) => (a.value as number) - (b.value as number));
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j += 1;
    for (let k = i; k < j; k++) out.set(sorted[k].entryId, i + 1);
    i = j;
  }
  for (const v of values) if (!out.has(v.entryId)) out.set(v.entryId, null);
  return out;
}

/** Overall live positions: more completed runs first, then lower total; ties share. */
function livePositionsFor(
  values: { entryId: number; completed: number; total: number | null }[],
): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const sorted = values
    .filter((v) => v.total !== null)
    .sort((a, b) => b.completed - a.completed || (a.total as number) - (b.total as number));
  const same = (a: (typeof sorted)[number], b: (typeof sorted)[number]) =>
    a.completed === b.completed && a.total === b.total;
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && same(sorted[j], sorted[i])) j += 1;
    for (let k = i; k < j; k++) out.set(sorted[k].entryId, i + 1);
    i = j;
  }
  for (const v of values) if (!out.has(v.entryId)) out.set(v.entryId, null);
  return out;
}

/**
 * Compute the three live positions for every entry of one age class.
 * Times are compared including penalty seconds.
 */
export function rankEndlaufEntries<T extends EndlaufRankable>(
  entries: readonly T[],
): EndlaufLivePositions[] {
  const p1 = positionsFor(
    entries.map((e) => ({ entryId: e.entryId, value: runTotal(e.runs.first) })),
  );
  const p2 = positionsFor(
    entries.map((e) => ({ entryId: e.entryId, value: runTotal(e.runs.second) })),
  );
  const pl = livePositionsFor(
    entries.map((e) => ({
      entryId: e.entryId,
      completed: completedRuns(e.runs),
      total: liveTotal(e.runs),
    })),
  );
  return entries.map((e) => {
    const total = liveTotal(e.runs);
    return {
      entryId: e.entryId,
      positionRun1: p1.get(e.entryId) ?? null,
      positionRun2: p2.get(e.entryId) ?? null,
      positionLive: pl.get(e.entryId) ?? null,
      liveTotal: total,
      completedRuns: completedRuns(e.runs),
      started: total !== null,
    };
  });
}

/* ─────────────────────────── championship ─────────────────────────── */

export interface EndlaufEventInfo {
  eventId: number;
  number: number;
  slug: string;
  name: string;
  factor: number;
}

export interface SeasonResultInput {
  raceNumber: number;
  finishPosition: number;
  points: number;
}

export interface EndlaufResultInput {
  eventId: number;
  /** Official position as printed on the result list. */
  finishPosition: number | null;
  /** Base points (printed "ADAC Punkte", fallback: scale), without factor. */
  pointsAwarded: number;
  /** The driver appears on the result list with a position. */
  started: boolean;
  /**
   * True when an official result list has been imported for this driver's
   * age class at the event — only then does the Endlauf count at all.
   */
  scored: boolean;
}

export interface EndlaufDriverInput {
  driverId: number;
  firstName: string;
  lastName: string;
  teamId: number;
  teamName: string;
  ageClass: number;
  verband: string | null;
  region: string | null;
  adacId: string | null;
  yearOfBirth: number | null;
  seasonPosition: number | null;
  seasonPoints: number | null;
  seasonRaces: number;
  /** Will not compete in any Endlauf (announced beforehand). */
  withdrawn: boolean;
  /** Replacement driver nominated by hand (not qualified via the list). */
  nominated: boolean;
  seasonResults: SeasonResultInput[];
  endlaufResults: EndlaufResultInput[];
}

export type ScoreCellKind = "season" | "season-total" | "endlauf";

export interface ScoreCell {
  key: string;
  kind: ScoreCellKind;
  label: string;
  eventId: number | null;
  position: number | null;
  basePoints: number;
  factor: number;
  /** basePoints × factor */
  points: number;
  /** Streichergebnis */
  dropped: boolean;
  /** Whether the result exists yet (season races always; Endläufe once the result list is imported). */
  available: boolean;
  started: boolean;
}

export interface MovementCell {
  eventId: number;
  /** Rank before this Endlauf (null if excluded/unranked). */
  before: number | null;
  /** Rank after this Endlauf. */
  after: number | null;
  /** before − after (positive = gained places). Null when not yet available. */
  delta: number | null;
  available: boolean;
}

export interface Endlauf26Row {
  driverId: number;
  firstName: string;
  lastName: string;
  teamId: number;
  teamName: string;
  ageClass: number;
  verband: string | null;
  region: string | null;
  yearOfBirth: number | null;
  withdrawn: boolean;
  nominated: boolean;
  cells: ScoreCell[];
  totalPoints: number;
  rank: number | null;
  sharedRank: boolean;
  /** Not classified: withdrawn (both) or missed a scored Endlauf (adac_hth). */
  excluded: boolean;
  startedEndlaeufe: number;
  /** countback[i] = number of counted results with position i+1 */
  countback: number[];
  /** Rank before any Endlauf (season only). */
  rankBefore: number | null;
  movement: MovementCell[];
  /**
   * National finals: `"hmj"` = holds a DKM spot through the hmj standings,
   * `"adac_hth"` = gets the ADAC spot of the class, null = none.
   */
  dkmVia: DkmVia | null;
}

export interface ChampionshipOptions {
  /** Only consider Endlauf events with number ≤ this (for "before"/"after" snapshots). */
  upToEventNumber?: number;
  /** When false, no Streichergebnis is applied (hmj). Defaults to true. */
  applyDrops?: boolean;
  /**
   * adac_hth: whether a driver already holds a DKM spot through the hmj
   * standings (then the ADAC spot skips to the next driver).
   */
  qualifiedElsewhere?: (row: Endlauf26Row) => boolean;
}

const HMJ_DROP_COUNT = 1;

/** Tie-break rule: which results feed the countback. */
const COUNTBACK_INCLUDES_DROPPED = false;

function buildCells(
  championship: Endlauf26Championship,
  d: EndlaufDriverInput,
  events: readonly EndlaufEventInfo[],
  opts: ChampionshipOptions,
): ScoreCell[] {
  const cells: ScoreCell[] = [];

  if (championship === "hmj") {
    const byRace = new Map(d.seasonResults.map((r) => [r.raceNumber, r]));
    for (let n = 1; n <= 5; n++) {
      const r = byRace.get(n);
      cells.push({
        key: `s${n}`,
        kind: "season",
        label: `${n}. Lauf`,
        eventId: null,
        position: r?.finishPosition ?? null,
        basePoints: r?.points ?? 0,
        factor: 1,
        points: r?.points ?? 0,
        dropped: false,
        available: true,
        started: !!r,
      });
    }
  } else {
    const base = pointsForPlace(d.seasonPosition);
    cells.push({
      key: "season",
      kind: "season-total",
      label: "Saison",
      eventId: null,
      position: d.seasonPosition,
      basePoints: base,
      factor: 1,
      points: base,
      dropped: false,
      available: true,
      started: d.seasonPosition !== null,
    });
  }

  const byEvent = new Map(d.endlaufResults.map((r) => [r.eventId, r]));
  for (const ev of [...events].sort((a, b) => a.number - b.number)) {
    const r = byEvent.get(ev.eventId);
    const inScope =
      opts.upToEventNumber === undefined || ev.number <= opts.upToEventNumber;
    const available = inScope && !!r?.scored;
    const base = available ? r!.pointsAwarded : 0;
    cells.push({
      key: `e${ev.number}`,
      kind: "endlauf",
      label: ev.name,
      eventId: ev.eventId,
      position: available ? r!.finishPosition : null,
      basePoints: base,
      factor: ev.factor,
      points: round2(base * ev.factor),
      dropped: false,
      available,
      started: available ? r!.started : false,
    });
  }

  return cells;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyHmjDrops(cells: ScoreCell[], dropCount: number): void {
  const droppable = cells
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.available);
  if (dropCount <= 0 || droppable.length === 0) return;
  // lowest effective points first; tie → later race (higher index) first
  droppable.sort((a, b) => {
    if (a.c.points !== b.c.points) return a.c.points - b.c.points;
    return b.idx - a.idx;
  });
  for (const { c } of droppable.slice(0, dropCount)) c.dropped = true;
}

function countbackOf(cells: readonly ScoreCell[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    if (!c.available || !c.started || c.position === null) continue;
    if (c.dropped && !COUNTBACK_INCLUDES_DROPPED) continue;
    const idx = c.position - 1;
    while (out.length <= idx) out.push(0);
    out[idx] += 1;
  }
  return out;
}

function compareCountback(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return bv - av; // more better places first
  }
  return 0;
}

/**
 * Full comparator. Returns 0 only for a genuine dead heat (shared place).
 */
function compareRows(a: Endlauf26Row, b: Endlauf26Row): number {
  if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
  if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
  const cb = compareCountback(a.countback, b.countback);
  if (cb !== 0) return cb;
  if (
    a.yearOfBirth !== null &&
    b.yearOfBirth !== null &&
    a.yearOfBirth !== b.yearOfBirth
  ) {
    return b.yearOfBirth - a.yearOfBirth; // younger (higher year) wins
  }
  return 0;
}

function rankClass(rows: Endlauf26Row[]): void {
  rows.sort((a, b) => {
    const c = compareRows(a, b);
    if (c !== 0) return c;
    return a.lastName.localeCompare(b.lastName, "de");
  });
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && compareRows(rows[i], rows[j]) === 0) j += 1;
    for (let k = i; k < j; k++) {
      rows[k].rank = rows[k].excluded ? null : i + 1;
      rows[k].sharedRank = j - i > 1 && !rows[k].excluded;
    }
    i = j;
  }
}

function computeRowsForClass(
  championship: Endlauf26Championship,
  drivers: readonly EndlaufDriverInput[],
  events: readonly EndlaufEventInfo[],
  opts: ChampionshipOptions,
): Endlauf26Row[] {
  const applyDrops = opts.applyDrops !== false;
  const rows: Endlauf26Row[] = drivers.map((d) => {
    const cells = buildCells(championship, d, events, opts);
    if (championship === "hmj" && applyDrops) {
      applyHmjDrops(cells, HMJ_DROP_COUNT);
    }
    const totalPoints = round2(
      cells.reduce((s, c) => s + (c.dropped ? 0 : c.points), 0),
    );
    // Withdrawn drivers gave up their spot: unranked at the bottom in both
    // championships. ADAC additionally excludes anyone who misses a
    // scored Endlauf (all Endläufe are mandatory).
    const excluded =
      d.withdrawn ||
      (championship === "adac_hth" &&
        cells.some((c) => c.kind === "endlauf" && c.available && !c.started));
    return {
      driverId: d.driverId,
      firstName: d.firstName,
      lastName: d.lastName,
      teamId: d.teamId,
      teamName: d.teamName,
      ageClass: d.ageClass,
      verband: d.verband,
      region: d.region,
      yearOfBirth: d.yearOfBirth,
      withdrawn: d.withdrawn,
      nominated: d.nominated,
      cells,
      totalPoints,
      rank: null,
      sharedRank: false,
      excluded,
      startedEndlaeufe: cells.filter((c) => c.kind === "endlauf" && c.started)
        .length,
      countback: countbackOf(cells),
      rankBefore: null,
      movement: [],
      dkmVia: null,
    };
  });
  rankClass(rows);
  return rows;
}

/**
 * Compute the championship table for every age class, including the
 * "before Endlauf" rank and the per-Endlauf movement.
 *
 * Rows are grouped by age class (ascending) and ranked within the class.
 */
export function computeEndlauf26Championship(
  championship: Endlauf26Championship,
  drivers: readonly EndlaufDriverInput[],
  events: readonly EndlaufEventInfo[],
  opts: ChampionshipOptions = {},
): Endlauf26Row[] {
  const sortedEvents = [...events].sort((a, b) => a.number - b.number);
  const byClass = new Map<number, EndlaufDriverInput[]>();
  for (const d of drivers) {
    const arr = byClass.get(d.ageClass) ?? [];
    arr.push(d);
    byClass.set(d.ageClass, arr);
  }

  const result: Endlauf26Row[] = [];
  for (const ageClass of [...byClass.keys()].sort((a, b) => a - b)) {
    const classDrivers = byClass.get(ageClass)!;
    const finalRows = computeRowsForClass(
      championship,
      classDrivers,
      sortedEvents,
      opts,
    );

    // Snapshots: before any Endlauf, then after each Endlauf in order.
    const snapshots: Map<number, number | null>[] = [];
    const snapshotOpts = (upTo: number): ChampionshipOptions => ({
      ...opts,
      upToEventNumber: upTo,
    });
    snapshots.push(
      rankMap(
        computeRowsForClass(championship, classDrivers, sortedEvents, snapshotOpts(0)),
      ),
    );
    for (const ev of sortedEvents) {
      snapshots.push(
        rankMap(
          computeRowsForClass(
            championship,
            classDrivers,
            sortedEvents,
            snapshotOpts(ev.number),
          ),
        ),
      );
    }

    for (const row of finalRows) {
      row.rankBefore = snapshots[0].get(row.driverId) ?? null;
      row.movement = sortedEvents.map((ev, idx) => {
        const cell = row.cells.find((c) => c.eventId === ev.eventId);
        const available = !!cell?.available;
        const before = snapshots[idx].get(row.driverId) ?? null;
        const after = snapshots[idx + 1].get(row.driverId) ?? null;
        const delta =
          available && before !== null && after !== null ? before - after : null;
        return { eventId: ev.eventId, before, after, delta, available };
      });
    }
    result.push(...finalRows);
  }
  assignDkmSpots(championship, result, opts.qualifiedElsewhere);
  return result;
}

function rankMap(rows: readonly Endlauf26Row[]): Map<number, number | null> {
  return new Map(rows.map((r) => [r.driverId, r.rank]));
}
