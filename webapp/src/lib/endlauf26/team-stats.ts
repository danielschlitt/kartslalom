/**
 * Endläufe 2026 — group statistics (clubs and regions) and the deterministic
 * "facts" behind the social-media quotes. Pure: no DB / React imports.
 *
 * Everything here is derived from the championship rows
 * (`computeEndlauf26Championship`) and the imported official result lists
 * (for fastest laps and penalties). Rows are grouped either by club
 * (`teamId`) or by region — hmj: `verband` (Süd / Nord / DMV), ADAC:
 * `region` (Nord / Süd / Ost).
 */
import { fastestRun, fastestRunWithPenalty, type ScorableResult } from "./alt-scoring";
import {
  dkmSpots,
  qualifiesForDkm,
  type Endlauf26Championship,
  type Endlauf26Row,
  type EndlaufEventInfo,
} from "./ranking";

export type GroupKind = "team" | "region";

/** Result row subset the statistics need (a superset of `ScorableResult`). */
export interface StatResult extends ScorableResult {
  eventId: number;
  ageClass: number;
}

export interface GroupMovement {
  eventId: number;
  /** Sum of positive deltas (places gained). */
  gained: number;
  /** Sum of negative deltas as a positive number (places lost). */
  lost: number;
  /** gained − lost */
  net: number;
  /** Drivers of the group with an available movement at this event. */
  drivers: number;
}

export interface GroupStatRow {
  kind: GroupKind;
  /** teamId (as string) or region name */
  id: string;
  name: string;
  driverCount: number;
  /** Drivers that are ranked (not withdrawn / excluded). */
  rankedCount: number;
  /** Sum of championship totals. */
  totalPoints: number;
  avgPoints: number;
  /** Points from Endläufe only (effective, incl. factor, incl. dropped results). */
  endlaufPoints: number;
  /** Points from Endläufe that count (dropped Streichresultate excluded). */
  endlaufPointsCounted: number;
  /** endlaufPoints / driverCount */
  avgEndlaufPoints: number;
  /** endlaufPointsCounted / driverCount */
  avgEndlaufPointsCounted: number;
  /** Endlauf results of the group's drivers (started). */
  endlaufStarts: number;
  /** … of which struck as Streichresultat. */
  endlaufDropped: number;
  /** Endlauf wins (finish position 1). */
  endlaufWins: number;
  /** Endlauf podiums (1–3). */
  endlaufPodiums: number;
  /** Drivers currently leading their class. */
  classLeaders: number;
  /** Drivers currently on a championship podium (rank 1–3). */
  podiumPlaces: number;
  /** Drivers currently on a national-finals position (hmj only). */
  dkmQualifiers: number;
  /** Per Endlauf: places gained / lost by the group's drivers. */
  movement: GroupMovement[];
  gainedTotal: number;
  lostTotal: number;
  netMovement: number;
  /** Drivers with at least one available movement. */
  moversCount: number;
  /** netMovement / moversCount (0 when nobody moved yet). */
  netPerDriver: number;
  /** Fastest single run (no penalties) of an age class at an Endlauf. */
  fastestLaps: number;
  /** Fastest single run counted with its penalty seconds. */
  fastestLapsWithPenalty: number;
  /** Wertungsläufe with a time on the imported result lists. */
  runs: number;
  /** … of which without penalty seconds. */
  cleanRuns: number;
  /** Sum of penalty seconds of those runs. */
  penaltySeconds: number;
  /** Per age class: number of drivers. */
  perClass: Record<number, number>;
}

export function groupOf(
  championship: Endlauf26Championship,
  kind: GroupKind,
  row: Endlauf26Row,
): { id: string; name: string } {
  if (kind === "team") return { id: String(row.teamId), name: row.teamName };
  const name = (championship === "hmj" ? row.verband : row.region)?.trim() || "—";
  return { id: name, name };
}

