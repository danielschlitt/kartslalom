"use client";

/**
 * "Photograph the printed start list of one class → review → apply."
 *
 * 1. Pick/take a photo (downscaled in the browser).
 * 2. POST it to the start list OCR endpoint; the server reads the rows in
 *    printed order and proposes a driver of the class pool for every row.
 * 3. Review: the Startplatz of every row is editable (numbering by row
 *    order with one click when the sheet has no number column), the driver
 *    can be changed, rows can be left out.
 * 4. "Startaufstellung übernehmen" stores the photo and sets the live start
 *    order of the listed drivers. Drivers outside the field become
 *    Nachrücker automatically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ListOrdered,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { MatchCandidate } from "@/lib/ocr/match-entries";
import { DriverPicker, type PickerKind } from "@/components/driver-picker.client";
import { poolTag } from "@/components/endlauf26/results-import.client";
import type { PoolDriver } from "@/lib/endlauf26/results-types";
import type {
  StartListImportItem,
  StartListOcrResponse,
  StartListSheet,
  StartListSheetRow,
} from "@/lib/endlauf26/startlist-types";

/* ────────────────────────────── types ────────────────────────────── */

export interface StartListImportProps {
  eventId: number;
  ageClass: number;
  classLabel: string;
  /** Every driver of this class (field + Nachrücker pool). */
  pool: PoolDriver[];
  /** Current live start order of the class (to show what changes). */
  current: { driverId: number; startingOrder: number | null }[];
  onImported: (summary: { written: number; nominated: string[]; reactivated: string[] }) => void;
}

interface ReviewRow {
  id: number;
  ocr: StartListSheetRow;
  driverId: number | null;
  kind: PickerKind;
  score: number;
  include: boolean;
  /** Startplatz as text (editable). */
  position: string;
}

type Phase = "idle" | "ocr" | "review" | "saving";

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Nicht als Admin freigeschaltet — Seite neu laden und Admin-Token eingeben.",
  missing_api_key: "OPENAI_API_KEY fehlt — Foto-Erkennung ist nicht verfügbar.",
  missing_image: "Kein Bild übertragen.",
  image_too_large: "Bild ist zu groß (max. 12 MB).",
  upstream_error: "OpenAI hat die Anfrage abgelehnt.",
  upstream_unreachable: "OpenAI ist nicht erreichbar.",
  refusal: "Das Modell hat die Auswertung verweigert.",
  empty_response: "Keine Tabelle erkannt.",
  ocr_failed: "Tabelle konnte nicht gelesen werden.",
  invalid_driver: "Ein Fahrer gehört nicht zu dieser Meisterschaft.",
  driver_wrong_class: "Ein Fahrer gehört nicht zu dieser Klasse.",
  duplicate_driver: "Ein Fahrer ist mehrfach zugeordnet.",
  invalid_position: "Ungültiger Startplatz.",
  invalid_items: "Nichts zu übernehmen.",
};

/* ────────────────────────────── helpers ────────────────────────────── */

/** "" → null, "3" → 3, garbage → undefined */
function parsePosition(s: string): number | null | undefined {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 999) return undefined;
  return n;
}

async function downscaleImage(file: File, maxSide = 2048, quality = 0.9): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode_failed"));
      el.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 3 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function errorText(code: string, detail?: unknown): string {
  const base = ERROR_TEXT[code] ?? `Fehler (${code}).`;
  return typeof detail === "string" && detail && code.startsWith("upstream")
    ? `${base} ${detail.slice(0, 160)}`
    : base;
}

interface PoolCandidate extends MatchCandidate {
  driver: PoolDriver;
}

/* ────────────────────────────── root ────────────────────────────── */

