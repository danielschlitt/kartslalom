/**
 * Shared types for the official Endlauf results (photographed result list →
 * OCR → review → `endlauf26_results`). Imported by API routes, the review UI
 * and the public results table, so keep this file free of server-only code.
 */

import type { MatchKind } from "@/lib/ocr/match-entries";

export type Wertung = "D" | "M";

/** One driver row as read from the result list (all values as printed). */
export interface EndlaufSheetRow {
  position: number | null;
  startPosition: number | null;
  lastName: string;
  firstName: string;
  team: string | null;
  adacId: string | null;
  wertung: string | null;
  testTime: number | null;
  run1Time: number | null;
  run1Penalty: number | null;
  run2Time: number | null;
  run2Penalty: number | null;
  totalPenalty: number | null;
  totalTime: number | null;
  points: number | null;
  remark: string | null;
}

export interface EndlaufSheet {
  title: string | null;
  ageClassLabel: string | null;
  /** Model remarks about legibility etc. (German). */
  notes: string;
  rows: EndlaufSheetRow[];
}

/** A driver of the class pool offered for matching (field + Nachrücker candidates). */
export interface PoolDriver {
  driverId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  adacId: string | null;
  qualified: boolean;
  nominated: boolean;
  withdrawn: boolean;
  /** Live-timing start order, if any (helps the fuzzy match). */
  startingOrder: number | null;
}

export interface EndlaufOcrResponse {
  ok: true;
  sheet: EndlaufSheet;
  /** Per row: proposed pool driver. */
  matches: { driverId: number | null; score: number; kind: MatchKind }[];
  /** Club names known for this championship — for the Ortsclub check. */
  knownClubs: string[];
  model: string;
}

/** One row of the bulk import request. */
export interface EndlaufResultImportItem {
  driverId: number;
  position: number | null;
  startPosition: number | null;
  wertung: Wertung | null;
  testTime: number | null;
  run1Time: number | null;
  run1Penalty: number;
  run2Time: number | null;
  run2Penalty: number;
  totalPenalty: number | null;
  totalTime: number | null;
  points: number | null;
  sheetTeam: string | null;
  sheetAdacId: string | null;
  warnings: string[];
}

/** Official result of one driver at one event, joined with the driver (for display). */
export interface EndlaufResultRow {
  id: number;
  eventId: number;
  driverId: number;
  ageClass: number;
  position: number | null;
  startPosition: number | null;
  wertung: string | null;
  testTime: number | null;
  run1Time: number | null;
  run1Penalty: number;
  run2Time: number | null;
  run2Penalty: number;
  totalPenalty: number | null;
  totalTime: number | null;
  points: number | null;
  sheetTeam: string | null;
  sheetAdacId: string | null;
  warnings: string[];
  imageId: number | null;
  firstName: string;
  lastName: string;
  teamName: string;
  /** Green in the standings list. `false` → Nachrücker. */
  qualified: boolean;
  nominated: boolean;
  withdrawn: boolean;
}

export interface EndlaufResultImageMeta {
  id: number;
  eventId: number;
  ageClass: number;
  mime: string;
  size: number;
  uploadedAt: string;
  /** Number of result rows read from this photo. */
  rowCount: number;
}