export function regionLabel(championship: Endlauf26Championship): string {
  return championship === "hmj" ? "Verband" : "Region";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ───────────────────────────── fastest laps ───────────────────────────── */

export interface FastestLap {
  eventId: number;
  ageClass: number;
  /** All drivers sharing the fastest value (usually one). */
  driverIds: number[];
  value: number;
}

/**
 * Fastest single run per (event, age class) — once without and once with
 * penalty seconds. Only classes with an imported result list appear.
 */
export function computeFastestLaps(results: readonly StatResult[]): {
  raw: FastestLap[];
  withPenalty: FastestLap[];
} {
  const raw = new Map<string, FastestLap>();
  const pen = new Map<string, FastestLap>();
  const consider = (map: Map<string, FastestLap>, r: StatResult, v: number | null) => {
    if (v === null) return;
    const key = `${r.eventId}:${r.ageClass}`;
    const cur = map.get(key);
    if (!cur || v < cur.value) {
      map.set(key, { eventId: r.eventId, ageClass: r.ageClass, driverIds: [r.driverId], value: v });
    } else if (v === cur.value && !cur.driverIds.includes(r.driverId)) {
      cur.driverIds.push(r.driverId);
    }
  };
  for (const r of results) {
    consider(raw, r, fastestRun(r));
    consider(pen, r, fastestRunWithPenalty(r));
  }
  const sortLaps = (a: FastestLap, b: FastestLap) => a.eventId - b.eventId || a.ageClass - b.ageClass;
  return {
    raw: [...raw.values()].sort(sortLaps),
    withPenalty: [...pen.values()].sort(sortLaps),
  };
}

/* ───────────────────────────── group stats ───────────────────────────── */

export function computeGroupStats(
  championship: Endlauf26Championship,
  kind: GroupKind,
  rows: readonly Endlauf26Row[],
  events: readonly EndlaufEventInfo[],
  results: readonly StatResult[],
): GroupStatRow[] {
  const sortedEvents = [...events].sort((a, b) => a.number - b.number);
  const byGroup = new Map<string, GroupStatRow>();
  const groupOfDriver = new Map<number, string>();

  for (const r of rows) {
    const g = groupOf(championship, kind, r);
    groupOfDriver.set(r.driverId, g.id);
    let s = byGroup.get(g.id);
    if (!s) {
      s = {
        kind,
        id: g.id,
        name: g.name,
        driverCount: 0,
        rankedCount: 0,
        totalPoints: 0,
        avgPoints: 0,
        endlaufPoints: 0,
        endlaufPointsCounted: 0,
        avgEndlaufPoints: 0,
        avgEndlaufPointsCounted: 0,
        endlaufStarts: 0,
        endlaufDropped: 0,
        endlaufWins: 0,
        endlaufPodiums: 0,
        classLeaders: 0,
        podiumPlaces: 0,
        dkmQualifiers: 0,
        movement: sortedEvents.map((e) => ({
          eventId: e.eventId,
          gained: 0,
          lost: 0,
          net: 0,
          drivers: 0,
        })),
        gainedTotal: 0,
        lostTotal: 0,
        netMovement: 0,
        moversCount: 0,
        netPerDriver: 0,
        fastestLaps: 0,
        fastestLapsWithPenalty: 0,
        runs: 0,
        cleanRuns: 0,
        penaltySeconds: 0,
        perClass: {},
      };
      byGroup.set(g.id, s);
    }
    s.driverCount += 1;
    s.perClass[r.ageClass] = (s.perClass[r.ageClass] ?? 0) + 1;
    s.totalPoints = round2(s.totalPoints + r.totalPoints);
    if (!r.excluded && r.rank !== null) {
      s.rankedCount += 1;
      if (r.rank === 1) s.classLeaders += 1;
      if (r.rank <= 3) s.podiumPlaces += 1;
      if (qualifiesForDkm(championship, r.ageClass, r.rank)) s.dkmQualifiers += 1;
    }
    for (const c of r.cells) {
      if (c.kind !== "endlauf" || !c.available) continue;
      s.endlaufPoints = round2(s.endlaufPoints + c.points);
      if (c.dropped) s.endlaufDropped += 1;
      else s.endlaufPointsCounted = round2(s.endlaufPointsCounted + c.points);
      if (c.started) s.endlaufStarts += 1;
      if (c.position === 1) s.endlaufWins += 1;
      if (c.position !== null && c.position <= 3) s.endlaufPodiums += 1;
    }
    let moved = false;
    for (const m of r.movement) {
      if (!m.available || m.delta === null) continue;
      const gm = s.movement.find((x) => x.eventId === m.eventId);
      if (!gm) continue;
      moved = true;
      gm.drivers += 1;
      if (m.delta > 0) gm.gained += m.delta;
      else if (m.delta < 0) gm.lost += -m.delta;
      gm.net += m.delta;
    }
    if (moved) s.moversCount += 1;
  }

  // Runs / penalties from the result lists
  for (const r of results) {
    const gid = groupOfDriver.get(r.driverId);
    if (gid === undefined) continue;
    const s = byGroup.get(gid)!;
    for (const [t, p] of [
      [r.run1Time, r.run1Penalty],
      [r.run2Time, r.run2Penalty],
    ] as const) {
      if (t === null) continue;
      s.runs += 1;
      if (p === 0) s.cleanRuns += 1;
      s.penaltySeconds += p;
    }
  }

  // Fastest laps
  const laps = computeFastestLaps(results);
  for (const l of laps.raw) {
    for (const d of l.driverIds) {
      const gid = groupOfDriver.get(d);
      if (gid !== undefined) byGroup.get(gid)!.fastestLaps += 1;
    }
  }
  for (const l of laps.withPenalty) {
    for (const d of l.driverIds) {
      const gid = groupOfDriver.get(d);
      if (gid !== undefined) byGroup.get(gid)!.fastestLapsWithPenalty += 1;
    }
  }

  const out = [...byGroup.values()];
  for (const s of out) {
    s.avgPoints = round2(s.totalPoints / s.driverCount);
    s.avgEndlaufPoints = round2(s.endlaufPoints / s.driverCount);
    s.avgEndlaufPointsCounted = round2(s.endlaufPointsCounted / s.driverCount);
    s.gainedTotal = s.movement.reduce((a, m) => a + m.gained, 0);
    s.lostTotal = s.movement.reduce((a, m) => a + m.lost, 0);
    s.netMovement = s.gainedTotal - s.lostTotal;
    s.netPerDriver = s.moversCount ? round2(s.netMovement / s.moversCount) : 0;
  }
  out.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name, "de"));
  return out;
}

