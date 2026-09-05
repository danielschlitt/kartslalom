"use client";

/**
 * "Photograph the result sheet → fill in all times of one class."
 *
 * 1. Pick/take a photo (downscaled in the browser to keep uploads small).
 * 2. POST it to `ocrEndpoint`; the server OCRs the table with OpenAI and
 *    proposes which entry each row belongs to (fuzzy name + Verein match).
 * 3. Review: every row shows what was read, the proposed driver (searchable
 *    picker limited to the entries of this class), and editable time /
 *    Strafsekunden cells. Unmatched rows are highlighted and excluded until a
 *    driver is chosen.
 * 4. "Zeiten übernehmen" bulk-saves via `importEndpoint`.
 *
 * Used by both the regular-season and the Endlauf admin pages; the endpoints
 * and the class field name differ, everything else is shared.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  searchCandidates,
  type MatchCandidate,
  type MatchKind,
} from "@/lib/ocr/match-entries";
import type {
  ImportRunsItem,
  OcrResultsResponse,
  OcrRow,
  OcrSheet,
  RunType,
} from "@/lib/ocr/types";

/* ────────────────────────────── types ────────────────────────────── */

export interface SheetImportRun {
  timeSeconds: number | null;
  penaltySeconds: number;
}

export interface SheetImportEntry extends MatchCandidate {
  runs: Record<RunType, SheetImportRun | null>;
}

export interface ResultsSheetImportProps {
  /** POST multipart `{ image, ...classPayload }` → `OcrResultsResponse`. */
  ocrEndpoint: string;
  /** POST JSON `{ ...classPayload, items }`. */
  importEndpoint: string;
  /** e.g. `{ ageClassId: 5 }` (Saison) or `{ ageClass: 5 }` (Endlauf). */
  classPayload: Record<string, number>;
  classLabel: string;
  entries: SheetImportEntry[];
  onImported: (summary: { written: number }) => void;
}

interface Cell {
  time: string;
  penalty: string;
}

interface ReviewRow {
  id: number;
  ocr: OcrRow;
  entryId: number | null;
  kind: MatchKind | "manual";
  score: number;
  include: boolean;
  cells: Record<RunType, Cell>;
}

type Phase = "idle" | "ocr" | "review" | "saving";

const RUN_TYPES: RunType[] = ["test", "first", "second"];
const RUN_LABEL: Record<RunType, string> = {
  test: "Training",
  first: "Lauf 1",
  second: "Lauf 2",
};

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Nicht als Admin freigeschaltet — Seite neu laden und Admin-Token eingeben.",
  missing_api_key: "OPENAI_API_KEY fehlt — Foto-Erkennung ist nicht verfügbar.",
  missing_image: "Kein Bild übertragen.",
  image_too_large: "Bild ist zu groß (max. 12 MB).",
  age_class_finalized: "Klasse ist bereits finalisiert — Zeiten sind gesperrt.",
  event_not_live: "Das Rennen ist nicht live.",
  upstream_error: "OpenAI hat die Anfrage abgelehnt.",
  upstream_unreachable: "OpenAI ist nicht erreichbar.",
  refusal: "Das Modell hat die Auswertung verweigert.",
  empty_response: "Keine Tabelle erkannt.",
  ocr_failed: "Tabelle konnte nicht gelesen werden.",
  invalid_entry: "Ein Fahrer gehört nicht zu dieser Klasse.",
  duplicate_entry: "Ein Fahrer ist mehrfach zugeordnet.",
  invalid_time: "Ungültige Zeit.",
  invalid_penalty: "Ungültige Strafsekunden.",
  invalid_items: "Nichts zu übernehmen.",
};

/* ────────────────────────────── helpers ────────────────────────────── */

function fmtTime(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

/** "" → null, "34,10" → 34.1, garbage → undefined */
function parseTime(s: string): number | null | undefined {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 3600) return undefined;
  return Math.round(n * 1000) / 1000;
}

/** "" → 0, "2" → 2, garbage → undefined */
function parsePenalty(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 1000) return undefined;
  return n;
}

