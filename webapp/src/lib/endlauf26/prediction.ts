/**
 * Deterministic "what is still possible" analysis for one driver of an
 * Endlauf championship. Pure: no DB, no network.
 *
 * The output (`PredictionFacts`) is fed to a language model that only
 * phrases it — every number in the text comes from these simulations.
 *
 * Assumptions used throughout:
 * - The driver wins every remaining Endlauf of their class ("best case").
 * - A rival is never expected to finish more than `REALISTIC_SLACK` places
 *   worse than their current championship rank ("realistic").
 * - Points for simulated finishes come from the regular scale; the event
 *   factor is applied by the ranking code as usual.
 */

import {
  computeEndlauf26Championship,
  pointsForPlace,
  type Endlauf26Championship,
  type Endlauf26Row,
  type EndlaufDriverInput,
  type EndlaufEventInfo,
} from "./ranking";

export const REALISTIC_SLACK = 5;
/** How many rivals ahead / behind get a detailed threshold analysis. */
const MAX_RIVALS_AHEAD = 6;
const MAX_RIVALS_BEHIND = 3;

export interface RivalFact {
  driverId: number;
  name: string;
  rank: number;
  points: number;
  /** Rival points minus driver points (positive = rival ahead). */
  gap: number;
  /**
   * Worst finishing position the rival may still take (in every remaining
   * Endlauf) and *stay* ahead, assuming our driver wins everything.
   * Our driver overtakes once the rival finishes `threshold` or worse.
   * `null` = the rival stays ahead even without starting (unreachable).
   * `1` = any result of the rival (even a win) lets our driver pass.
   */
  overtakeIfRivalAtOrWorse: number | null;
  /** Whether that threshold is within the realistic slack. */
  realistic: boolean;
}

export interface ThreatFact {
  driverId: number;
  name: string;
  rank: number;
  points: number;
  gap: number;
  /**
   * If our driver finishes at their current rank in every remaining Endlauf:
   * the worst position the chaser may take and still overtake.
   * `null` = the chaser cannot pass with that assumption.
   */
  passesIfAtOrBetter: number | null;
}

export interface PredictionFacts {
  championship: Endlauf26Championship;
  driver: {
    driverId: number;
    name: string;
    ageClass: number;
    rank: number | null;
    points: number;
    withdrawn: boolean;
    excluded: boolean;
    nominated: boolean;
  };
  /** Ranked drivers in the class (excluding withdrawn/excluded). */
  classSize: number;
  completedEvents: string[];
  remainingEvents: { name: string; factor: number }[];
  /** hmj only: the worst result is dropped. */
  dropRule: boolean;
  /** Best rank if the driver wins everything and rivals finish as badly as possible. */
  theoreticalBestRank: number | null;
  /** Best rank if the driver wins everything and every rival finishes `REALISTIC_SLACK` places below their standing. */
  realisticBestRank: number | null;
  /** Rank if the driver finishes `REALISTIC_SLACK` places below their standing and rivals hold theirs. */
  realisticWorstRank: number | null;
  /** Rank if everybody (driver included) finishes exactly at their current rank. */
  holdRank: number | null;
  /** Points the driver would have after winning all remaining Endläufe. */
  pointsIfWinsAll: number;
  rivalsAhead: RivalFact[];
  threatsBehind: ThreatFact[];
}

interface Sim {
  championship: Endlauf26Championship;
  classDrivers: EndlaufDriverInput[];
  events: EndlaufEventInfo[];
  remaining: EndlaufEventInfo[];
}

/** position per driver id for the remaining events; `null` = did not start. */
type Assignment = Map<number, number | null>;

function runSim(sim: Sim, assign: Assignment): Endlauf26Row[] {
  const drivers = sim.classDrivers.map((d) => {
    if (!assign.has(d.driverId)) return d;
    const pos = assign.get(d.driverId) ?? null;
    const remainingIds = new Set(sim.remaining.map((e) => e.eventId));
    return {
      ...d,
      endlaufResults: d.endlaufResults.map((r) =>
        remainingIds.has(r.eventId)
          ? {
              eventId: r.eventId,
              finishPosition: pos,
              pointsAwarded: pos === null ? 0 : pointsForPlace(pos),
              started: pos !== null,
              scored: true,
            }
          : r,
      ),
    };
  });
  return computeEndlauf26Championship(sim.championship, drivers, sim.events);
}

function rankOf(rows: readonly Endlauf26Row[], driverId: number): number | null {
  return rows.find((r) => r.driverId === driverId)?.rank ?? null;
}

function fullName(r: { firstName: string; lastName: string }): string {
  return `${r.firstName} ${r.lastName}`;
}

