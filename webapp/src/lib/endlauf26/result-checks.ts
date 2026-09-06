/**
 * Plausibility checks for an imported Endlauf result list. The printed list
 * is the single source of truth — nothing here changes a value or the order,
 * it only points out what does not add up so the admin can double-check the
 * photo (typically an OCR misread).
 *
 * Pure and client-safe: the review UI re-runs the checks after every edit.
 *
 * Columns of the hmj Endlauf result list (per age class):
 *   Platz · Startplatz · Name · ADAC Ortsclub · Ausweis-Nr. · Wertung (D/M) ·
 *   Training · 1. Lauf Zeit · 1. Lauf Fehler · 2. Lauf Zeit · 2. Lauf Fehler ·
 *   Gesamt Fehler · Gesamtzeit · ADAC Punkte (ohne Faktor)
 */

import { levenshtein, normalizeText } from "@/lib/ocr/match-entries";
import { pointsForPlace } from "./ranking";

/** Everything a check needs; strings already parsed to numbers. */
export interface CheckableRow {
  position: number | null;
  startPosition: number | null;
  team: string | null;
  wertung: string | null;
  testTime: number | null;
  run1Time: number | null;
  run1Penalty: number | null;
  run2Time: number | null;
  run2Penalty: number | null;
  totalPenalty: number | null;
  totalTime: number | null;
  points: number | null;
}

export interface RowCheckResult {
  /** Human-readable German warnings for this row. */
  warnings: string[];
  /** Ortsclub does not match any known club (needs acknowledgement). */
  unknownClub: boolean;
}

export interface SheetCheckResult {
  rows: RowCheckResult[];
  /** Warnings that concern the list as a whole (order, duplicate places, gaps). */
  sheet: string[];
}

const MIN_TIME = 5;
const MAX_TIME = 900;
const MAX_PENALTY = 200;
/** Two decimals on the sheet → allow rounding noise. */
const EPS = 0.011;
/** clubSimilarity ≥ this counts as "known club". */
const CLUB_MATCH = 0.8;

function de(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/** Umbrella/legal-form tokens that say little about which club it is. */
const GENERIC_TOKENS = new Set(["msc", "ac", "msf", "oamc", "kmc", "vfm", "amc", "mc", "e", "v", "ev", "eg"]);

function clubTokens(s: string): string[] {
  const n = normalizeText(s);
  return n === "" ? [] : n.split(" ");
}

function tokenWeight(t: string): number {
  return GENERIC_TOKENS.has(t) ? 0.5 : Math.max(1, t.length);
}

/**
 * Weighted share of `of` tokens that occur (fuzzily) in `from`. Distinctive
 * tokens ("rodenstein") weigh more than umbrella prefixes ("msc").
 */
function coverage(from: readonly string[], of: readonly string[]): { score: number; distinctive: boolean } {
  let sum = 0;
  let total = 0;
  let distinctive = false;
  for (const t of of) {
    let best = 0;
    for (const f of from) {
      const s =
        f.startsWith(t) || t.startsWith(f)
          ? Math.min(f.length, t.length) / Math.max(f.length, t.length) >= 0.6
            ? 1
            : 0.8
          : 1 - levenshtein(t, f) / Math.max(t.length, f.length);
      if (s > best) best = s;
    }
    const w = tokenWeight(t);
    if (!GENERIC_TOKENS.has(t) && t.length >= 4 && best >= 0.8) distinctive = true;
    sum += w * best;
    total += w;
  }
  return { score: total === 0 ? 0 : sum / total, distinctive };
}

/**
 * Symmetric club-name similarity, 0–1. Either name may be the longer one:
 * "MSC Rodenstein" ≈ "MSC Rodenstein Fr.- Crumbach" ≈ "MSC Rodenstein
 * Fränkisch-Crumbach". Without a shared distinctive token (e.g. only "MSC")
 * the score is capped so umbrella prefixes alone never match.
 */
export function clubSimilarity(a: string | null, b: string): number {
  if (a === null) return 0;
  const ta = clubTokens(a);
  const tb = clubTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const ab = coverage(ta, tb);
  const ba = coverage(tb, ta);
  const best = Math.max(ab.score, ba.score);
  const distinctive = ab.distinctive || ba.distinctive;
  return distinctive ? best : Math.min(best, 0.45);
}

/** Known clubs ranked by similarity to a printed name (best first). */
export function rankClubs(team: string, knownClubs: readonly string[]): { name: string; score: number }[] {
  return knownClubs
    .map((name) => ({ name, score: clubSimilarity(team, name) }))
    .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, "de"));
}

export function isKnownClub(team: string | null, knownClubs: readonly string[]): boolean {
  if (team === null || normalizeText(team) === "") return true; // nothing printed → nothing to check
  return knownClubs.some((c) => clubSimilarity(team, c) >= CLUB_MATCH);
}

/** Best-matching known club for a printed name (for the "did you mean" hint). */
export function closestClub(team: string, knownClubs: readonly string[]): string | null {
  const [best] = rankClubs(team, knownClubs);
  return best && best.score >= 0.5 ? best.name : null;
}

