/**
 * Validation of the "import official results" request body. Pure; shared by
 * the API route and (for early feedback) the review UI.
 */

import type { EndlaufResultImportItem, Wertung } from "./results-types";

export type ParsedResultImport =
  | { ok: true; items: EndlaufResultImportItem[] }
  | {
      ok: false;
      error:
        | "invalid_items"
        | "invalid_driver"
        | "duplicate_driver"
        | "invalid_position"
        | "invalid_time"
        | "invalid_penalty"
        | "invalid_points"
        | "invalid_wertung";
    };

function optTime(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  if (!Number.isFinite(n) || n < 0 || n > 3600) return undefined;
  return Math.round(n * 1000) / 1000;
}

function optInt(v: unknown, min: number, max: number): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

function optStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s.slice(0, 120);
}

export function parseResultImportItems(raw: unknown): ParsedResultImport {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "invalid_items" };
  const items: EndlaufResultImportItem[] = [];
  const seen = new Set<number>();
  for (const it of raw as Record<string, unknown>[]) {
    const driverId = Number(it?.driverId);
    if (!Number.isInteger(driverId)) return { ok: false, error: "invalid_driver" };
    if (seen.has(driverId)) return { ok: false, error: "duplicate_driver" };
    seen.add(driverId);

    const position = optInt(it.position, 1, 999);
    const startPosition = optInt(it.startPosition, 1, 999);
    if (position === undefined || startPosition === undefined)
      return { ok: false, error: "invalid_position" };

    const testTime = optTime(it.testTime);
    const run1Time = optTime(it.run1Time);
    const run2Time = optTime(it.run2Time);
    const totalTime = optTime(it.totalTime);
    if ([testTime, run1Time, run2Time, totalTime].some((t) => t === undefined))
      return { ok: false, error: "invalid_time" };

    const run1Penalty = optInt(it.run1Penalty, 0, 1000);
    const run2Penalty = optInt(it.run2Penalty, 0, 1000);
    const totalPenalty = optInt(it.totalPenalty, 0, 2000);
    if ([run1Penalty, run2Penalty, totalPenalty].some((p) => p === undefined))
      return { ok: false, error: "invalid_penalty" };

    const points = optInt(it.points, 0, 100);
    if (points === undefined) return { ok: false, error: "invalid_points" };

    let wertung: Wertung | null = null;
    if (it.wertung !== null && it.wertung !== undefined && it.wertung !== "") {
      const w = String(it.wertung).trim().toUpperCase();
      if (w !== "D" && w !== "M") return { ok: false, error: "invalid_wertung" };
      wertung = w;
    }

    const warnings = Array.isArray(it.warnings)
      ? (it.warnings as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 20)
      : [];

    items.push({
      driverId,
      position: position as number | null,
      startPosition: startPosition as number | null,
      wertung,
      testTime: testTime as number | null,
      run1Time: run1Time as number | null,
      run1Penalty: (run1Penalty as number | null) ?? 0,
      run2Time: run2Time as number | null,
      run2Penalty: (run2Penalty as number | null) ?? 0,
      totalPenalty: totalPenalty as number | null,
      totalTime: totalTime as number | null,
      points: points as number | null,
      sheetTeam: optStr(it.sheetTeam),
      sheetAdacId: optStr(it.sheetAdacId),
      warnings,
    });
  }
  return { ok: true, items };
}