/* ─────────────────────────── subject facts ─────────────────────────── */

export interface RateComparison {
  /** Absolute count within the subject group. */
  subject: number;
  /** Absolute count in the rest of the field. */
  others: number;
  /** subject / subjectDrivers (0–1). */
  rateSubject: number;
  /** others / otherDrivers (0–1). */
  rateOthers: number;
  /** rateSubject / rateOthers (null when the rest has none). */
  factor: number | null;
  /** (factor − 1) × 100 → "xx % wahrscheinlicher"; null when the rest has none. */
  relativeMorePercent: number | null;
}

export interface ShareFact {
  subject: number;
  total: number;
  /** subject / total × 100 (0 when total is 0). */
  percent: number;
}

export interface GroupRankFact {
  name: string;
  value: number;
}

export interface SubjectFacts {
  championship: Endlauf26Championship;
  kind: GroupKind;
  subjectName: string;
  /** "Hessenmeister" / "ADAC Hessen-Thüringen Meister" */
  titleName: string;
  /** Endläufe with at least one scored class, in order. */
  scoredEvents: string[];
  /** Endläufe not scored yet (nothing imported). */
  openEvents: string[];
  /** Number of (event, class) combinations with a result list. */
  scoredClassLists: number;
  fieldDrivers: number;
  subjectDrivers: number;
  /** subjectDrivers / fieldDrivers × 100 */
  shareOfField: number;
  /** Groups of the same kind in total (e.g. 25 clubs). */
  groupCount: number;
  /** Rank of the subject among the groups by total points (1 = best). */
  rankByPoints: number;
  rankByAvgPoints: number;
  avgPointsSubject: number;
  avgPointsOthers: number;
  classLeaders: RateComparison;
  podium: RateComparison;
  /** Null for adac_hth (no national finals). */
  dkm: (RateComparison & { spotsTotal: number }) | null;
  endlaufWins: ShareFact;
  endlaufPodiums: ShareFact;
  endlaufPoints: ShareFact;
  fastestLaps: ShareFact;
  fastestLapsWithPenalty: ShareFact;
  penalties: {
    runsSubject: number;
    runsOthers: number;
    cleanRunPercentSubject: number;
    cleanRunPercentOthers: number;
    avgPenaltyPerRunSubject: number;
    avgPenaltyPerRunOthers: number;
  };
  movement: {
    gained: number;
    lost: number;
    net: number;
    moversCount: number;
    netPerDriver: number;
    /** Rank among all groups by net movement (1 = most places gained). */
    rankByNet: number;
    rankByNetPerDriver: number;
    /** Groups with a better net movement than the subject, best first. */
    betterByNet: GroupRankFact[];
    /** Groups with a better net movement per driver, best first. */
    betterByNetPerDriver: GroupRankFact[];
    /** Per Endlauf breakdown (name → net). */
    perEvent: { event: string; gained: number; lost: number; net: number }[];
  };
  /** Best climber within the subject group (sum of deltas over all Endläufe). */
  bestClimber: { name: string; ageClass: number; delta: number; rank: number | null } | null;
  /** Subject's drivers currently leading a class. */
  leaders: { name: string; ageClass: number }[];
  /** Subject's drivers on a DKM position (hmj). */
  dkmDrivers: { name: string; ageClass: number; rank: number }[];
  /** Fastest laps of the subject (event / class / driver / seconds). */
  fastestLapList: { event: string; ageClass: number; name: string; seconds: number; withPenalty: boolean }[];
}

