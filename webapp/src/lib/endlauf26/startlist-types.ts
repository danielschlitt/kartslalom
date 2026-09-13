/**
 * Shared types for the start list of an age class (photographed
 * Startaufstellung → OCR → review → `endlauf26_entries.starting_order`).
 * Imported by API routes, the review UI and the public pages, so keep this
 * file free of server-only code.
 */

import type { MatchKind } from "@/lib/ocr/match-entries";

/** One driver row as printed on the start list. */
export interface StartListSheetRow {
  /** Startplatz as printed; null when the sheet has no number column (row order is used then). */
  startPosition: number | null;
  lastName: string;
  firstName: string;
  team: string | null;
  adacId: string | null;
  wertung: string | null;
  remark: string | null;
}

export interface StartListSheet {
  title: string | null;
  ageClassLabel: string | null;
  /** Model remarks about legibility etc. (German). */
  notes: string;
  rows: StartListSheetRow[];
}

export interface StartListOcrResponse {
  ok: true;
  sheet: StartListSheet;
  /** Per row: proposed pool driver. */
  matches: { driverId: number | null; score: number; kind: MatchKind }[];
  model: string;
}

/** One row of the "apply start list" request. */
export interface StartListImportItem {
  driverId: number;
  startPosition: number;
}

export interface EndlaufStartListMeta {
  id: number;
  eventId: number;
  ageClass: number;
  mime: string;
  size: number;
  rowCount: number;
  model: string | null;
  uploadedAt: string;
}

/**
 * Where the start order of one class at one event comes from:
 *  - `results`   an official result list exists — the printed Startplatz is history
 *  - `startlist` at least one start list photo was read for the class
 *  - `csv`       ADAC Endlauf 1: column 2 of the final start list CSV
 *  - `standings` the championship standing before the event, bottom-up
 */
export type StartOrderSource = "results" | "startlist" | "csv" | "standings";

/** A driver of the start grid as shown on public pages. */
export interface StartGridRow {
  driverId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  startingOrder: number | null;
  nominated: boolean;
}