function cellIsEmpty(c: Cell): boolean {
  return c.time.trim() === "" && (c.penalty.trim() === "" || c.penalty.trim() === "0");
}

function cellFromOcr(run: OcrRow["runs"][RunType]): Cell {
  if (!run) return { time: "", penalty: "" };
  return {
    time: fmtTime(run.timeSeconds),
    penalty: run.penaltySeconds === null ? "" : String(run.penaltySeconds),
  };
}

/**
 * Downscale a photo so the longest side is at most `maxSide` px and re-encode
 * as JPEG. Phone photos are 10+ MP; 2048 px is plenty for a table and keeps
 * the upload (and the OpenAI image tokens) small. Falls back to the original
 * file when the browser can't decode it.
 */
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

/* ────────────────────────────── root ────────────────────────────── */

export function ResultsSheetImport({
  ocrEndpoint,
  importEndpoint,
  classPayload,
  classLabel,
  entries,
  onImported,
}: ResultsSheetImportProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageLarge, setImageLarge] = useState(false);
  const [sheet, setSheet] = useState<OcrSheet | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [showTest, setShowTest] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const entryById = useMemo(() => new Map(entries.map((e) => [e.entryId, e])), [entries]);

  // Free the preview object URL when it is replaced or the component unmounts.
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
      setPreviewUrl(URL.createObjectURL(blob));

      const form = new FormData();
      form.append("image", blob, "sheet.jpg");
      for (const [k, v] of Object.entries(classPayload)) form.append(k, String(v));

      try {
        const res = await fetch(ocrEndpoint, { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setError(errorText(typeof data.error === "string" ? data.error : "ocr_failed", data.detail));
          setPhase("idle");
          return;
        }
        const result = data as unknown as OcrResultsResponse;
        setSheet(result.sheet);
        setModel(result.model);
        setShowTest(result.sheet.hasTestRun);
        setRows(
          result.sheet.rows.map((ocr, i) => {
            const m = result.matches[i];
            return {
              id: i,
              ocr,
              entryId: m?.entryId ?? null,
              kind: m?.kind ?? "none",
              score: m?.score ?? 0,
              include: (m?.entryId ?? null) !== null,
              cells: {
                test: cellFromOcr(ocr.runs.test),
                first: cellFromOcr(ocr.runs.first),
                second: cellFromOcr(ocr.runs.second),
              },
            };
          }),
        );
        setPhase("review");
      } catch (err) {
        setError(`Upload fehlgeschlagen: ${String(err)}`);
        setPhase("idle");
      }
    },
    [classPayload, ocrEndpoint],
  );

  const updateRow = useCallback((id: number, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const updateCell = useCallback((id: number, rt: RunType, patch: Partial<Cell>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, cells: { ...r.cells, [rt]: { ...r.cells[rt], ...patch } } } : r,
      ),
    );
  }, []);

  const setDriver = useCallback(
    (id: number, entryId: number | null) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, entryId, kind: entryId === null ? "none" : "manual", score: 1, include: entryId !== null }
            : r,
        ),
      );
    },
    [],
  );

  /* derived validation */
  const activeRunTypes = useMemo<RunType[]>(
    () => (showTest ? RUN_TYPES : ["first", "second"]),
    [showTest],
  );

  const duplicateIds = useMemo(() => {
    const seen = new Map<number, number>();
    for (const r of rows) {
      if (!r.include || r.entryId === null) continue;
      seen.set(r.entryId, (seen.get(r.entryId) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);

  const invalidCells = useMemo(() => {
    const bad = new Set<string>();
    for (const r of rows) {
      if (!r.include) continue;
      for (const rt of activeRunTypes) {
        const c = r.cells[rt];
        if (parseTime(c.time) === undefined) bad.add(`${r.id}:${rt}:time`);
        if (parsePenalty(c.penalty) === undefined) bad.add(`${r.id}:${rt}:penalty`);
      }
    }
    return bad;
  }, [rows, activeRunTypes]);

  const takenIds = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) if (r.include && r.entryId !== null) s.add(r.entryId);
    return s;
  }, [rows]);

  const items = useMemo<ImportRunsItem[]>(() => {
    const out: ImportRunsItem[] = [];
    for (const r of rows) {
      if (!r.include || r.entryId === null) continue;
      const runs: ImportRunsItem["runs"] = {};
      for (const rt of activeRunTypes) {
        const c = r.cells[rt];
        if (cellIsEmpty(c)) continue;
        const t = parseTime(c.time);
        const p = parsePenalty(c.penalty);
        if (t === undefined || p === undefined) continue;
        runs[rt] = { timeSeconds: t, penaltySeconds: p };
      }
      if (Object.keys(runs).length > 0) out.push({ entryId: r.entryId, runs });
    }
    return out;
  }, [rows, activeRunTypes]);

  const includedCount = rows.filter((r) => r.include && r.entryId !== null).length;
  const unmatchedRows = rows.filter((r) => r.entryId === null).length;
  const missingEntries = entries.filter((e) => !takenIds.has(e.entryId));
  const canSave =
    phase === "review" && items.length > 0 && duplicateIds.size === 0 && invalidCells.size === 0;

  const save = async () => {
    if (!canSave) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch(importEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...classPayload, items }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(errorText(typeof data.error === "string" ? data.error : "ocr_failed"));
        setPhase("review");
        return;
      }
      const written = typeof data.written === "number" ? data.written : items.length;
      setSuccess(
        `${items.length} Fahrer aktualisiert (${written} Zeiten geschrieben). Werte in der Tabelle oben prüfen.`,
      );
      reset();
      onImported({ written });
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
            {classLabel} — Ergebnisliste per Foto einlesen
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {/* No `capture` attribute: on phones the OS then offers both the camera
              and the gallery, so a photo someone else sent can be used too. */}
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
                <RefreshCw className="h-4 w-4 animate-spin" /> Lese Tabelle…
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
            Foto der ausgehängten Zeitentabelle dieser Klasse aufnehmen. Die Tabelle wird per OpenAI
            ausgelesen, Fahrer und Verein werden den Startern der Klasse zugeordnet — danach alles
            prüfen, korrigieren und übernehmen. Möglichst gerade, scharf und ohne Spiegelungen
            fotografieren; eine Klasse pro Foto.
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
              alt="Fotografierte Ergebnisliste"
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
            Tabelle wird gelesen — das dauert je nach Foto 15–60 Sekunden.
          </p>
        )}

        {sheet && (phase === "review" || phase === "saving") && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
              {sheet.title && <span>Blatt: {sheet.title}</span>}
              {sheet.ageClassLabel && (
                <span>
                  Klasse laut Blatt: <strong className="text-[var(--color-foreground)]">{sheet.ageClassLabel}</strong>
                </span>
              )}
              <span>
                {rows.length} Zeilen · {includedCount} zugeordnet
                {unmatchedRows > 0 && (
                  <span className="text-[var(--color-pending)]"> · {unmatchedRows} ohne Fahrer</span>
                )}
              </span>
              {model && <span className="opacity-70">Modell: {model}</span>}
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showTest}
                  onChange={(ev) => setShowTest(ev.target.checked)}
                />
                Trainingsspalte übernehmen
              </label>
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
                    <th className="px-2 py-2 text-left">Auf dem Foto</th>
                    <th className="px-2 py-2 text-left">Fahrer</th>
                    {activeRunTypes.map((rt) => (
                      <th key={rt} className="px-2 py-2 text-right whitespace-nowrap">
                        {RUN_LABEL[rt]}
                        <span className="ml-1 font-normal normal-case opacity-70">Zeit / +s</span>
                      </th>
                    ))}
                    <th className="px-2 py-2 text-left">Hinweise</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const entry = r.entryId === null ? null : entryById.get(r.entryId) ?? null;
                    const isDuplicate = r.entryId !== null && duplicateIds.has(r.entryId);
                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b border-[var(--color-border)]/50 align-top last:border-0",
                          !r.include && "opacity-60",
                          r.entryId === null && "bg-[var(--color-pending)]/10",
                          isDuplicate && "bg-red-500/10",
                        )}
                      >
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={r.include}
                            disabled={r.entryId === null || phase === "saving"}
                            onChange={(ev) => updateRow(r.id, { include: ev.target.checked })}
                            title={r.entryId === null ? "Zuerst einen Fahrer zuordnen" : "Zeile übernehmen"}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-medium">
                            {r.ocr.position !== null && (
                              <span className="mr-1.5 text-xs text-[var(--color-muted)]">{r.ocr.position}.</span>
                            )}
                            {r.ocr.lastName} {r.ocr.firstName}
                          </div>
                          <div className="text-xs text-[var(--color-muted)]">
                            {r.ocr.team ?? "—"}
                            {r.ocr.startNumber !== null && ` · Nr. ${r.ocr.startNumber}`}
                            {r.ocr.remark && ` · ${r.ocr.remark}`}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <DriverPicker
                            value={entry}
                            candidates={entries}
                            takenIds={takenIds}
                            kind={r.kind}
                            score={r.score}
                            disabled={phase === "saving"}
                            onChange={(id) => setDriver(r.id, id)}
                          />
                          {isDuplicate && (
                            <div className="mt-1 text-xs text-red-400">Fahrer ist mehrfach zugeordnet.</div>
                          )}
                        </td>
                        {activeRunTypes.map((rt) => {
                          const c = r.cells[rt];
                          const existing = entry?.runs[rt] ?? null;
                          const badTime = invalidCells.has(`${r.id}:${rt}:time`);
                          const badPenalty = invalidCells.has(`${r.id}:${rt}:penalty`);
                          const newTime = parseTime(c.time);
                          const newPenalty = parsePenalty(c.penalty);
                          const differs =
                            existing !== null &&
                            !cellIsEmpty(c) &&
                            (existing.timeSeconds !== (newTime ?? null) ||
                              existing.penaltySeconds !== (newPenalty ?? 0));
                          return (
                            <td key={rt} className="px-2 py-2">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={c.time}
                                  disabled={phase === "saving"}
                                  onChange={(ev) => updateCell(r.id, rt, { time: ev.target.value })}
                                  placeholder="—"
                                  className={cn(
                                    "w-20 rounded-md border bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums",
                                    badTime ? "border-red-500" : "border-[var(--color-border)]",
                                  )}
                                />
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  value={c.penalty}
                                  disabled={phase === "saving"}
                                  onChange={(ev) => updateCell(r.id, rt, { penalty: ev.target.value })}
                                  placeholder="0"
                                  title="Strafsekunden"
                                  className={cn(
                                    "w-14 rounded-md border bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums",
                                    badPenalty ? "border-red-500" : "border-[var(--color-border)]",
                                  )}
                                />
                              </div>
                              {existing && (
                                <div
                                  className={cn(
                                    "mt-0.5 text-right text-[10px] tabular-nums",
                                    differs ? "text-[var(--color-pending)]" : "text-[var(--color-muted)]",
                                  )}
                                  title="Bisher gespeicherter Wert"
                                >
                                  bisher {fmtTime(existing.timeSeconds) || "—"}
                                  {existing.penaltySeconds > 0 && ` +${existing.penaltySeconds}`}
                                  {differs && " → wird überschrieben"}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-xs">
                          {r.ocr.warnings.length > 0 && (
                            <ul className="space-y-0.5 text-[var(--color-pending)]">
                              {r.ocr.warnings.map((w, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                  {w}
                                </li>
                              ))}
                            </ul>
                          )}
                          {r.ocr.total !== null && (
                            <div className="text-[var(--color-muted)]">Gesamt laut Blatt: {fmtTime(r.ocr.total)}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4 + activeRunTypes.length} className="px-2 py-4 text-center text-sm text-[var(--color-muted)]">
                        Keine Fahrerzeilen erkannt — anderes Foto versuchen.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {missingEntries.length > 0 && (
              <p className="text-xs text-[var(--color-muted)]">
                Nicht auf dem Foto zugeordnet ({missingEntries.length}):{" "}
                {missingEntries.map((e) => `${e.lastName} ${e.firstName}`).join(", ")}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <span className="text-xs text-[var(--color-muted)]">
                Leere Felder werden nicht übernommen; vorhandene Zeiten der gewählten Fahrer werden
                überschrieben. Zeilen ohne Fahrer bleiben ausgelassen.
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
                Zeiten übernehmen ({items.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────── driver picker ────────────────────────────── */

function DriverPicker({
  value,
  candidates,
  takenIds,
  kind,
  score,
  disabled,
  onChange,
}: {
  value: SheetImportEntry | null;
  candidates: SheetImportEntry[];
  takenIds: Set<number>;
  kind: MatchKind | "manual";
  score: number;
  disabled: boolean;
  onChange: (entryId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCandidates(query, candidates).slice(0, 8), [query, candidates]);

  useEffect(() => setActive(0), [query]);

  const pick = (id: number | null) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const badge =
    value === null ? (
      <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-pending)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-pending)] uppercase">
        <AlertTriangle className="h-3 w-3" /> kein Treffer
      </span>
    ) : kind === "manual" ? (
      <span className="rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase">
        manuell
      </span>
    ) : kind === "high" ? (
      <span className="rounded-sm bg-[var(--color-rank-green)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-rank-green)] uppercase">
        {Math.round(score * 100)} %
      </span>
    ) : (
      <span
        className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-pending)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-pending)] uppercase"
        title="Unsichere Zuordnung — bitte prüfen"
      >
        <AlertTriangle className="h-3 w-3" /> {Math.round(score * 100)} % prüfen
      </span>
    );

  return (
    <div className="relative min-w-[14rem]">
      <div
        className={cn(
          "flex items-center gap-1 rounded-md border bg-[var(--color-background)] px-2 py-1",
          value === null
            ? "border-[var(--color-pending)]/60"
            : kind === "low"
              ? "border-[var(--color-pending)]/40"
              : "border-[var(--color-border)]",
          disabled && "opacity-60",
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
        <input
          ref={inputRef}
          type="text"
          value={open ? query : value ? `${value.lastName} ${value.firstName}` : ""}
          placeholder="Fahrer suchen…"
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onBlur={() => setOpen(false)}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => {
            if (!open) return;
            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              setActive((a) => Math.min(a + 1, results.length));
            } else if (ev.key === "ArrowUp") {
              ev.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (ev.key === "Enter") {
              ev.preventDefault();
              if (active < results.length) pick(results[active].entryId);
              else pick(null);
            } else if (ev.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent text-sm outline-none"
        />
        {value !== null && !open && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => pick(null)}
            disabled={disabled}
            className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            title="Zuordnung entfernen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]">
        {badge}
        {value && <span>{value.teamName}</span>}
      </div>

      {open && (
        <ul
          onMouseDown={(ev) => ev.preventDefault()}
          className="absolute z-20 mt-1 max-h-64 w-full min-w-[18rem] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
        >
          {results.map((c, i) => {
            const taken = takenIds.has(c.entryId) && c.entryId !== value?.entryId;
            return (
              <li key={c.entryId}>
                <button
                  type="button"
                  onClick={() => pick(c.entryId)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                    i === active && "bg-[var(--color-surface-2)]",
                    c.entryId === value?.entryId && "font-semibold",
                  )}
                >
                  <span>
                    {c.lastName} {c.firstName}
                    <span className="ml-2 text-xs text-[var(--color-muted)]">{c.teamName}</span>
                  </span>
                  {taken && (
                    <span className="shrink-0 text-[10px] text-[var(--color-pending)] uppercase">
                      bereits zugeordnet
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="px-3 py-1.5 text-sm text-[var(--color-muted)]">Kein Fahrer gefunden.</li>
          )}
          <li className="border-t border-[var(--color-border)]/60">
            <button
              type="button"
              onClick={() => pick(null)}
              onMouseEnter={() => setActive(results.length)}
              className={cn(
                "w-full px-3 py-1.5 text-left text-sm text-[var(--color-muted)]",
                active === results.length && "bg-[var(--color-surface-2)]",
              )}
            >
              Keine Zuordnung (Zeile überspringen)
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