export const TITLE_NAME: Record<Endlauf26Championship, string> = {
  hmj: "Hessenmeister",
  adac_hth: "ADAC Hessen-Thüringen Meister",
};

function rate(count: number, n: number): number {
  return n > 0 ? count / n : 0;
}

function compare(
  subject: number,
  others: number,
  subjectDrivers: number,
  otherDrivers: number,
): RateComparison {
  const rs = rate(subject, subjectDrivers);
  const ro = rate(others, otherDrivers);
  const factor = ro > 0 ? round2(rs / ro) : null;
  return {
    subject,
    others,
    rateSubject: rs,
    rateOthers: ro,
    factor,
    relativeMorePercent: factor === null ? null : round2((factor - 1) * 100),
  };
}

function share(subject: number, total: number): ShareFact {
  return { subject, total, percent: total > 0 ? round2((subject / total) * 100) : 0 };
}

/**
 * Compare one group (club or region) against the rest of the field and
 * collect everything the quotes may talk about.
 */
export function buildSubjectFacts(
  championship: Endlauf26Championship,
  kind: GroupKind,
  subjectName: string,
  rows: readonly Endlauf26Row[],
  events: readonly EndlaufEventInfo[],
  results: readonly StatResult[],
  scored: ReadonlyMap<number, ReadonlySet<number>>,
): SubjectFacts | null {
  const stats = computeGroupStats(championship, kind, rows, events, results);
  const subject = stats.find((s) => s.name === subjectName);
  if (!subject) return null;
  const others = stats.filter((s) => s.id !== subject.id);
  const sum = (f: (s: GroupStatRow) => number) => others.reduce((a, s) => a + f(s), 0);

  const otherDrivers = sum((s) => s.driverCount);
  const fieldDrivers = subject.driverCount + otherDrivers;
  const sortedEvents = [...events].sort((a, b) => a.number - b.number);
  const eventName = new Map(sortedEvents.map((e) => [e.eventId, e.name]));
  const scoredEvents = sortedEvents.filter((e) => (scored.get(e.eventId)?.size ?? 0) > 0);
  const openEvents = sortedEvents.filter((e) => (scored.get(e.eventId)?.size ?? 0) === 0);
  const scoredClassLists = sortedEvents.reduce((a, e) => a + (scored.get(e.eventId)?.size ?? 0), 0);

  // DKM spots in total (only classes present in the field)
  const classes = [...new Set(rows.map((r) => r.ageClass))];
  const spotsTotal = classes.reduce((a, c) => a + dkmSpots(championship, c), 0);

  const rankOf = (list: GroupStatRow[], key: (s: GroupStatRow) => number) => {
    const sorted = [...list].sort((a, b) => key(b) - key(a));
    return sorted.findIndex((s) => s.id === subject.id) + 1;
  };
  const better = (key: (s: GroupStatRow) => number): GroupRankFact[] =>
    others
      .filter((s) => key(s) > key(subject))
      .sort((a, b) => key(b) - key(a))
      .map((s) => ({ name: s.name, value: key(s) }));

  const subjectRows = rows.filter((r) => groupOf(championship, kind, r).id === subject.id);
  const fullName = (r: Endlauf26Row) => `${r.firstName} ${r.lastName}`;

  let bestClimber: SubjectFacts["bestClimber"] = null;
  for (const r of subjectRows) {
    const delta = r.movement.reduce((a, m) => a + (m.available && m.delta !== null ? m.delta : 0), 0);
    const hasMovement = r.movement.some((m) => m.available && m.delta !== null);
    if (!hasMovement) continue;
    if (!bestClimber || delta > bestClimber.delta) {
      bestClimber = { name: fullName(r), ageClass: r.ageClass, delta, rank: r.rank };
    }
  }

  const laps = computeFastestLaps(results);
  const rowById = new Map(rows.map((r) => [r.driverId, r]));
  const fastestLapList: SubjectFacts["fastestLapList"] = [];
  for (const [list, withPenalty] of [
    [laps.raw, false],
    [laps.withPenalty, true],
  ] as const) {
    for (const l of list) {
      for (const d of l.driverIds) {
        const r = rowById.get(d);
        if (!r || groupOf(championship, kind, r).id !== subject.id) continue;
        fastestLapList.push({
          event: eventName.get(l.eventId) ?? String(l.eventId),
          ageClass: l.ageClass,
          name: fullName(r),
          seconds: l.value,
          withPenalty,
        });
      }
    }
  }

  const runsOthers = sum((s) => s.runs);
  const cleanOthers = sum((s) => s.cleanRuns);
  const penOthers = sum((s) => s.penaltySeconds);
  const otherPoints = sum((s) => s.totalPoints);

  return {
    championship,
    kind,
    subjectName: subject.name,
    titleName: TITLE_NAME[championship],
    scoredEvents: scoredEvents.map((e) => e.name),
    openEvents: openEvents.map((e) => e.name),
    scoredClassLists,
    fieldDrivers,
    subjectDrivers: subject.driverCount,
    shareOfField: round2(rate(subject.driverCount, fieldDrivers) * 100),
    groupCount: stats.length,
    rankByPoints: rankOf(stats, (s) => s.totalPoints),
    rankByAvgPoints: rankOf(stats, (s) => s.avgPoints),
    avgPointsSubject: subject.avgPoints,
    avgPointsOthers: otherDrivers ? round2(otherPoints / otherDrivers) : 0,
    classLeaders: compare(
      subject.classLeaders,
      sum((s) => s.classLeaders),
      subject.driverCount,
      otherDrivers,
    ),
    podium: compare(subject.podiumPlaces, sum((s) => s.podiumPlaces), subject.driverCount, otherDrivers),
    dkm:
      spotsTotal > 0
        ? {
            ...compare(subject.dkmQualifiers, sum((s) => s.dkmQualifiers), subject.driverCount, otherDrivers),
            spotsTotal,
          }
        : null,
    endlaufWins: share(subject.endlaufWins, subject.endlaufWins + sum((s) => s.endlaufWins)),
    endlaufPodiums: share(subject.endlaufPodiums, subject.endlaufPodiums + sum((s) => s.endlaufPodiums)),
    endlaufPoints: share(subject.endlaufPoints, round2(subject.endlaufPoints + sum((s) => s.endlaufPoints))),
    fastestLaps: share(subject.fastestLaps, laps.raw.length),
    fastestLapsWithPenalty: share(subject.fastestLapsWithPenalty, laps.withPenalty.length),
    penalties: {
      runsSubject: subject.runs,
      runsOthers,
      cleanRunPercentSubject: round2(rate(subject.cleanRuns, subject.runs) * 100),
      cleanRunPercentOthers: round2(rate(cleanOthers, runsOthers) * 100),
      avgPenaltyPerRunSubject: round2(rate(subject.penaltySeconds, subject.runs)),
      avgPenaltyPerRunOthers: round2(rate(penOthers, runsOthers)),
    },
    movement: {
      gained: subject.gainedTotal,
      lost: subject.lostTotal,
      net: subject.netMovement,
      moversCount: subject.moversCount,
      netPerDriver: subject.netPerDriver,
      rankByNet: rankOf(stats, (s) => s.netMovement),
      rankByNetPerDriver: rankOf(stats, (s) => s.netPerDriver),
      betterByNet: better((s) => s.netMovement),
      betterByNetPerDriver: better((s) => s.netPerDriver),
      perEvent: subject.movement
        .filter((m) => m.drivers > 0)
        .map((m) => ({
          event: eventName.get(m.eventId) ?? String(m.eventId),
          gained: m.gained,
          lost: m.lost,
          net: m.net,
        })),
    },
    bestClimber,
    leaders: subjectRows
      .filter((r) => !r.excluded && r.rank === 1)
      .map((r) => ({ name: fullName(r), ageClass: r.ageClass })),
    dkmDrivers: subjectRows
      .filter((r) => !r.excluded && qualifiesForDkm(championship, r.ageClass, r.rank))
      .map((r) => ({ name: fullName(r), ageClass: r.ageClass, rank: r.rank as number })),
    fastestLapList,
  };
}
