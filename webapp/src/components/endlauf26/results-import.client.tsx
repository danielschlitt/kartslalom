"use client";

/**
 * "Photograph the official result list of one class → review → import."
 *
 * 1. Pick/take a photo (downscaled in the browser).
 * 2. POST it to the OCR endpoint; the server reads the full hmj column set
 *    and proposes a driver of the class pool (field + Nachrücker candidates)
 *    for every row.
 * 3. Review: every printed value is editable, plausibility checks run on
 *    every edit (sums, order vs. Gesamtzeit, points table, Ortsclub against
 *    the known clubs, Wertung). Unknown clubs must be acknowledged or added.
 * 4. "Ergebnisse übernehmen" stores the rows (position = source of truth) and
 *    the photo. Drivers outside the field become Nachrücker automatically.
 *
 * No live state is required at any point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { MatchCandidate } from "@/lib/ocr/match-entries";
import { DriverPicker, type PickerKind } from "@/components/driver-picker.client";
import { checkSheet, closestClub, rankClubs, type CheckableRow } from "@/lib/endlauf26/result-checks";
import type {
  EndlaufOcrResponse,
  EndlaufResultImportItem,
  EndlaufResultRow,
  EndlaufSheet,
  EndlaufSheetRow,
  PoolDriver,
} from "@/lib/endlauf26/results-types";

/* ────────────────────────────── types ────────────────────────────── */

export interface ResultsImportProps {
  eventId: number;
  /** URL slug of the championship ("hmj" | "adac-hth") — for the club endpoint. */
  championshipSlug: string;
  ageClass: number;
  classLabel: string;
  /** Every driver of this class (field + Nachrücker pool). */
  pool: PoolDriver[];
  /** Rows already imported for this class (to show what gets replaced). */
  existing: EndlaufResultRow[];
  onImported: (summary: { written: number; nominated: string[]; reactivated: string[] }) => void;
}

interface Fields {
  position: string;
  startPosition: string;
  wertung: string;
  team: string;
  adacId: string;
  testTime: string;
  run1Time: string;
  run1Penalty: string;
  run2Time: string;
  run2Penalty: string;
  totalPenalty: string;
  totalTime: string;
  points: string;
}

type FieldKey = keyof Fields;

interface ReviewRow {
  id: number;
  ocr: EndlaufSheetRow;
  driverId: number | null;
  kind: PickerKind;
  score: number;
  include: boolean;
  /** Admin accepted an Ortsclub that is not in the known list. */
  acceptClub: boolean;
  f: Fields;
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
  invalid_position: "Ungültiger Platz oder Startplatz.",
  invalid_time: "Ungültige Zeit.",
  invalid_penalty: "Ungültige Strafsekunden.",
  invalid_points: "Ungültige Punkte.",
  invalid_wertung: "Wertung muss D oder M sein.",
  invalid_items: "Nichts zu übernehmen.",
  invalid_name: "Ungültiger Vereinsname.",
};

/* ────────────────────────────── helpers ────────────────────────────── */

function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toFixed(decimals).replace(".", ",");
}

function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

/** "" → null, "34,10" → 34.1, garbage → undefined */
function parseTime(s: string): number | null | undefined {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 3600) return undefined;
  return Math.round(n * 1000) / 1000;
}

/** "" → null, "2" → 2, garbage → undefined */
function parseInt0(s: string, max = 1000): number | null | undefined {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > max) return undefined;
  return n;
}

function parseWertung(s: string): "D" | "M" | null | undefined {
  const t = s.trim().toUpperCase();
  if (t === "") return null;
  if (t === "D" || t === "M") return t;
  return undefined;
}

function fieldsFromOcr(r: EndlaufSheetRow): Fields {
  return {
    position: fmtInt(r.position),
    startPosition: fmtInt(r.startPosition),
    wertung: r.wertung ?? "",
    team: r.team ?? "",
    adacId: r.adacId ?? "",
    testTime: fmtNum(r.testTime),
    run1Time: fmtNum(r.run1Time),
    run1Penalty: fmtInt(r.run1Penalty),
    run2Time: fmtNum(r.run2Time),
    run2Penalty: fmtInt(r.run2Penalty),
    totalPenalty: fmtInt(r.totalPenalty),
    totalTime: fmtNum(r.totalTime),
    points: fmtInt(r.points),
  };
}

const und = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

