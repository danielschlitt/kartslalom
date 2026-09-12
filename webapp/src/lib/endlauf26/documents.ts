/**
 * Source documents of the Endläufe: the official lists every driver row was
 * derived from — hmj: the standings PDF; ADAC: the final start list (CSV,
 * the single source of truth for the field) plus the regional standings
 * PDFs it was compiled from. One slot per list; admins can upload/replace
 * the file behind a slot, everybody can open it.
 */

import type { Endlauf26Championship } from "./ranking";
import { ADAC_FIELD_CSV } from "./adac-field";

export type DocumentMime = "application/pdf" | "text/csv";

export interface DocumentSlot {
  key: string;
  label: string;
  /** Path relative to data/endlauf26 the seed fills the slot from. */
  seedFile: string;
  mime: DocumentMime;
}

export const ENDLAUF26_DOCUMENT_SLOTS: Record<Endlauf26Championship, DocumentSlot[]> = {
  hmj: [
    {
      key: "hmj",
      label: "hmj Hessische Meisterschaft – Zwischenstand",
      seedFile: "source/2026_hmj_KS_Hessische_Meisterschaft_Zwischenstand.pdf",
      mime: "application/pdf",
    },
  ],
  adac_hth: [
    {
      key: "startliste",
      label: "Startliste Endläufe 2026 (Fahrerfeld, Startplätze Endlauf 1)",
      seedFile: ADAC_FIELD_CSV,
      mime: "text/csv",
    },
    { key: "nord", label: "JKS Nord – Zwischenstand", seedFile: "source/JKS-Nord-260816.pdf", mime: "application/pdf" },
    { key: "sued", label: "JKS Süd – Zwischenstand", seedFile: "source/JKS-Sued-260816.pdf", mime: "application/pdf" },
    { key: "ost", label: "JKS Ost – Zwischenstand", seedFile: "source/JKS-Ost_260831.pdf", mime: "application/pdf" },
  ],
};

export function documentSlot(
  championship: Endlauf26Championship,
  key: string,
): DocumentSlot | null {
  return ENDLAUF26_DOCUMENT_SLOTS[championship].find((s) => s.key === key) ?? null;
}

/** Whether an uploaded file fits the slot (PDF slots take PDFs, the CSV slot takes CSV). */
export function fileFitsSlot(slot: DocumentSlot, file: { type: string; name: string }): boolean {
  if (slot.mime === "text/csv") {
    return file.type === "text/csv" || /\.csv$/i.test(file.name);
  }
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
