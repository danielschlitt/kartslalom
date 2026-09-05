/** "12.5" → "12,5", "40" → "40" */
export function formatPoints(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

export function formatFactor(f: number): string {
  return `×${f.toFixed(2).replace(/\.?0+$/, "").replace(".", ",")}`;
}

/** Seconds → "42,35" (two decimals, German comma). */
export function formatSeconds(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(2).replace(".", ",");
}
