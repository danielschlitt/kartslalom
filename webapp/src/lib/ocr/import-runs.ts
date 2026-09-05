/**
 * Validation of the bulk "import runs" request body shared by the regular
 * season and Endlauf endpoints.
 */

import type { ImportRunsItem, RunType } from "./types";

const RUN_TYPES: RunType[] = ["test", "first", "second"];

export type ParsedImport =
  | { ok: true; items: ImportRunsItem[] }
  | { ok: false; error: "invalid_items" | "invalid_entry" | "invalid_time" | "invalid_penalty" | "duplicate_entry" };

function parseTime(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  if (!Number.isFinite(n) || n < 0 || n > 3600) return undefined;
  return Math.round(n * 1000) / 1000;
}

function parsePenalty(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1000) return undefined;
  return n;
}

export function parseImportItems(raw: unknown): ParsedImport {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "invalid_items" };
  const items: ImportRunsItem[] = [];
  const seen = new Set<number>();
  for (const it of raw as Record<string, unknown>[]) {
    const entryId = Number(it?.entryId);
    if (!Number.isInteger(entryId)) return { ok: false, error: "invalid_entry" };
    if (seen.has(entryId)) return { ok: false, error: "duplicate_entry" };
    seen.add(entryId);

    const runsRaw = (it.runs ?? {}) as Record<string, unknown>;
    const runs: ImportRunsItem["runs"] = {};
    for (const rt of RUN_TYPES) {
      const r = runsRaw[rt];
      if (r === undefined) continue;
      if (r === null) {
        runs[rt] = { timeSeconds: null, penaltySeconds: 0 };
        continue;
      }
      const rec = r as Record<string, unknown>;
      const time = parseTime(rec.timeSeconds);
      if (time === undefined) return { ok: false, error: "invalid_time" };
      const penalty = parsePenalty(rec.penaltySeconds);
      if (penalty === undefined) return { ok: false, error: "invalid_penalty" };
      runs[rt] = { timeSeconds: time, penaltySeconds: penalty };
    }
    if (Object.keys(runs).length === 0) continue;
    items.push({ entryId, runs });
  }
  return { ok: true, items };
}