export function checkRow(r: CheckableRow, knownClubs: readonly string[]): RowCheckResult {
  const w: string[] = [];

  for (const [label, t] of [
    ["Training", r.testTime],
    ["Lauf 1", r.run1Time],
    ["Lauf 2", r.run2Time],
  ] as const) {
    if (t !== null && (t < MIN_TIME || t > MAX_TIME)) w.push(`${label}: unplausible Zeit ${de(t)}.`);
  }
  for (const [label, p] of [
    ["Lauf 1", r.run1Penalty],
    ["Lauf 2", r.run2Penalty],
    ["Gesamt", r.totalPenalty],
  ] as const) {
    if (p !== null && (p < 0 || p > MAX_PENALTY || !Number.isInteger(p)))
      w.push(`${label}: unplausible Strafsekunden ${p}.`);
  }

  const p1 = r.run1Penalty ?? 0;
  const p2 = r.run2Penalty ?? 0;
  if (r.totalPenalty !== null && r.totalPenalty !== p1 + p2) {
    w.push(`Gesamt Fehler ${r.totalPenalty} ≠ ${p1} + ${p2} (Lauf 1 + Lauf 2).`);
  }

  if (r.run1Time !== null && r.run2Time !== null) {
    const sum = r.run1Time + p1 + r.run2Time + p2;
    if (r.totalTime === null) {
      w.push(`Gesamtzeit fehlt (rechnerisch ${de(sum)}).`);
    } else if (Math.abs(sum - r.totalTime) > EPS) {
      w.push(
        `Gesamtzeit ${de(r.totalTime)} ≠ ${de(r.run1Time)} + ${p1} + ${de(r.run2Time)} + ${p2} = ${de(sum)}.`,
      );
    }
  } else if (r.totalTime !== null && (r.run1Time === null || r.run2Time === null)) {
    w.push("Gesamtzeit vorhanden, aber eine Laufzeit fehlt.");
  }

  if (r.position !== null && r.points !== null) {
    const expected = pointsForPlace(r.position);
    if (r.points !== expected) {
      w.push(`ADAC Punkte ${r.points} ≠ ${expected} laut Punktetabelle für Platz ${r.position}.`);
    }
  }
  if (r.position !== null && r.position < 1) w.push(`Ungültiger Platz ${r.position}.`);
  if (r.position === null) w.push("Kein Platz gelesen.");
  if (r.startPosition !== null && r.startPosition < 1)
    w.push(`Ungültiger Startplatz ${r.startPosition}.`);

  if (r.wertung !== null && r.wertung !== "" && !/^[DM]$/i.test(r.wertung.trim())) {
    w.push(`Wertung „${r.wertung}“ ist weder D noch M.`);
  }

  const unknownClub = !isKnownClub(r.team, knownClubs);
  if (unknownClub && r.team) {
    const hint = closestClub(r.team, knownClubs);
    w.push(`Ortsclub „${r.team}“ ist nicht bekannt${hint ? ` (ähnlich: ${hint})` : ""}.`);
  }

  return { warnings: w, unknownClub };
}

/**
 * Sheet-level checks: every position once, no gaps, and the order by
 * Gesamtzeit agrees with the printed places. A row whose Gesamtzeit is
 * shorter than the row placed before it is flagged on that row.
 */
export function checkSheet(
  rows: readonly CheckableRow[],
  knownClubs: readonly string[],
): SheetCheckResult {
  const perRow = rows.map((r) => checkRow(r, knownClubs));
  const sheet: string[] = [];

  const withPos = rows
    .map((r, idx) => ({ r, idx }))
    .filter((x) => x.r.position !== null)
    .sort((a, b) => (a.r.position as number) - (b.r.position as number));

  const seen = new Map<number, number[]>();
  for (const { r, idx } of withPos) {
    const arr = seen.get(r.position as number) ?? [];
    arr.push(idx);
    seen.set(r.position as number, arr);
  }
  for (const [pos, idxs] of seen) {
    if (idxs.length > 1) {
      sheet.push(`Platz ${pos} ist ${idxs.length}× vergeben.`);
      for (const i of idxs) perRow[i].warnings.push(`Platz ${pos} kommt mehrfach vor.`);
    }
  }
  if (withPos.length > 0) {
    const max = withPos[withPos.length - 1].r.position as number;
    const missing: number[] = [];
    for (let p = 1; p <= max; p++) if (!seen.has(p)) missing.push(p);
    if (missing.length > 0 && missing.length <= 10) {
      sheet.push(`Fehlende Plätze: ${missing.join(", ")}.`);
    } else if (missing.length > 10) {
      sheet.push(`${missing.length} Plätze fehlen zwischen 1 und ${max}.`);
    }
  }

  // Order vs. Gesamtzeit — only among rows with a Gesamtzeit.
  let prev: { pos: number; total: number; idx: number } | null = null;
  for (const { r, idx } of withPos) {
    const total = r.totalTime ?? (
      r.run1Time !== null && r.run2Time !== null
        ? r.run1Time + (r.run1Penalty ?? 0) + r.run2Time + (r.run2Penalty ?? 0)
        : null
    );
    if (total === null) continue;
    if (prev && total < prev.total - EPS && (r.position as number) > prev.pos) {
      perRow[idx].warnings.push(
        `Gesamtzeit ${de(total)} ist kürzer als Platz ${prev.pos} (${de(prev.total)}) — Reihenfolge prüfen.`,
      );
      sheet.push(`Platz ${r.position} hat eine kürzere Gesamtzeit als Platz ${prev.pos}.`);
    }
    prev = { pos: r.position as number, total, idx };
  }

  // Rows without both runs placed among rows with times.
  const lastTimed = [...withPos].reverse().find(({ r }) => r.run1Time !== null && r.run2Time !== null);
  if (lastTimed) {
    for (const { r, idx } of withPos) {
      if ((r.position as number) < (lastTimed.r.position as number) && (r.run1Time === null || r.run2Time === null)) {
        perRow[idx].warnings.push("Platz mit fehlender Laufzeit vor Fahrern mit zwei Läufen.");
      }
    }
  }

  return { rows: perRow, sheet };
}
