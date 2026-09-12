/**
 * Endläufe 2026 — tolerant person-name matching (pure, no DB / React).
 *
 * The two championships share drivers by name only, and the sources spell
 * them differently ("Hoffman" / "Hoffmann", "Mejia Quintero Joshua" /
 * "Quintero Joschua Mejia"). Matching therefore works on normalised name
 * tokens, order-insensitive, allowing one typo per token.
 */

/** Lower-case ASCII letters only: "Löffler" → "loffler", "Jack-Leon" → "jackleon". */
export function normalizeNameToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Sorted, normalised tokens of "lastName firstName" (hyphenated parts stay one token). */
export function nameTokens(...parts: (string | null | undefined)[]): string[] {
  return parts
    .flatMap((p) => (p ?? "").split(/\s+/))
    .map(normalizeNameToken)
    .filter((t) => t.length > 0)
    .sort();
}

/** Stable key for exact (normalised, order-insensitive) name equality. */
export function nameKey(...parts: (string | null | undefined)[]): string {
  return nameTokens(...parts).join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Whether two names denote the same person: identical token sets, or —
 * fuzzy — the same number of tokens where every token of `a` has a partner
 * in `b` at edit distance ≤ 1 (each partner used once).
 */
export function namesMatch(
  a: readonly string[] | string,
  b: readonly string[] | string,
): boolean {
  const ta = typeof a === "string" ? nameTokens(a) : [...a];
  const tb = typeof b === "string" ? nameTokens(b) : [...b];
  if (ta.length === 0 || ta.length !== tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  const free = [...tb];
  for (const t of ta) {
    // Very short tokens (initials) must match exactly.
    const idx = free.findIndex((u) =>
      t.length < 4 || u.length < 4 ? u === t : levenshtein(t, u) <= 1,
    );
    if (idx < 0) return false;
    free.splice(idx, 1);
  }
  return true;
}