function toCheckable(f: Fields): CheckableRow {
  return {
    position: und(parseInt0(f.position, 999)),
    startPosition: und(parseInt0(f.startPosition, 999)),
    team: f.team.trim() === "" ? null : f.team.trim(),
    wertung: f.wertung.trim() === "" ? null : f.wertung.trim(),
    testTime: und(parseTime(f.testTime)),
    run1Time: und(parseTime(f.run1Time)),
    run1Penalty: und(parseInt0(f.run1Penalty)),
    run2Time: und(parseTime(f.run2Time)),
    run2Penalty: und(parseInt0(f.run2Penalty)),
    totalPenalty: und(parseInt0(f.totalPenalty, 2000)),
    totalTime: und(parseTime(f.totalTime)),
    points: und(parseInt0(f.points, 100)),
  };
}

function invalidFields(f: Fields): Set<FieldKey> {
  const bad = new Set<FieldKey>();
  if (parseInt0(f.position, 999) === undefined) bad.add("position");
  if (parseInt0(f.startPosition, 999) === undefined) bad.add("startPosition");
  if (parseWertung(f.wertung) === undefined) bad.add("wertung");
  for (const k of ["testTime", "run1Time", "run2Time", "totalTime"] as const) {
    if (parseTime(f[k]) === undefined) bad.add(k);
  }
  for (const k of ["run1Penalty", "run2Penalty"] as const) {
    if (parseInt0(f[k]) === undefined) bad.add(k);
  }
  if (parseInt0(f.totalPenalty, 2000) === undefined) bad.add("totalPenalty");
  if (parseInt0(f.points, 100) === undefined) bad.add("points");
  return bad;
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

export function poolTag(d: PoolDriver): string | null {
  if (d.withdrawn) return "abgemeldet";
  if (!d.qualified) return d.nominated ? "Nachrücker" : "Nachrücker-Kandidat";
  return null;
}

interface PoolCandidate extends MatchCandidate {
  driver: PoolDriver;
}

/* ────────────────────────────── root ────────────────────────────── */

export function EndlaufResultsImport({
  eventId,
  championshipSlug,
  ageClass,
  classLabel,
  pool,
  existing,
  onImported,
}: ResultsImportProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageLarge, setImageLarge] = useState(false);
  const [sheet, setSheet] = useState<EndlaufSheet | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [knownClubs, setKnownClubs] = useState<string[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const [clubBusy, setClubBusy] = useState<string | null>(null);
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
  const existingByDriver = useMemo(
    () => new Map(existing.map((r) => [r.driverId, r])),
    [existing],
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
      form.append("image", blob, "ergebnisliste.jpg");
      form.append("ageClass", String(ageClass));

      try {
        const res = await fetch(`/api/endlauf26/events/${eventId}/results/ocr`, {
          method: "POST",
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setError(errorText(typeof data.error === "string" ? data.error : "ocr_failed", data.detail));
          setPhase("idle");
          return;
        }
        const result = data as unknown as EndlaufOcrResponse;
        setSheet(result.sheet);
        setModel(result.model);
        setKnownClubs(result.knownClubs);
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
              acceptClub: false,
              f: fieldsFromOcr(ocr),
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

  const updateField = useCallback((id: number, key: FieldKey, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, f: { ...r.f, [key]: value }, acceptClub: key === "team" ? false : r.acceptClub } : r)),
    );
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

  const addClub = useCallback(
    async (name: string) => {
      const clean = name.replace(/\s+/g, " ").trim();
      if (clean === "") return;
      setClubBusy(clean);
      try {
        const res = await fetch("/api/endlauf26/teams", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ championship: championshipSlug, name: clean }),
        });
        const data = (await res.json().catch(() => ({}))) as { clubs?: string[]; error?: string };
        if (!res.ok) {
          setError(errorText(data.error ?? "unknown"));
          return;
        }
        if (Array.isArray(data.clubs)) setKnownClubs(data.clubs);
      } finally {
        setClubBusy(null);
      }
    },
    [championshipSlug],
  );

  /* derived validation */
  const checks = useMemo(
    () => checkSheet(rows.map((r) => toCheckable(r.f)), knownClubs),
    [rows, knownClubs],
  );

  const invalidByRow = useMemo(() => new Map(rows.map((r) => [r.id, invalidFields(r.f)])), [rows]);

  const duplicateIds = useMemo(() => {
    const seen = new Map<number, number>();
    for (const r of rows) {
      if (!r.include || r.driverId === null) continue;
      seen.set(r.driverId, (seen.get(r.driverId) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);

  const takenIds = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) if (r.include && r.driverId !== null) s.add(r.driverId);
    return s;
  }, [rows]);

  const items = useMemo<EndlaufResultImportItem[]>(() => {
    const out: EndlaufResultImportItem[] = [];
    rows.forEach((r, idx) => {
      if (!r.include || r.driverId === null) return;
      if ((invalidByRow.get(r.id)?.size ?? 0) > 0) return;
      const c = toCheckable(r.f);
      out.push({
        driverId: r.driverId,
        position: c.position,
        startPosition: c.startPosition,
        wertung: parseWertung(r.f.wertung) ?? null,
        testTime: c.testTime,
        run1Time: c.run1Time,
        run1Penalty: c.run1Penalty ?? 0,
        run2Time: c.run2Time,
        run2Penalty: c.run2Penalty ?? 0,
        totalPenalty: c.totalPenalty,
        totalTime: c.totalTime,
        points: c.points,
        sheetTeam: c.team,
        sheetAdacId: r.f.adacId.trim() === "" ? null : r.f.adacId.trim(),
        warnings: checks.rows[idx]?.warnings ?? [],
      });
    });
    return out;
  }, [rows, invalidByRow, checks]);

  const includedCount = rows.filter((r) => r.include && r.driverId !== null).length;
  const unmatchedRows = rows.filter((r) => r.driverId === null).length;
  const anyInvalid = rows.some((r) => r.include && (invalidByRow.get(r.id)?.size ?? 0) > 0);
  const unacknowledgedClubs = rows.filter(
    (r, idx) => r.include && r.driverId !== null && checks.rows[idx]?.unknownClub && !r.acceptClub,
  ).length;
  const missingPool = pool.filter((d) => !d.withdrawn && (d.qualified || d.nominated) && !takenIds.has(d.driverId));
  const canSave =
    phase === "review" &&
    items.length > 0 &&
    duplicateIds.size === 0 &&
    !anyInvalid &&
    unacknowledgedClubs === 0;

  const classMismatch = useMemo(() => {
    const label = sheet?.ageClassLabel ?? "";
    const m = /(\d)/.exec(label);
    return m ? Number(m[1]) !== ageClass : false;
  }, [sheet, ageClass]);

  const save = async () => {
    if (!canSave) return;
    setPhase("saving");
    setError(null);
    try {
      const form = new FormData();
      form.append("ageClass", String(ageClass));
      form.append("items", JSON.stringify(items));
      if (imageBlob) form.append("image", imageBlob, "ergebnisliste.jpg");
      const res = await fetch(`/api/endlauf26/events/${eventId}/results/import`, {
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
          `${written} Ergebniszeilen übernommen, Foto gespeichert.`,
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
            {classLabel} — offizielle Ergebnisliste einlesen
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
            Foto der ausgehängten offiziellen Ergebnisliste dieser Klasse aufnehmen (eine Klasse pro
            Foto; bei zwei Seiten nacheinander einlesen — vorhandene Zeilen anderer Fahrer bleiben).
            Die Liste ist die Wahrheit: Platz und Werte werden übernommen, wie sie stehen. Alles,
            was rechnerisch nicht aufgeht, wird nur markiert. Fahrer, die nicht grün markiert
            waren, werden als Nachrücker eingetragen.
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
            </div>
            {sheet.notes && (
              <p className="text-xs text-[var(--color-muted)] italic">Hinweis des Modells: {sheet.notes}</p>
            )}
            {checks.sheet.length > 0 && (
              <ul className="space-y-0.5 rounded-md border border-[var(--color-pending)]/40 bg-[var(--color-pending)]/10 px-3 py-2 text-xs text-[var(--color-pending)]">
                {checks.sheet.map((w, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-2 py-2 text-left" title="Zeile übernehmen">
                      <Check className="h-3.5 w-3.5" />
                    </th>
                    <th className="px-2 py-2 text-right">Pl.</th>
                    <th className="px-2 py-2 text-left">Auf dem Foto</th>
                    <th className="px-2 py-2 text-left">Fahrer</th>
                    <th className="px-2 py-2 text-right">Start</th>
                    <th className="px-2 py-2 text-center" title="Wertung D/M">W</th>
                    <th className="px-2 py-2 text-right">Training</th>
                    <th className="px-2 py-2 text-right whitespace-nowrap">
                      Lauf 1 <span className="font-normal normal-case opacity-70">Zeit / Fehler</span>
                    </th>
                    <th className="px-2 py-2 text-right whitespace-nowrap">
                      Lauf 2 <span className="font-normal normal-case opacity-70">Zeit / Fehler</span>
                    </th>
                    <th className="px-2 py-2 text-right whitespace-nowrap">Ges. Fehler</th>
                    <th className="px-2 py-2 text-right">Gesamtzeit</th>
                    <th className="px-2 py-2 text-right">Pkt.</th>
                    <th className="px-2 py-2 text-left">Hinweise</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const cand = r.driverId === null ? null : candidateById.get(r.driverId) ?? null;
                    const isDuplicate = r.driverId !== null && duplicateIds.has(r.driverId);
                    const bad = invalidByRow.get(r.id) ?? new Set<FieldKey>();
                    const check = checks.rows[idx];
                    const prev = r.driverId === null ? null : existingByDriver.get(r.driverId) ?? null;
                    const disabled = phase === "saving";
                    const input = (key: FieldKey, cls: string, extra?: Partial<React.InputHTMLAttributes<HTMLInputElement>>) => (
                      <input
                        type="text"
                        inputMode={key === "team" || key === "adacId" || key === "wertung" ? "text" : "decimal"}
                        value={r.f[key]}
                        disabled={disabled}
                        onChange={(ev) => updateField(r.id, key, ev.target.value)}
                        placeholder="—"
                        className={cn(
                          "rounded-md border bg-[var(--color-background)] px-1.5 py-1 text-sm tabular-nums",
                          bad.has(key) ? "border-red-500" : "border-[var(--color-border)]",
                          cls,
                        )}
                        {...extra}
                      />
                    );
                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b border-[var(--color-border)]/50 align-top last:border-0",
                          !r.include && "opacity-60",
                          r.driverId === null && "bg-[var(--color-pending)]/10",
                          isDuplicate && "bg-red-500/10",
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
                        <td className="px-2 py-2">{input("position", "w-12 text-right font-semibold")}</td>
                        <td className="px-2 py-2">
                          <div className="font-medium">
                            {r.ocr.lastName} {r.ocr.firstName}
                          </div>
                          <div className="mt-1 flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                            <ClubPicker
                              value={r.f.team}
                              clubs={knownClubs}
                              unknown={!!check?.unknownClub}
                              disabled={disabled}
                              onChange={(v) => updateField(r.id, "team", v)}
                            />
                            {input("adacId", "w-28", { placeholder: "Ausweis-Nr." })}
                            {r.ocr.remark && <span>· {r.ocr.remark}</span>}
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
                          {isDuplicate && (
                            <div className="mt-1 text-xs text-red-400">Fahrer ist mehrfach zugeordnet.</div>
                          )}
                          {cand && cand.adacId && r.f.adacId.trim() !== "" && cand.adacId.replace(/\D/g, "") !== r.f.adacId.replace(/\D/g, "") && (
                            <div className="mt-1 text-xs text-[var(--color-pending)]">
                              Ausweis-Nr. abweichend (bekannt: {cand.adacId}).
                            </div>
                          )}
                          {prev && (
                            <div className="mt-1 text-[10px] text-[var(--color-pending)]">
                              bisher Platz {prev.position ?? "—"} → wird überschrieben
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">{input("startPosition", "w-12 text-right")}</td>
                        <td className="px-2 py-2">{input("wertung", "w-10 text-center uppercase", { maxLength: 1 })}</td>
                        <td className="px-2 py-2">{input("testTime", "w-20 text-right")}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {input("run1Time", "w-20 text-right")}
                            {input("run1Penalty", "w-12 text-right", { title: "Strafsekunden Lauf 1" })}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {input("run2Time", "w-20 text-right")}
                            {input("run2Penalty", "w-12 text-right", { title: "Strafsekunden Lauf 2" })}
                          </div>
                        </td>
                        <td className="px-2 py-2">{input("totalPenalty", "w-14 text-right")}</td>
                        <td className="px-2 py-2">{input("totalTime", "w-20 text-right font-semibold")}</td>
                        <td className="px-2 py-2">{input("points", "w-12 text-right")}</td>
                        <td className="px-2 py-2 text-xs">
                          {check && check.warnings.length > 0 && (
                            <ul className="space-y-0.5 text-[var(--color-pending)]">
                              {check.warnings.map((w, i) => (
                                <li key={i} className="flex items-start gap-1">
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                  {w}
                                </li>
                              ))}
                            </ul>
                          )}
                          {check?.unknownClub && r.f.team.trim() !== "" && (
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {(() => {
                                const hint = closestClub(r.f.team, knownClubs);
                                return hint ? (
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => updateField(r.id, "team", hint)}
                                    className="inline-flex items-center gap-1 rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20"
                                    title="Bekannten Verein übernehmen"
                                  >
                                    → {hint}
                                  </button>
                                ) : null;
                              })()}
                              <label className="inline-flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={r.acceptClub}
                                  disabled={disabled}
                                  onChange={(ev) => updateRow(r.id, { acceptClub: ev.target.checked })}
                                />
                                Ortsclub trotzdem übernehmen
                              </label>
                              <button
                                type="button"
                                disabled={disabled || clubBusy !== null}
                                onClick={() => void addClub(r.f.team)}
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--color-surface-2)]"
                                title="Verein in die Liste der bekannten Vereine aufnehmen"
                              >
                                <Plus className="h-3 w-3" />
                                {clubBusy === r.f.team.trim() ? "Lege an…" : "Verein anlegen"}
                              </button>
                            </div>
                          )}
                          {bad.size > 0 && (
                            <div className="mt-1 text-red-400">Ungültiger Wert in rot markiertem Feld.</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-2 py-4 text-center text-sm text-[var(--color-muted)]">
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
                {missingPool.map((d) => `${d.lastName} ${d.firstName}`).join(", ")}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <span className="text-xs text-[var(--color-muted)]">
                Die Reihenfolge der Liste wird nie verändert. Zeilen ohne Fahrer bleiben ausgelassen.
                {unacknowledgedClubs > 0 && (
                  <span className="ml-1 text-[var(--color-pending)]">
                    {unacknowledgedClubs} unbekannte Ortsclubs bestätigen oder anlegen.
                  </span>
                )}
                {duplicateIds.size > 0 && (
                  <span className="ml-1 text-red-400">Doppelte Zuordnungen auflösen.</span>
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
                Ergebnisse übernehmen ({items.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────── club picker ────────────────────────────── */

/**
 * Ortsclub field: free text (what is printed on the list) with a dropdown of
 * the known clubs, ranked by similarity to the typed text — so "MSC Rodenstein"
 * offers "MSC Rodenstein Fr.- Crumbach" first instead of having to type it.
 */
function ClubPicker({
  value,
  clubs,
  unknown,
  disabled,
  onChange,
}: {
  value: string;
  clubs: string[];
  unknown: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const q = value.trim();
    if (q === "") return [...clubs].sort((a, b) => a.localeCompare(b, "de")).slice(0, 10);
    return rankClubs(q, clubs)
      .filter(({ name, score }) => score >= 0.4 || name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 10)
      .map(({ name }) => name);
  }, [value, clubs]);

  useEffect(() => setActive(0), [value]);

  const pick = (c: string) => {
    onChange(c);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-48">
      <div
        className={cn(
          "flex items-center gap-1 rounded-md border bg-[var(--color-background)] px-1.5 py-1",
          unknown && value.trim() !== "" ? "border-[var(--color-pending)]/60" : "border-[var(--color-border)]",
          disabled && "opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder="Ortsclub"
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(ev) => {
            onChange(ev.target.value);
            setOpen(true);
          }}
          onKeyDown={(ev) => {
            if (!open) return;
            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (ev.key === "ArrowUp") {
              ev.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (ev.key === "Enter") {
              if (options[active] !== undefined) {
                ev.preventDefault();
                pick(options[active]);
              }
            } else if (ev.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent text-sm text-[var(--color-foreground)] outline-none"
        />
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 cursor-pointer text-[var(--color-muted)]"
          onMouseDown={(ev) => {
            ev.preventDefault();
            if (open) setOpen(false);
            else inputRef.current?.focus();
          }}
        />
      </div>
      {open && options.length > 0 && (
        <ul
          onMouseDown={(ev) => ev.preventDefault()}
          className="absolute z-20 mt-1 max-h-56 w-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
        >
          {options.map((c, i) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => pick(c)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "w-full px-3 py-1.5 text-left text-sm text-[var(--color-foreground)]",
                  i === active && "bg-[var(--color-surface-2)]",
                  c === value && "font-semibold",
                )}
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
