/**
 * Shared types for the "photograph the result sheet → fill in times" flow.
 * Imported by both the API routes and the client review component, so keep
 * this file free of server-only code.
 */

import type { MatchKind } from "./match-entries";

export type RunType = "test" | "first" | "second";

export interface OcrRunValue {
  timeSeconds: number | null;
  penaltySeconds: number | null;
}

/** One driver row as read from the sheet, already normalized to our run model. */
export interface OcrRow {
  position: number | null;
  startNumber: number | null;
  lastName: string;
  firstName: string;
  team: string | null;
  /** Free text found in a remark/Verband column, e.g. "Gast", "DNF". */
  remark: string | null;
  runs: {
    test: OcrRunValue | null;
    first: OcrRunValue | null;
    second: OcrRunValue | null;
  };
  /** "Gesamt" column of the sheet (sum of run totals), if present. */
  total: number | null;
  /** Consistency problems detected after extraction (German, for the UI). */
  warnings: string[];
}

export interface OcrSheet {
  title: string | null;
  ageClassLabel: string | null;
  /** Whether the sheet has a Training/Testlauf column at all. */
  hasTestRun: boolean;
  /** Model remarks about legibility etc. (German). */
  notes: string;
  rows: OcrRow[];
}

/** Per-row match proposal returned by the OCR endpoints. */
export interface OcrRowMatch {
  entryId: number | null;
  score: number;
  kind: MatchKind;
}

export interface OcrResultsResponse {
  ok: true;
  sheet: OcrSheet;
  matches: OcrRowMatch[];
  model: string;
}

/** Body of the bulk import endpoints. Missing run keys are left untouched. */
export interface ImportRunsItem {
  entryId: number;
  runs: Partial<Record<RunType, { timeSeconds: number | null; penaltySeconds: number }>>;
}
