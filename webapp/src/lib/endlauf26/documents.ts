/**
 * Source documents of the Endläufe: the official standings PDFs every driver
 * row was derived from. One slot per list; admins can upload/replace the file
 * behind a slot, everybody can open it.
 */

import type { Endlauf26Championship } from "./ranking";

export interface DocumentSlot {
  key: string;
  label: string;
  /** File name in data/endlauf26/source used by the seed. */
  seedFile: string;
}

export const ENDLAUF26_DOCUMENT_SLOTS: Record<Endlauf26Championship, DocumentSlot[]> = {
  hmj: [
    {
      key: "hmj",
      label: "hmj Hessische Meisterschaft – Zwischenstand",
      seedFile: "2026_hmj_KS_Hessische_Meisterschaft_Zwischenstand.pdf",
    },
  ],
  adac_hth: [
    { key: "nord", label: "JKS Nord – Zwischenstand", seedFile: "JKS-Nord-260816.pdf" },
    { key: "sued", label: "JKS Süd – Zwischenstand", seedFile: "JKS-Sued-260816.pdf" },
    { key: "ost", label: "JKS Ost – Zwischenstand", seedFile: "JKS-Ost_260831.pdf" },
  ],
};

export function documentSlot(
  championship: Endlauf26Championship,
  key: string,
): DocumentSlot | null {
  return ENDLAUF26_DOCUMENT_SLOTS[championship].find((s) => s.key === key) ?? null;
}

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
