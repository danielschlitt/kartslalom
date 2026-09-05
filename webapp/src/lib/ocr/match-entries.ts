/**
 * Fuzzy matching of OCR'd result-sheet rows against the known entries of an
 * age class. Pure functions — shared between the API routes (initial
 * proposal) and the review UI (driver search box).
 *
 * Scoring: a driver name similarity (Levenshtein on normalized last/first
 * name, both orders tried) blended with a token-containment score for the
 * Verein. Assignment is greedy one-to-one, so a driver is never proposed for
 * two rows at once.
 */

export interface MatchCandidate {
  entryId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  startingOrder: number | null;
}

export interface MatchInput {
  lastName: string;
  firstName: string;
  team: string | null;
  startNumber: number | null;
}

export type MatchKind = "high" | "low" | "none";

export interface MatchResult {
  entryId: number | null;
  score: number;
  kind: MatchKind;
}

/** Scores at/above this are shown as confident matches. */
export const HIGH_THRESHOLD = 0.85;
/** Scores at/above this are proposed but flagged for review. */
export const LOW_THRESHOLD = 0.6;

/**
 * Lower-case, strip diacritics (ä→a, é→e), ß→ss, collapse everything that is
 * not a letter or digit into single spaces.
 */
export function normalizeText(s: string): string {
  return s
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  const n = normalizeText(s);
  return n === "" ? [] : n.split(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. Operates on normalized strings. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === "" && nb === "") return 1;
  if (na === "" || nb === "") return 0;
  const max = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / max;
}

/**
 * Name similarity that tolerates swapped columns ("Finn Ruppel" vs
 * "Ruppel Finn"), hyphenated or double first names, and single-letter typos.
 */
export function nameSimilarity(
  ocrLast: string,
  ocrFirst: string,
  candLast: string,
  candFirst: string,
): number {
  const straight = 0.6 * similarity(ocrLast, candLast) + 0.4 * similarity(ocrFirst, candFirst);
  const swapped = 0.6 * similarity(ocrFirst, candLast) + 0.4 * similarity(ocrLast, candFirst);
  const full = similarity(`${ocrLast} ${ocrFirst}`, `${candLast} ${candFirst}`);
  const fullRev = similarity(`${ocrFirst} ${ocrLast}`, `${candLast} ${candFirst}`);
  // A double first name on the sheet ("Jack-Leon") vs. a single one in the DB
  // ("Jack"), or vice versa: give credit when one first name contains the other.
  const fo = normalizeText(ocrFirst);
  const fc = normalizeText(candFirst);
  const firstContains =
    fo !== "" && fc !== "" && (fo.includes(fc) || fc.includes(fo))
      ? 0.6 * similarity(ocrLast, candLast) + 0.4 * 0.9
      : 0;
  return Math.max(straight, swapped, full, fullRev, firstContains);
}

/**
 * How well the OCR'd Verein covers the known team name. Sheets often prefix
 * the club with the umbrella organisation ("VFM/AC Bensheim" for "AC
 * Bensheim"), so we check that every token of the known team appears (fuzzily)
 * in the OCR text rather than comparing the whole strings.
 */
export function teamSimilarity(ocrTeam: string | null, candTeam: string): number {
  if (ocrTeam === null || normalizeText(ocrTeam) === "") return 0;
  const ct = tokens(candTeam);
  const ot = tokens(ocrTeam);
  if (ct.length === 0 || ot.length === 0) return 0;
  let sum = 0;
  for (const t of ct) {
    let best = 0;
    for (const o of ot) {
      const s = 1 - levenshtein(t, o) / Math.max(t.length, o.length);
      if (s > best) best = s;
    }
    sum += best;
  }
  return sum / ct.length;
}

export function scoreCandidate(row: MatchInput, cand: MatchCandidate): number {
  const name = nameSimilarity(row.lastName, row.firstName, cand.lastName, cand.firstName);
  const hasTeam = row.team !== null && normalizeText(row.team) !== "";
  let score = hasTeam ? 0.75 * name + 0.25 * teamSimilarity(row.team, cand.teamName) : name;
  // The start number on the sheet usually equals our starting order — a
  // small nudge that helps to break ties between similar names.
  if (
    row.startNumber !== null &&
    cand.startingOrder !== null &&
    row.startNumber === cand.startingOrder
  ) {
    score = Math.min(1, score + 0.05);
  }
  return score;
}

export function kindForScore(score: number): MatchKind {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= LOW_THRESHOLD) return "low";
  return "none";
}

/**
 * Greedy one-to-one assignment of rows to candidates, best pairs first.
 * Rows without a candidate above LOW_THRESHOLD stay unmatched.
 */
export function matchRows(rows: MatchInput[], candidates: MatchCandidate[]): MatchResult[] {
  const pairs: { row: number; cand: number; score: number }[] = [];
  rows.forEach((row, ri) => {
    candidates.forEach((cand, ci) => {
      const score = scoreCandidate(row, cand);
      if (score >= LOW_THRESHOLD) pairs.push({ row: ri, cand: ci, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const results: MatchResult[] = rows.map(() => ({ entryId: null, score: 0, kind: "none" }));
  const usedCand = new Set<number>();
  const usedRow = new Set<number>();
  for (const p of pairs) {
    if (usedRow.has(p.row) || usedCand.has(p.cand)) continue;
    usedRow.add(p.row);
    usedCand.add(p.cand);
    results[p.row] = {
      entryId: candidates[p.cand].entryId,
      score: Math.round(p.score * 1000) / 1000,
      kind: kindForScore(p.score),
    };
  }
  return results;
}

/**
 * Rank candidates for a free-text search box ("rup", "finn r", "reinheim").
 * Substring hits on the normalized "last first team" string win, then fuzzy
 * name similarity. Returns all candidates when the query is empty.
 */
export function searchCandidates(query: string, candidates: MatchCandidate[]): MatchCandidate[] {
  const q = normalizeText(query);
  if (q === "") return candidates;
  const qTokens = q.split(" ");
  const scored = candidates.map((c) => {
    const hay = normalizeText(`${c.lastName} ${c.firstName} ${c.teamName}`);
    const allTokensContained = qTokens.every((t) => hay.includes(t));
    let score = allTokensContained ? 1 : 0;
    if (!allTokensContained) {
      const [qa = "", qb = ""] = qTokens;
      score = Math.max(
        nameSimilarity(qa, qb, c.lastName, c.firstName),
        similarity(q, c.lastName),
        similarity(q, c.firstName),
      );
    }
    return { c, score };
  });
  return scored
    .filter((s) => s.score >= 0.45)
    .sort((a, b) => b.score - a.score || a.c.lastName.localeCompare(b.c.lastName, "de"))
    .map((s) => s.c);
}
