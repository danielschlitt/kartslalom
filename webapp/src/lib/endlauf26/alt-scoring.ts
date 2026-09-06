/**
 * Alternative scorings of one age class's official results — "what if only
 * the fastest run counted", "without penalties", "penalties only". Pure and
 * client-safe; the official order (`position`) is never touched by these.
 */

export type ScoringMode = "official" | "fastest" | "no-penalty" | "penalty-only";

export const SCORING_MODES: { id: ScoringMode; label: string; hint: string }[] = [
  {
    id: "official",
    label: "Offiziell",
    hint: "Platz laut Ergebnisliste (Lauf 1 + Lauf 2 inkl. Strafsekunden).",
  },
  {
    id: "fastest",
    label: "Nur schnellste Runde",
    hint: "Nur die schnellere der beiden Laufzeiten zählt — ohne Strafsekunden.",
  },
  {
    id: "no-penalty",
    label: "Ohne Fehler",
    hint: "Lauf 1 + Lauf 2, Strafsekunden werden ignoriert.",
  },
  {
    id: "penalty-only",
    label: "Nur Fehler",
    hint: "Sortiert nach Strafsekunden; bei Gleichstand entscheidet die Gesamtzeit.",
  },
];

/** The subset of a result row the scorings need. */
export interface ScorableResult {
  driverId: number;
  position: number | null;
  run1Time: number | null;
  run1Penalty: number;
  run2Time: number | null;
  run2Penalty: number;
  totalPenalty: number | null;
  totalTime: number | null;
}

export interface ScoredRow<T extends ScorableResult> {
  row: T;
  /** Rank in this scoring (shared for equal keys); null when the row has no value. */
  rank: number | null;
  /** The primary value of this scoring (seconds, or penalty seconds for "penalty-only"). */
  value: number | null;
  /** Secondary value shown next to the primary one (Gesamtzeit for "penalty-only"). */
  secondary: number | null;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function officialTotal(r: ScorableResult): number | null {
  if (r.totalTime !== null) return r.totalTime;
  if (r.run1Time === null || r.run2Time === null) return null;
  return round3(r.run1Time + r.run1Penalty + r.run2Time + r.run2Penalty);
}

export function fastestRun(r: ScorableResult): number | null {
  if (r.run1Time === null) return r.run2Time;
  if (r.run2Time === null) return r.run1Time;
  return Math.min(r.run1Time, r.run2Time);
}

export function rawSum(r: ScorableResult): number | null {
  if (r.run1Time === null || r.run2Time === null) return null;
  return round3(r.run1Time + r.run2Time);
}

export function penaltySum(r: ScorableResult): number | null {
  if (r.totalPenalty !== null) return r.totalPenalty;
  if (r.run1Time === null && r.run2Time === null) return null;
  return r.run1Penalty + r.run2Penalty;
}

interface Keyed<T> {
  row: T;
  key: (number | null)[];
  value: number | null;
  secondary: number | null;
}

function compareKeys(a: (number | null)[], b: (number | null)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? null;
    const bv = b[i] ?? null;
    if (av === bv) continue;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  }
  return 0;
}

/**
 * Sort + rank rows for a scoring mode. Rows without a value keep their
 * official order at the bottom and get no rank.
 */
export function scoreRows<T extends ScorableResult>(
  rows: readonly T[],
  mode: ScoringMode,
): ScoredRow<T>[] {
  const keyed: Keyed<T>[] = rows.map((row) => {
    switch (mode) {
      case "official": {
        const v = officialTotal(row);
        return { row, key: [row.position], value: v, secondary: null };
      }
      case "fastest": {
        const v = fastestRun(row);
        return { row, key: [v], value: v, secondary: null };
      }
      case "no-penalty": {
        const v = rawSum(row);
        return { row, key: [v], value: v, secondary: null };
      }
      case "penalty-only": {
        const p = penaltySum(row);
        const t = officialTotal(row);
        return { row, key: [p, t], value: p, secondary: t };
      }
    }
  });

  const hasKey = (k: Keyed<T>) => k.key[0] !== null;
  const ranked = keyed.filter(hasKey).sort((a, b) => compareKeys(a.key, b.key));
  const rest = keyed
    .filter((k) => !hasKey(k))
    .sort((a, b) => (a.row.position ?? Infinity) - (b.row.position ?? Infinity));

  const out: ScoredRow<T>[] = [];
  let i = 0;
  while (i < ranked.length) {
    let j = i + 1;
    while (j < ranked.length && compareKeys(ranked[j].key, ranked[i].key) === 0) j += 1;
    for (let k = i; k < j; k++) {
      const r = ranked[k];
      out.push({
        row: r.row,
        // Official mode: the printed position is the rank, even if OCR gave two rows the same number.
        rank: mode === "official" ? r.row.position : i + 1,
        value: r.value,
        secondary: r.secondary,
      });
    }
    i = j;
  }
  for (const r of rest) out.push({ row: r.row, rank: null, value: r.value, secondary: r.secondary });
  return out;
}

/**
 * Time difference to a reference value: positive = slower than reference.
 * Null when either side is missing.
 */
export function diffSeconds(value: number | null, ref: number | null): number | null {
  if (value === null || ref === null) return null;
  return round3(value - ref);
}

/** "+1,23" / "−0,45" / "–" (reference itself or unknown). */
export function formatDiff(d: number | null): string {
  if (d === null) return "–";
  if (Math.abs(d) < 0.0005) return "–";
  const s = Math.abs(d).toFixed(2).replace(".", ",");
  return d > 0 ? `+${s}` : `−${s}`;
}