function cap(pos: number, classSize: number): number {
  return Math.max(1, Math.min(pos, classSize));
}

/**
 * Build the facts for `driverId`. `rows` must be the current championship
 * rows (all classes) computed from `drivers`/`events`.
 */
export function buildPredictionFacts(
  championship: Endlauf26Championship,
  drivers: readonly EndlaufDriverInput[],
  events: readonly EndlaufEventInfo[],
  rows: readonly Endlauf26Row[],
  driverId: number,
  scored: ReadonlyMap<number, ReadonlySet<number>>,
): PredictionFacts | null {
  const me = rows.find((r) => r.driverId === driverId);
  if (!me) return null;

  const classRows = rows.filter((r) => r.ageClass === me.ageClass);
  const ranked = classRows.filter((r) => r.rank !== null);
  const classSize = ranked.length;
  const sortedEvents = [...events].sort((a, b) => a.number - b.number);
  const remaining = sortedEvents.filter(
    (e) => !(scored.get(e.eventId)?.has(me.ageClass) ?? false),
  );
  const completed = sortedEvents.filter((e) => !remaining.includes(e));

  const sim: Sim = {
    championship,
    classDrivers: drivers.filter((d) => d.ageClass === me.ageClass),
    events: sortedEvents,
    remaining,
  };

  const base: PredictionFacts = {
    championship,
    driver: {
      driverId,
      name: fullName(me),
      ageClass: me.ageClass,
      rank: me.rank,
      points: me.totalPoints,
      withdrawn: me.withdrawn,
      excluded: me.excluded,
      nominated: me.nominated,
    },
    classSize,
    completedEvents: completed.map((e) => e.name),
    remainingEvents: remaining.map((e) => ({ name: e.name, factor: e.factor })),
    dropRule: championship === "hmj",
    theoreticalBestRank: me.rank,
    realisticBestRank: me.rank,
    realisticWorstRank: me.rank,
    holdRank: me.rank,
    pointsIfWinsAll: me.totalPoints,
    rivalsAhead: [],
    threatsBehind: [],
  };

  if (remaining.length === 0 || me.rank === null) return base;

  const myRank = me.rank;
  const rankBy = new Map(ranked.map((r) => [r.driverId, r.rank as number]));

  // Everybody at their own rank (the driver too).
  const hold: Assignment = new Map();
  for (const r of ranked) hold.set(r.driverId, cap(rankBy.get(r.driverId)!, classSize));
  const holdRows = runSim(sim, hold);
  base.holdRank = rankOf(holdRows, driverId);

  // Theoretical best: I win, rivals finish in reverse order of their
  // strength (top of the table finishes last).
  const theo: Assignment = new Map([[driverId, 1]]);
  const others = ranked.filter((r) => r.driverId !== driverId);
  others.forEach((r, i) => theo.set(r.driverId, cap(classSize - i, classSize)));
  const theoRows = runSim(sim, theo);
  base.theoreticalBestRank = rankOf(theoRows, driverId);
  base.pointsIfWinsAll = theoRows.find((r) => r.driverId === driverId)?.totalPoints ?? me.totalPoints;

  // Realistic best: I win, every rival is REALISTIC_SLACK places worse than
  // their standing (but never better than 2nd, since I take the win).
  const realBest: Assignment = new Map([[driverId, 1]]);
  for (const r of others) {
    realBest.set(r.driverId, cap(Math.max(2, rankBy.get(r.driverId)! + REALISTIC_SLACK), classSize));
  }
  base.realisticBestRank = rankOf(runSim(sim, realBest), driverId);

  // Realistic worst: I am REALISTIC_SLACK places worse, rivals hold.
  const realWorst: Assignment = new Map(hold);
  realWorst.set(driverId, cap(myRank + REALISTIC_SLACK, classSize));
  base.realisticWorstRank = rankOf(runSim(sim, realWorst), driverId);

  // Rivals ahead: threshold analysis. Everyone else holds their rank.
  const ahead = ranked
    .filter((r) => (r.rank as number) < myRank)
    .sort((a, b) => (b.rank as number) - (a.rank as number)) // nearest first
    .slice(0, MAX_RIVALS_AHEAD);
  for (const rival of ahead) {
    let threshold: number | null = null;
    for (let p = 1; p <= classSize; p++) {
      const a: Assignment = new Map(hold);
      a.set(driverId, 1);
      a.set(rival.driverId, p);
      const res = runSim(sim, a);
      const mine = rankOf(res, driverId);
      const theirs = rankOf(res, rival.driverId);
      if (mine !== null && (theirs === null || mine < theirs)) {
        threshold = p;
        break;
      }
    }
    if (threshold === null) {
      // Even a DNS?
      const a: Assignment = new Map(hold);
      a.set(driverId, 1);
      a.set(rival.driverId, null);
      const res = runSim(sim, a);
      const mine = rankOf(res, driverId);
      const theirs = rankOf(res, rival.driverId);
      if (mine !== null && (theirs === null || mine < theirs)) threshold = classSize + 1;
    }
    base.rivalsAhead.push({
      driverId: rival.driverId,
      name: fullName(rival),
      rank: rival.rank as number,
      points: rival.totalPoints,
      gap: round2(rival.totalPoints - me.totalPoints),
      overtakeIfRivalAtOrWorse: threshold,
      realistic:
        threshold !== null && threshold <= (rival.rank as number) + REALISTIC_SLACK,
    });
  }
  // Present in table order (best rival first).
  base.rivalsAhead.sort((a, b) => a.rank - b.rank);

  // Threats behind: I finish at my rank, what does the chaser need?
  const behind = ranked
    .filter((r) => (r.rank as number) > myRank)
    .sort((a, b) => (a.rank as number) - (b.rank as number))
    .slice(0, MAX_RIVALS_BEHIND);
  for (const chaser of behind) {
    let need: number | null = null;
    for (let p = classSize; p >= 1; p--) {
      const a: Assignment = new Map(hold);
      a.set(chaser.driverId, p);
      const res = runSim(sim, a);
      const mine = rankOf(res, driverId);
      const theirs = rankOf(res, chaser.driverId);
      if (theirs !== null && (mine === null || theirs < mine)) {
        need = p;
        break;
      }
    }
    base.threatsBehind.push({
      driverId: chaser.driverId,
      name: fullName(chaser),
      rank: chaser.rank as number,
      points: chaser.totalPoints,
      gap: round2(chaser.totalPoints - me.totalPoints),
      passesIfAtOrBetter: need,
    });
  }

  return base;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ───────────────────────── fallback text (no AI) ───────────────────────── */

function ordinal(n: number): string {
  return `${n}.`;
}

/**
 * Plain German summary from the facts — used when OpenAI is unavailable and
 * as a safety net when the model returns nothing.
 */
export function factsToPlainText(f: PredictionFacts): string {
  const d = f.driver;
  if (d.withdrawn) return `${d.name} hat sich von den Endläufen abgemeldet und wird nicht gewertet.`;
  if (f.remainingEvents.length === 0) {
    return d.rank
      ? `Die Wertung ist abgeschlossen: ${d.name} beendet die Meisterschaft auf Platz ${d.rank} mit ${d.points} Punkten.`
      : `Die Wertung ist abgeschlossen. ${d.name} ist nicht gewertet.`;
  }
  if (d.rank === null) {
    return `${d.name} ist derzeit nicht gewertet, daher ist keine Prognose möglich.`;
  }
  const rest =
    f.remainingEvents.length === 1
      ? `dem verbleibenden ${f.remainingEvents[0].name}`
      : `den verbleibenden Endläufen (${f.remainingEvents.map((e) => e.name).join(", ")})`;
  const parts: string[] = [];
  parts.push(
    `${d.name} liegt aktuell auf Platz ${d.rank} von ${f.classSize} mit ${d.points} Punkten.`,
  );
  if (f.theoreticalBestRank !== null && f.theoreticalBestRank < d.rank) {
    parts.push(
      `Rechnerisch ist mit einem Sieg in ${rest} noch Platz ${f.theoreticalBestRank} möglich, realistisch Platz ${f.realisticBestRank ?? d.rank}.`,
    );
  } else {
    parts.push(`Ein Vorrücken in der Tabelle ist rechnerisch nicht mehr möglich.`);
  }
  const key = f.rivalsAhead.filter((r) => r.overtakeIfRivalAtOrWorse !== null).slice(0, 2);
  for (const r of key) {
    const t = r.overtakeIfRivalAtOrWorse!;
    parts.push(
      t > f.classSize
        ? `${r.name} (${ordinal(r.rank)}) ist nur bei Nichtantritt zu überholen.`
        : t === 1
          ? `${r.name} (${ordinal(r.rank)}) wird bei einem eigenen Sieg in jedem Fall überholt.`
          : `${r.name} (${ordinal(r.rank)}) wird überholt, wenn er/sie dort nur Platz ${t} oder schlechter erreicht.`,
    );
  }
  if (f.realisticWorstRank !== null && f.realisticWorstRank > d.rank) {
    parts.push(`Bei einem schwachen Ergebnis droht ein Abrutschen bis auf Platz ${f.realisticWorstRank}.`);
  }
  return parts.join(" ");
}