export function EndlaufStartListImport({
  eventId,
  ageClass,
  classLabel,
  pool,
  current,
  onImported,
}: StartListImportProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageLarge, setImageLarge] = useState(false);
  const [sheet, setSheet] = useState<StartListSheet | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo<PoolCandidate[]>(
    () =>
      pool.map((d) => ({
        entryId: d.driverId,
        firstName: d.firstName,
        lastName: d.lastName,
        teamName: d.teamName,
        startingOrder: d.startingOrder,
        adacId: d.adacId,
        tag: poolTag(d),
        driver: d,
      })),
    [pool],
  );
  const candidateById = useMemo(
    () => new Map(candidates.map((c) => [c.entryId, c])),
    [candidates],
  );
  const currentByDriver = useMemo(
    () => new Map(current.map((c) => [c.driverId, c.startingOrder])),
    [current],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const reset = useCallback(() => {
    setPhase("idle");
    setSheet(null);
    setRows([]);
    setError(null);
    setImageBlob(null);
    setPreviewUrl(null);
    setImageLarge(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setSuccess(null);
      setSheet(null);
      setRows([]);
      setPhase("ocr");

      const blob = await downscaleImage(file);
      setImageBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));

      const form = new FormData();
      form.append("image", blob, "startliste.jpg");
      form.append("ageClass", String(ageClass));

      try {
        const res = await fetch(`/api/endlauf26/events/${eventId}/startlist/ocr`, {
          method: "POST",
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setError(errorText(typeof data.error === "string" ? data.error : "ocr_failed", data.detail));
          setPhase("idle");
          return;
        }
        const result = data as unknown as StartListOcrResponse;
        setSheet(result.sheet);
        setModel(result.model);
        // Sheets without a Startplatz column: the printed order is the order.
        const printed = result.sheet.rows.filter((r) => r.startPosition !== null).length;
        const useRowOrder = printed < result.sheet.rows.length / 2;
        setRows(
          result.sheet.rows.map((ocr, i) => {
            const m = result.matches[i];
            return {
              id: i,
              ocr,
              driverId: m?.driverId ?? null,
              kind: m?.kind ?? "none",
              score: m?.score ?? 0,
              include: (m?.driverId ?? null) !== null,
              position: useRowOrder
                ? String(i + 1)
                : ocr.startPosition === null
                  ? ""
                  : String(ocr.startPosition),
            };
          }),
        );
        setPhase("review");
      } catch (err) {
        setError(`Upload fehlgeschlagen: ${String(err)}`);
        setPhase("idle");
      }
    },
    [ageClass, eventId],
  );

  const updateRow = useCallback((id: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const setDriver = useCallback((id: number, driverId: number | null) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, driverId, kind: driverId === null ? "none" : "manual", score: 1, include: driverId !== null }
          : r,
      ),
    );
  }, []);

  const numberByRowOrder = useCallback(() => {
    setRows((prev) => prev.map((r, i) => ({ ...r, position: String(i + 1) })));
  }, []);

  /* derived validation */
  const invalidIds = useMemo(
    () => new Set(rows.filter((r) => parsePosition(r.position) === undefined).map((r) => r.id)),
    [rows],
  );

  const duplicateDriverIds = useMemo(() => {
    const seen = new Map<number, number>();
    for (const r of rows) {
      if (!r.include || r.driverId === null) continue;
      seen.set(r.driverId, (seen.get(r.driverId) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);

  const duplicatePositions = useMemo(() => {
    const seen = new Map<number, number>();
    for (const r of rows) {
      if (!r.include || r.driverId === null) continue;
      const p = parsePosition(r.position);
      if (p === null || p === undefined) continue;
      seen.set(p, (seen.get(p) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p));
  }, [rows]);

  const takenIds = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) if (r.include && r.driverId !== null) s.add(r.driverId);
    return s;
  }, [rows]);

  const items = useMemo<StartListImportItem[]>(() => {
    const out: StartListImportItem[] = [];
    for (const r of rows) {
      if (!r.include || r.driverId === null) continue;
      const p = parsePosition(r.position);
      if (p === null || p === undefined) continue;
      out.push({ driverId: r.driverId, startPosition: p });
    }
    return out;
  }, [rows]);

  const includedCount = rows.filter((r) => r.include && r.driverId !== null).length;
  const unmatchedRows = rows.filter((r) => r.driverId === null).length;
  const missingPosition = rows.filter(
    (r) => r.include && r.driverId !== null && parsePosition(r.position) === null,
  ).length;
  const anyInvalid = rows.some((r) => r.include && invalidIds.has(r.id));
  const missingPool = pool.filter(
    (d) => !d.withdrawn && (d.qualified || d.nominated) && !takenIds.has(d.driverId),
  );
  const canSave =
    phase === "review" &&
    items.length > 0 &&
    duplicateDriverIds.size === 0 &&
    duplicatePositions.size === 0 &&
    missingPosition === 0 &&
    !anyInvalid;

  const classMismatch = useMemo(() => {
    const label = sheet?.ageClassLabel ?? "";
    const m = /(\d)/.exec(label);
    return m ? Number(m[1]) !== ageClass : false;
  }, [sheet, ageClass]);

  const save = async () => {
    if (!canSave || !imageBlob) return;
    setPhase("saving");
    setError(null);
    try {
      const form = new FormData();
      form.append("ageClass", String(ageClass));
      form.append("items", JSON.stringify(items));
      form.append("image", imageBlob, "startliste.jpg");
      if (model) form.append("model", model);
      const res = await fetch(`/api/endlauf26/events/${eventId}/startlist`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(errorText(typeof data.error === "string" ? data.error : "ocr_failed"));
        setPhase("review");
        return;
      }
      const written = typeof data.written === "number" ? data.written : items.length;
      const nominated = Array.isArray(data.nominated) ? (data.nominated as string[]) : [];
      const reactivated = Array.isArray(data.reactivated) ? (data.reactivated as string[]) : [];
      setSuccess(
        [
          `${written} Startplätze übernommen, Foto gespeichert.`,
          nominated.length > 0 ? `Nachrücker: ${nominated.join(", ")}.` : "",
          reactivated.length > 0 ? `Wieder aktiviert: ${reactivated.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      reset();
      onImported({ written, nominated, reactivated });
    } catch (err) {
      setError(`Speichern fehlgeschlagen: ${String(err)}`);
      setPhase("review");
    }
  };

  const busy = phase === "ocr" || phase === "saving";

  return (
    <div className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-[var(--color-accent)]" />
          <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            {classLabel} — Startliste einlesen
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(ev) => void onFile(ev.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90",
              busy && "opacity-50",
            )}
          >
            {phase === "ocr" ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Lese Liste…
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                {phase === "review" ? "Anderes Foto" : "Foto aufnehmen / auswählen"}
              </>
            )}
          </button>
          {phase === "review" && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-4 w-4" /> Verwerfen
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {phase === "idle" && !error && !success && (
          <p className="text-xs text-[var(--color-muted)]">
            Foto der ausgehängten Startliste dieser Klasse aufnehmen (eine Klasse pro Foto; bei
            zwei Seiten nacheinander einlesen — Startplätze anderer Fahrer bleiben). Die gedruckte
            Reihenfolge wird zur Startreihenfolge; Fahrer, die nicht im Feld waren, werden als
            Nachrücker eingetragen. Solange ein Foto vorliegt, wird die Reihenfolge nicht mehr aus
            dem Meisterschaftsstand abgeleitet.
          </p>
        )}

        {success && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--color-rank-green)]/40 bg-[var(--color-rank-green)]/10 px-3 py-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-rank-green)]" />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {previewUrl && phase !== "idle" && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setImageLarge((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              {imageLarge ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              {imageLarge ? "Foto verkleinern" : "Foto vergrößern"}
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Fotografierte Startliste"
              onClick={() => setImageLarge((v) => !v)}
              className={cn(
                "cursor-zoom-in rounded-md border border-[var(--color-border)] object-contain",
                imageLarge ? "max-h-none w-full cursor-zoom-out" : "max-h-56",
              )}
            />
          </div>
        )}

        {phase === "ocr" && (
          <p className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Liste wird gelesen — das dauert je nach Foto 15–60 Sekunden.
          </p>
        )}

        {sheet && (phase === "review" || phase === "saving") && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
              {sheet.title && <span>Blatt: {sheet.title}</span>}
              {sheet.ageClassLabel && (
                <span className={cn(classMismatch && "text-red-400")}>
                  Klasse laut Blatt:{" "}
                  <strong className={cn(!classMismatch && "text-[var(--color-foreground)]")}>
                    {sheet.ageClassLabel}
                  </strong>
                  {classMismatch && " — passt nicht zu dieser Klasse!"}
                </span>
              )}
              <span>
                {rows.length} Zeilen · {includedCount} zugeordnet
                {unmatchedRows > 0 && (
                  <span className="text-[var(--color-pending)]"> · {unmatchedRows} ohne Fahrer</span>
                )}
              </span>
              {model && <span className="opacity-70">Modell: {model}</span>}
              <button
                type="button"
                onClick={numberByRowOrder}
                disabled={phase === "saving"}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)]"
                title="Startplätze 1…n in der Reihenfolge der Zeilen vergeben"
              >
                <ListOrdered className="h-3.5 w-3.5" /> Nach Reihenfolge nummerieren
              </button>
            </div>
            {sheet.notes && (
              <p className="text-xs text-[var(--color-muted)] italic">Hinweis des Modells: {sheet.notes}</p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-2 py-2 text-left" title="Zeile übernehmen">
                      <Check className="h-3.5 w-3.5" />
                    </th>
                    <th className="px-2 py-2 text-right">Start</th>
                    <th className="px-2 py-2 text-left">Auf dem Foto</th>
                    <th className="px-2 py-2 text-left">Fahrer</th>
                    <th className="px-2 py-2 text-right">Bisher</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const cand = r.driverId === null ? null : candidateById.get(r.driverId) ?? null;
                    const isDuplicateDriver = r.driverId !== null && duplicateDriverIds.has(r.driverId);
                    const pos = parsePosition(r.position);
                    const isDuplicatePosition =
                      r.include && pos !== null && pos !== undefined && duplicatePositions.has(pos);
                    const prev = r.driverId === null ? undefined : currentByDriver.get(r.driverId);
                    const disabled = phase === "saving";
                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b border-[var(--color-border)]/50 align-top last:border-0",
                          !r.include && "opacity-60",
                          r.driverId === null && "bg-[var(--color-pending)]/10",
                          (isDuplicateDriver || isDuplicatePosition) && "bg-red-500/10",
                        )}
                      >
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={r.include}
                            disabled={r.driverId === null || disabled}
                            onChange={(ev) => updateRow(r.id, { include: ev.target.checked })}
                            title={r.driverId === null ? "Zuerst einen Fahrer zuordnen" : "Zeile übernehmen"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={r.position}
                            disabled={disabled}
                            onChange={(ev) => updateRow(r.id, { position: ev.target.value })}
                            placeholder="—"
                            className={cn(
                              "w-14 rounded-md border bg-[var(--color-background)] px-1.5 py-1 text-right text-sm font-semibold tabular-nums",
                              invalidIds.has(r.id) || isDuplicatePosition
                                ? "border-red-500"
                                : r.include && pos === null
                                  ? "border-[var(--color-pending)]"
                                  : "border-[var(--color-border)]",
                            )}
                          />
                          {isDuplicatePosition && (
                            <div className="mt-1 text-xs text-red-400">Startplatz doppelt.</div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-medium">
                            {r.ocr.lastName} {r.ocr.firstName}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                            {[r.ocr.team, r.ocr.adacId ? `#${r.ocr.adacId}` : null, r.ocr.wertung, r.ocr.remark]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <DriverPicker
                            value={cand}
                            candidates={candidates}
                            takenIds={takenIds}
                            kind={r.kind}
                            score={r.score}
                            disabled={disabled}
                            onChange={(id) => setDriver(r.id, id)}
                          />
                          {isDuplicateDriver && (
                            <div className="mt-1 text-xs text-red-400">Fahrer ist mehrfach zugeordnet.</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">
                          {prev === undefined ? "" : (prev ?? "—")}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-4 text-center text-sm text-[var(--color-muted)]">
                        Keine Fahrerzeilen erkannt — anderes Foto versuchen.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {missingPool.length > 0 && (
              <p className="text-xs text-[var(--color-muted)]">
                Fahrer des Feldes ohne Zeile auf diesem Foto ({missingPool.length}):{" "}
                {missingPool.map((d) => `${d.lastName} ${d.firstName}`).join(", ")} — sie behalten
                ihren bisherigen Startplatz.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <span className="text-xs text-[var(--color-muted)]">
                Zeilen ohne Fahrer bleiben ausgelassen.
                {missingPosition > 0 && (
                  <span className="ml-1 text-[var(--color-pending)]">
                    {missingPosition} Zeilen ohne Startplatz.
                  </span>
                )}
                {duplicateDriverIds.size > 0 && (
                  <span className="ml-1 text-red-400">Doppelte Zuordnungen auflösen.</span>
                )}
                {duplicatePositions.size > 0 && (
                  <span className="ml-1 text-red-400">Doppelte Startplätze auflösen.</span>
                )}
              </span>
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white",
                  !canSave && "cursor-not-allowed opacity-50",
                )}
              >
                {phase === "saving" ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Startaufstellung übernehmen ({items.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
