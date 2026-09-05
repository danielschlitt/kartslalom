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
 *   - regular-season standing counts as one race (position → points)
 *   - 3 Endläufe (Crumbach, Reinheim, Malsfeld ×1.1), no Streichergebnis
 *   - a driver who misses a (finalized) Endlauf is excluded from the ranking
 *   - same tie-break chain as hmj
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
  /** Standing after Wertungslauf 1 (null without a time). */
  positionRun1: number | null;
  /** Standing after Wertungslauf 2. */
  positionRun2: number | null;
  /** Overall standing: best of both runs incl. penalties. */
  positionLive: number | null;
  bestTotal: number | null;
  started: boolean;
}

function runTotal(r: EndlaufRunValue | null): number | null {
  if (!r || r.timeSeconds === null) return null;
  return r.timeSeconds + r.penaltySeconds;
}

export function bestRunTotal(runs: EndlaufEntryRuns): number | null {
  const a = runTotal(runs.first);
  const b = runTotal(runs.second);
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
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
  const pl = positionsFor(
    entries.map((e) => ({ entryId: e.entryId, value: bestRunTotal(e.runs) })),
  );
  return entries.map((e) => {
    const best = bestRunTotal(e.runs);
    return {
      entryId: e.entryId,
      positionRun1: p1.get(e.entryId) ?? null,
      positionRun2: p2.get(e.entryId) ?? null,
      positionLive: pl.get(e.entryId) ?? null,
      bestTotal: best,
      started: best !== null,
    };
  });
}

export interface EndlaufFinalResult {
  entryId: number;
  finishPosition: number | null;
  /** Base points from the scale (event factor is applied later). */
  pointsAwarded: number;
}

/** Official result of an age class: live overall position → base points. */
export function finalizeEndlaufClass<T extends EndlaufRankable>(
  entries: readonly T[],
): EndlaufFinalResult[] {
  return rankEndlaufEntries(entries).map((p) => ({
    entryId: p.entryId,
    finishPosition: p.positionLive,
    pointsAwarded: p.started ? pointsForPlace(p.positionLive) : 0,
  }));
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
  finishPosition: number | null;
  /** Base points (scale), without factor. */
  pointsAwarded: number;
  started: boolean;
  /** True when this driver's age class has been finalized for the event. */
  finalized: boolean;
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
  /** Whether the result exists yet (season races always; Endläufe once finalized). */
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
  cells: ScoreCell[];
  totalPoints: number;
  rank: number | null;
  sharedRank: boolean;
  /** adac_hth: missed a finalized Endlauf → not classified. */
  excluded: boolean;
  startedEndlaeufe: number;
  /** countback[i] = number of counted results with position i+1 */
  countback: number[];
  /** Rank before any Endlauf (season only). */
  rankBefore: number | null;
  movement: MovementCell[];
}

export interface ChampionshipOptions {
  /** Only consider Endlauf events with number ≤ this (for "before"/"after" snapshots). */
  upToEventNumber?: number;
  /** When false, no Streichergebnis is applied (hmj). Defaults to true. */
  applyDrops?: boolean;
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
    const available = inScope && !!r?.finalized;
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
    const excluded =
      championship === "adac_hth" &&
      cells.some((c) => c.kind === "endlauf" && c.available && !c.started);
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
  return result;
}

function rankMap(rows: readonly Endlauf26Row[]): Map<number, number | null> {
  return new Map(rows.map((r) => [r.driverId, r.rank]));
}

/* ───────────────────────────── club stats ───────────────────────────── */

export interface ClubStatRow {
  teamId: number;
  teamName: string;
  driverCount: number;
  /** Sum of championship totals (incl. Streichergebnisse rules). */
  totalPoints: number;
  avgPoints: number;
  /** Endlauf wins (finish position 1). */
  endlaufWins: number;
  /** Endlauf podiums (1–3). */
  endlaufPodiums: number;
  /** Drivers currently leading their class. */
  classLeaders: number;
  /** Points from Endläufe only (effective, incl. factor). */
  endlaufPoints: number;
}

export function computeClubStats(rows: readonly Endlauf26Row[]): ClubStatRow[] {
  const byTeam = new Map<number, ClubStatRow>();
  for (const r of rows) {
    let s = byTeam.get(r.teamId);
    if (!s) {
      s = {
        teamId: r.teamId,
        teamName: r.teamName,
        driverCount: 0,
        totalPoints: 0,
        avgPoints: 0,
        endlaufWins: 0,
        endlaufPodiums: 0,
        classLeaders: 0,
        endlaufPoints: 0,
      };
      byTeam.set(r.teamId, s);
    }
    s.driverCount += 1;
    s.totalPoints = round2(s.totalPoints + r.totalPoints);
    if (r.rank === 1) s.classLeaders += 1;
    for (const c of r.cells) {
      if (c.kind !== "endlauf" || !c.available) continue;
      s.endlaufPoints = round2(s.endlaufPoints + c.points);
      if (c.position === 1) s.endlaufWins += 1;
      if (c.position !== null && c.position <= 3) s.endlaufPodiums += 1;
    }
  }
  const out = [...byTeam.values()];
  for (const s of out) s.avgPoints = round2(s.totalPoints / s.driverCount);
  out.sort((a, b) => b.totalPoints - a.totalPoints || a.teamName.localeCompare(b.teamName, "de"));
  return out;
}
