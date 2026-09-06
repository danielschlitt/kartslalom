"use client";

/**
 * Admin page of one Endlauf.
 *
 * Top: OFFICIAL RESULTS per age class — photograph the printed result list,
 * review, import; stored photos; delete/replace. This is the only source of
 * the championship standings. No live state needed.
 *
 * Bottom (collapsed): LIVE TIMING — a tool to follow selected drivers while
 * the event runs. Its times never reach the championship.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronRight,
  Eye,
  ImageIcon,
  Mic,
  RefreshCw,
  Square,
  Trash2,
  Users,
  Zap,
} from "lucide-react";

import { parseDictation } from "@/lib/endlauf26/dictation";
import { formatFactor, formatSeconds } from "@/lib/endlauf26/format";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import type { EndlaufEntryRuns, EndlaufRunValue } from "@/lib/endlauf26/ranking";
import { liveTotal } from "@/lib/endlauf26/ranking";
import type {
  EndlaufResultImageMeta,
  EndlaufResultRow,
  PoolDriver,
} from "@/lib/endlauf26/results-types";
import { cn, formatDateDe } from "@/lib/utils";
import { EndlaufResultsImport } from "@/components/endlauf26/results-import.client";

/* ────────────────────────────── types ────────────────────────────── */

export interface AdminEntry {
  entryId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  startingOrder: number | null;
  runs: EndlaufEntryRuns;
  positionLive: number | null;
}

export interface AdminGroup {
  ageClass: number;
  name: string;
  /** Live-timing entries (the field). */
  entries: AdminEntry[];
  /** Imported official results, sorted by position. */
  results: EndlaufResultRow[];
  /** Stored photos of the result list. */
  images: EndlaufResultImageMeta[];
  /** Every driver of the class (field + Nachrücker pool) for the OCR review. */
  pool: PoolDriver[];
}

interface AdminEvent {
  id: number;
  slug: string;
  number: number;
  name: string;
  factor: number;
  status: "upcoming" | "live" | "completed";
  liveAgeClass: number | null;
  liveEntryId: number | null;
}

type RunType = "test" | "first" | "second";
const RUN_LABEL: Record<RunType, string> = {
  test: "Training",
  first: "Lauf 1",
  second: "Lauf 2",
};

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Nicht als Admin freigeschaltet — Seite neu laden und Admin-Token eingeben.",
  event_not_live: "Der Endlauf ist nicht live.",
  age_class_not_active: "Diese Klasse ist nicht aktiv.",
  driver_not_active: "Fahrer ist nicht aktiviert.",
  no_live_age_class: "Zuerst eine Klasse aktivieren.",
  entry_not_in_live_class: "Fahrer gehört nicht zur aktiven Klasse.",
  confirmation_mismatch: "Bestätigung stimmt nicht.",
  missing_api_key: "OPENAI_API_KEY fehlt — Diktat nicht verfügbar.",
  no_speech: "Keine Sprache erkannt — bitte näher ans Mikrofon und erneut diktieren.",
  upstream_error: "Transkription fehlgeschlagen (OpenAI).",
  upstream_unreachable: "OpenAI nicht erreichbar.",
};

async function apiCall(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.error === "string" ? data.error : "unknown";
    return { ok: false, error: ERROR_TEXT[code] ?? `Fehler (${code}).` };
  }
  return { ok: true, data };
}

function nextEmptyRun(runs: EndlaufEntryRuns): RunType {
  if (!runs.test || runs.test.timeSeconds === null) return "test";
  if (!runs.first || runs.first.timeSeconds === null) return "first";
  return "second";
}

function countRuns(entries: AdminEntry[]): number {
  return entries.reduce(
    (n, e) => n + [e.runs.test, e.runs.first, e.runs.second].filter((r) => r?.timeSeconds != null).length,
    0,
  );
}

/* ────────────────────────────── root ────────────────────────────── */

export function AdminEndlaufClient({
  basePath,
  championshipSlug,
  event,
  groups,
}: {
  basePath: string;
  championshipSlug: string;
  event: AdminEvent;
  groups: AdminGroup[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const [flash, setFlash] = useState<string | null>(null);
  const showError = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 5000);
  }, []);

  const scoredCount = groups.filter((g) => g.results.length > 0).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-wider text-[var(--color-accent)] uppercase">
            Endläufe 2026 · Admin
          </div>
          <h1 className="text-2xl font-semibold">
            Endlauf {event.number}: {event.name}
            {event.factor !== 1 && (
              <span className="ml-2 text-base font-normal text-[var(--color-accent)]">
                {formatFactor(event.factor)}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {scoredCount} von {groups.length} Klassen mit offizieller Ergebnisliste.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.status === "live" && (
            <Link
              href={`${basePath}/live`}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-live)]/40 bg-[var(--color-live)]/10 px-3 py-1.5 text-sm text-[var(--color-live)] hover:bg-[var(--color-live)]/15"
            >
              <Zap className="h-4 w-4 animate-pulse" />
              Live-Ansicht
            </Link>
          )}
          <Link
            href={`${basePath}/events/${event.slug}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            <Eye className="h-4 w-4" />
            Ergebnisse
          </Link>
          <Link
            href={`${basePath}/admin`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            Alle Endläufe
          </Link>
          <Link
            href={`${basePath}/admin#fahrerfeld`}
            title="Abmeldungen und Nachrücker (gelten für alle Endläufe)"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            <Users className="h-4 w-4" />
            Fahrerfeld
          </Link>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} />
            Neu laden
          </button>
        </div>
      </header>

      {flash && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {flash}
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            Offizielle Ergebnislisten
          </h2>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Pro Klasse die ausgehängte Ergebnisliste fotografieren und einlesen. Die Liste ist die
            einzige Grundlage der Endlaufwertung — Platz und Werte werden übernommen, wie gedruckt;
            Unstimmigkeiten werden nur markiert. Eine Liste kann jederzeit gelöscht und neu
            eingelesen werden; die Wertung folgt sofort.
          </p>
        </div>
        {groups.map((g) => (
          <ResultsClassCard
            key={g.ageClass}
            event={event}
            championshipSlug={championshipSlug}
            group={g}
            onChange={refresh}
            onError={showError}
          />
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">
            Für diese Meisterschaft sind keine Fahrer eingetragen. <code>make seed-endlauf26</code>{" "}
            ausführen.
          </p>
        )}
      </section>

      <LiveToolSection event={event} groups={groups} onChange={refresh} onError={showError} />

      <ResetEventCard event={event} onChange={refresh} onError={showError} />
    </div>
  );
}

/* ─────────────────────────── official results ─────────────────────────── */

function ResultsClassCard({
  event,
  championshipSlug,
  group,
  onChange,
  onError,
}: {
  event: AdminEvent;
  championshipSlug: string;
  group: AdminGroup;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const hasResults = group.results.length > 0;
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const warningCount = group.results.reduce((n, r) => n + r.warnings.length, 0);
  const nachruecker = group.results.filter((r) => !r.qualified).length;

  const deleteAll = async () => {
    if (
      !confirm(
        `Ergebnisliste der ${group.name} löschen?\n\n${group.results.length} Zeilen und ${group.images.length} Foto(s) werden entfernt. Die Klasse zählt dann nicht mehr in der Wertung, bis eine neue Liste eingelesen wird.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/events/${event.id}/results`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageClass: group.ageClass }),
      });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const deleteImage = async (img: EndlaufResultImageMeta) => {
    if (!confirm("Dieses Foto löschen? Die daraus gelesenen Ergebniszeilen bleiben erhalten.")) return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/result-images/${img.id}`, { method: "DELETE" });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-[var(--color-surface)]",
        hasResults ? "border-[var(--color-rank-green)]/40" : "border-[var(--color-border)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-wrap items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn("h-4 w-4 text-[var(--color-muted)] transition-transform", open && "rotate-90")}
          />
          <span className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            {group.name}
          </span>
          {hasResults ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-rank-green)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--color-rank-green)]">
              <Check className="h-3 w-3" /> {group.results.length} Fahrer gewertet
            </span>
          ) : (
            <span className="rounded-md border border-dashed border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-muted)]">
              keine Liste
            </span>
          )}
          {nachruecker > 0 && (
            <span className="rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase">
              {nachruecker} Nachrücker
            </span>
          )}
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-pending)]">
              <AlertTriangle className="h-3 w-3" /> {warningCount} Hinweise
            </span>
          )}
          {group.images.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
              <ImageIcon className="h-3 w-3" /> {group.images.length} Foto
              {group.images.length === 1 ? "" : "s"}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {hasResults && (
            <button
              type="button"
              onClick={deleteAll}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10",
                busy && "opacity-50",
              )}
            >
              <Trash2 className="h-3.5 w-3.5" /> Liste löschen
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setImporting((v) => !v);
              setOpen(true);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
              importing
                ? "border border-[var(--color-border)] text-[var(--color-muted)]"
                : "bg-[var(--color-accent)] text-white hover:opacity-90",
            )}
          >
            <Camera className="h-3.5 w-3.5" />
            {importing ? "Einlesen schließen" : hasResults ? "Liste erneut einlesen" : "Liste einlesen"}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-[var(--color-border)] p-3">
          {importing && (
            <EndlaufResultsImport
              eventId={event.id}
              championshipSlug={championshipSlug}
              ageClass={group.ageClass}
              classLabel={group.name}
              pool={group.pool}
              existing={group.results}
              onImported={() => {
                setImporting(false);
                onChange();
              }}
            />
          )}

          {group.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {group.images.map((img) => (
                <div
                  key={img.id}
                  className="relative overflow-hidden rounded-md border border-[var(--color-border)]"
                >
                  <a
                    href={`/api/endlauf26/result-images/${img.id}`}
                    target="_blank"
                    rel="noopener"
                    title={`Foto öffnen · ${formatDateDe(img.uploadedAt)} · ${img.rowCount} Zeilen`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/endlauf26/result-images/${img.id}`}
                      alt={`Ergebnisliste ${group.name}`}
                      className="h-28 w-auto object-cover"
                    />
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteImage(img)}
                    disabled={busy}
                    title="Foto löschen"
                    className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white hover:bg-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {hasResults ? (
            <ResultsTable rows={group.results} />
          ) : (
            !importing && (
              <p className="text-xs text-[var(--color-muted)]">
                Noch keine Ergebnisliste für diese Klasse. „Liste einlesen“ startet die Foto-Erkennung.
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ResultsTable({ rows }: { rows: EndlaufResultRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-2 py-2 text-right">Pl.</th>
            <th className="px-2 py-2 text-right">Start</th>
            <th className="px-3 py-2 text-left">Fahrer</th>
            <th className="px-3 py-2 text-left">Verein</th>
            <th className="px-2 py-2 text-center">W</th>
            <th className="px-2 py-2 text-right">Training</th>
            <th className="px-2 py-2 text-right">Lauf 1</th>
            <th className="px-2 py-2 text-right">Lauf 2</th>
            <th className="px-2 py-2 text-right">Fehler</th>
            <th className="px-2 py-2 text-right">Gesamt</th>
            <th className="px-2 py-2 text-right">Pkt.</th>
            <th className="px-2 py-2 text-left">Hinweise</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[var(--color-border)]/50 align-top last:border-0"
              style={r.teamName === HOME_TEAM ? { backgroundColor: HOME_TEAM_BG } : undefined}
            >
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.position ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-muted)]">
                {r.startPosition ?? "—"}
              </td>
              <td className="px-3 py-1.5 font-medium">
                {r.lastName} {r.firstName}
                {!r.qualified && (
                  <span className="ml-2 rounded-sm bg-[var(--color-accent)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase">
                    Nachrücker
                  </span>
                )}
                {r.sheetAdacId && (
                  <span className="ml-2 text-xs text-[var(--color-muted)]">#{r.sheetAdacId}</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-[var(--color-muted)]">
                {r.sheetTeam ?? r.teamName}
              </td>
              <td className="px-2 py-1.5 text-center">{r.wertung ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-muted)]">
                {formatSeconds(r.testTime)}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                {formatSeconds(r.run1Time)}
                {r.run1Penalty > 0 && (
                  <span className="ml-1 text-xs text-[var(--color-pending)]">+{r.run1Penalty}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                {formatSeconds(r.run2Time)}
                {r.run2Penalty > 0 && (
                  <span className="ml-1 text-xs text-[var(--color-pending)]">+{r.run2Penalty}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.totalPenalty ?? "—"}</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                {formatSeconds(r.totalTime)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.points ?? "—"}</td>
              <td className="px-2 py-1.5 text-xs text-[var(--color-pending)]">
                {r.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {w}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────── reset ─────────────────────────── */

function ResetEventCard({
  event,
  onChange,
  onError,
}: {
  event: AdminEvent;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (confirmText !== event.slug) return;
    if (!confirm(`Endlauf ${event.number} „${event.name}“ wirklich komplett zurücksetzen?`)) return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/events/${event.id}/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      if (!r.ok) onError(r.error);
      setOpen(false);
      setConfirmText("");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-red-500/30 bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <ChevronRight
          className={cn("h-4 w-4 text-[var(--color-muted)] transition-transform", open && "rotate-90")}
        />
        <span className="text-sm font-semibold tracking-wider text-red-400 uppercase">
          Endlauf zurücksetzen
        </span>
        <span className="text-xs text-[var(--color-muted)]">
          Alle Ergebnislisten, Fotos und Live-Zeiten dieses Endlaufs löschen
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-red-500/20 p-4 text-sm">
          <p className="text-[var(--color-muted)]">
            Löscht alle offiziellen Ergebnisse und Fotos, alle Live-Zeiten und den Live-Status dieses
            Endlaufs. Fahrerfeld (Nachrücker, Abmeldungen) und Startreihenfolgen bleiben erhalten.
            Zum Bestätigen <code className="rounded bg-[var(--color-surface-2)] px-1">{event.slug}</code>{" "}
            eingeben.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={(ev) => setConfirmText(ev.target.value)}
              placeholder={event.slug}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={reset}
              disabled={busy || confirmText !== event.slug}
              className={cn(
                "inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white",
                (busy || confirmText !== event.slug) && "cursor-not-allowed opacity-50",
              )}
            >
              <Trash2 className="h-4 w-4" /> Endlauf zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── live tool ─────────────────────────── */

function LiveToolSection({
  event,
  groups,
  onChange,
  onError,
}: {
  event: AdminEvent;
  groups: AdminGroup[];
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(event.status === "live");
  const activeGroup = groups.find((g) => g.ageClass === event.liveAgeClass) ?? null;
  const otherGroups = groups.filter((g) => g.ageClass !== event.liveAgeClass);
  const totalRuns = groups.reduce((n, g) => n + countRuns(g.entries), 0);

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left"
      >
        <ChevronRight
          className={cn("h-4 w-4 text-[var(--color-muted)] transition-transform", open && "rotate-90")}
        />
        <Zap className="h-4 w-4 text-[var(--color-live)]" />
        <span className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          Live-Timing (Werkzeug)
        </span>
        <span className="text-xs text-[var(--color-muted)]">
          Zeiten mitschreiben, um während des Endlaufs ein Gefühl zu bekommen — fließt nie in die
          Wertung ein.
          {totalRuns > 0 && ` · ${totalRuns} Läufe erfasst`}
        </span>
        {event.status === "live" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-live)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-live)]">
            <Zap className="h-3 w-3 animate-pulse" /> LIVE
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-[var(--color-border)] p-4">
          <StatusControl event={event} onChange={onChange} onError={onError} />

          {event.status === "live" ? (
            <LiveClassControl event={event} groups={groups} onChange={onChange} onError={onError} />
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              Zum Mitschreiben den Endlauf auf <strong>Live</strong> setzen, dann eine Klasse und den
              aktuellen Fahrer aktivieren. Die offizielle Ergebnisliste wird davon unabhängig oben
              eingelesen.
            </p>
          )}

          {activeGroup && (
            <ActiveClassEditor event={event} group={activeGroup} onChange={onChange} onError={onError} />
          )}

          <div className="space-y-3">
            {otherGroups.map((g) => (
              <CollapsedLiveClass
                key={g.ageClass}
                event={event}
                group={g}
                onChange={onChange}
                onError={onError}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** "Alle Zeiten löschen" for one class. */
function ClearClassButton({
  event,
  group,
  onChange,
  onError,
}: {
  event: AdminEvent;
  group: AdminGroup;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const runCount = countRuns(group.entries);
  if (runCount === 0) return null;

  const clearAll = async () => {
    if (
      !confirm(
        `Wirklich ALLE Live-Zeiten der ${group.name} löschen?\n\n${runCount} Läufe von ${group.entries.length} Fahrern werden entfernt (Training, Lauf 1, Lauf 2). Die offizielle Ergebnisliste ist davon nicht betroffen.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/events/${event.id}/runs`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageClass: group.ageClass }),
      });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={clearAll}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10",
        busy && "opacity-50",
      )}
    >
      <Trash2 className="h-3.5 w-3.5" /> Alle Zeiten löschen ({runCount})
    </button>
  );
}

/** Trash icon that clears all runs of one driver. */
function ClearDriverButton({
  entry,
  onChange,
  onError,
}: {
  entry: AdminEntry;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (countRuns([entry]) === 0) return null;

  const clear = async (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!confirm(`Alle Live-Zeiten von ${entry.lastName} ${entry.firstName} löschen (Training, Lauf 1, Lauf 2)?`))
      return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/entries/${entry.entryId}/runs`, { method: "DELETE" });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={clear}
      disabled={busy}
      title="Alle Zeiten dieses Fahrers löschen"
      className={cn(
        "rounded-md p-1 text-[var(--color-muted)] hover:bg-red-500/10 hover:text-red-400",
        busy && "opacity-50",
      )}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

/* ───────────────────────────── status ───────────────────────────── */

function StatusControl({
  event,
  onChange,
  onError,
}: {
  event: AdminEvent;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const setStatus = async (next: AdminEvent["status"]) => {
    if (next === event.status) return;
    if (
      next !== "live" &&
      event.status === "live" &&
      !confirm("Live-Modus beenden? Aktive Klasse und Fahrer werden zurückgesetzt.")
    )
      return;
    setBusy(next);
    try {
      const r = await apiCall(`/api/endlauf26/events/${event.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
      <span className="text-sm text-[var(--color-muted)]">Status:</span>
      {(["upcoming", "live", "completed"] as const).map((s) => (
        <button
          key={s}
          onClick={() => setStatus(s)}
          disabled={busy !== null}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            event.status === s
              ? s === "live"
                ? "bg-[var(--color-live)] text-white"
                : s === "completed"
                  ? "bg-[var(--color-rank-grey)] text-white"
                  : "bg-[var(--color-pending)] text-black"
              : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            busy === s && "opacity-50",
          )}
        >
          {s === "upcoming" ? "Geplant" : s === "live" ? "Live" : "Beendet"}
        </button>
      ))}
      <span className="text-xs text-[var(--color-muted)]">
        Steuert nur die Live-Ansicht — die Wertung hängt allein von den eingelesenen Listen ab.
      </span>
    </div>
  );
}

/* ─────────────────────────── class control ─────────────────────────── */

function LiveClassControl({
  event,
  groups,
  onChange,
  onError,
}: {
  event: AdminEvent;
  groups: AdminGroup[];
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const setClass = async (ageClass: number | null) => {
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/events/${event.id}/live-age-class`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageClass }),
      });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-[var(--color-live)]/40 bg-[var(--color-live)]/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-live)]">
        <Zap className="h-4 w-4" />
        Aktive Klasse
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.ageClass}
            onClick={() => setClass(g.ageClass)}
            disabled={busy}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              event.liveAgeClass === g.ageClass
                ? "bg-[var(--color-live)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
              busy && "opacity-50",
            )}
          >
            {g.name}
          </button>
        ))}
        <button
          onClick={() => setClass(null)}
          disabled={busy}
          className={cn(
            "rounded-md border border-dashed border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            event.liveAgeClass === null && "border-[var(--color-live)]/40 bg-[var(--color-live)]/10",
          )}
        >
          Keine
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Nur eine Klasse ist gleichzeitig aktiv. Reihenfolge je Klasse: Training Fahrer 1, Training
        Fahrer 2, Lauf 1 Fahrer 1, Lauf 1 Fahrer 2, nächstes Paar … danach Lauf 2 für alle.
      </p>
    </div>
  );
}

/* ─────────────────────────── active editor ─────────────────────────── */

function ActiveClassEditor({
  event,
  group,
  onChange,
  onError,
}: {
  event: AdminEvent;
  group: AdminGroup;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const sorted = useMemo(
    () =>
      [...group.entries].sort((a, b) => {
        const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.lastName.localeCompare(b.lastName, "de");
      }),
    [group.entries],
  );
  const active = sorted.find((e) => e.entryId === event.liveEntryId) ?? null;
  const [busyEntry, setBusyEntry] = useState<number | null>(null);

  const activate = useCallback(
    async (entryId: number | null) => {
      setBusyEntry(entryId ?? -1);
      try {
        const r = await apiCall(`/api/endlauf26/events/${event.id}/live-entry`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId }),
        });
        if (!r.ok) onError(r.error);
        onChange();
      } finally {
        setBusyEntry(null);
      }
    },
    [event.id, onChange, onError],
  );

  const activateNext = useCallback(() => {
    if (sorted.length === 0) return;
    const idx = active ? sorted.findIndex((e) => e.entryId === active.entryId) : -1;
    const next = sorted[(idx + 1) % sorted.length];
    void activate(next.entryId);
  }, [active, sorted, activate]);

  const saveRun = useCallback(
    async (entryId: number, runType: RunType, timeSeconds: number | null, penaltySeconds: number) => {
      const r = await apiCall(`/api/endlauf26/entries/${entryId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runType, timeSeconds, penaltySeconds }),
      });
      if (!r.ok) {
        onError(r.error);
        return false;
      }
      onChange();
      return true;
    },
    [onChange, onError],
  );

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-[var(--color-live)]/50 bg-[var(--color-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
              {group.name} — Live-Zeiten
            </h3>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-live)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-live)]">
              <Zap className="h-3 w-3 animate-pulse" />
              AKTIV
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-muted)]">
              Zeile anklicken = Fahrer aktivieren
            </span>
            <ClearClassButton event={event} group={group} onChange={onChange} onError={onError} />
          </div>
        </div>

        <DriverPanel
          active={active}
          onNext={activateNext}
          onClear={() => activate(null)}
          onSave={saveRun}
          onError={onError}
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-2 py-2 text-left">Start</th>
                <th className="px-3 py-2 text-left">Fahrer</th>
                <th className="px-2 py-2 text-right">Training</th>
                <th className="px-2 py-2 text-right">Lauf 1</th>
                <th className="px-2 py-2 text-right">Lauf 2</th>
                <th className="px-2 py-2 text-right" title="Lauf 1 + Lauf 2 inkl. Strafsekunden">Gesamt</th>
                <th className="px-2 py-2 text-right" title="Live-Position">Pos</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const isActive = e.entryId === event.liveEntryId;
                const isHome = e.teamName === HOME_TEAM && !isActive;
                return (
                  <tr
                    key={e.entryId}
                    onClick={() => !isActive && activate(e.entryId)}
                    className={cn(
                      "cursor-pointer border-b border-[var(--color-border)]/50 last:border-0",
                      isActive
                        ? "bg-[var(--color-live)]/15"
                        : "hover:bg-[var(--color-surface-2)]",
                      busyEntry === e.entryId && "opacity-50",
                    )}
                    style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                  >
                    <td className="px-2 py-1.5" onClick={(ev) => ev.stopPropagation()}>
                      <StartingOrderInput entry={e} onSaved={onChange} />
                    </td>
                    <td className="px-3 py-1.5 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {isActive && <Zap className="h-3.5 w-3.5 animate-pulse text-[var(--color-live)]" />}
                        {e.firstName} {e.lastName.charAt(0)}.
                      </span>
                    </td>
                    <EditableRunCell
                      entry={e}
                      runType="test"
                      editable={isActive}
                      onActivate={() => activate(e.entryId)}
                      onSave={saveRun}
                      muted
                    />
                    <EditableRunCell
                      entry={e}
                      runType="first"
                      editable={isActive}
                      onActivate={() => activate(e.entryId)}
                      onSave={saveRun}
                    />
                    <EditableRunCell
                      entry={e}
                      runType="second"
                      editable={isActive}
                      onActivate={() => activate(e.entryId)}
                      onSave={saveRun}
                    />
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                      {formatSeconds(liveTotal(e.runs))}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span
                        className={cn(
                          "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums",
                          e.positionLive === 1 && "bg-[var(--color-rank-green)] text-white",
                          e.positionLive === null && "text-[var(--color-muted)]",
                        )}
                      >
                        {e.positionLive ?? "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right" onClick={(ev) => ev.stopPropagation()}>
                      <ClearDriverButton entry={e} onChange={onChange} onError={onError} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── driver panel ─────────────────────────── */

function DriverPanel({
  active,
  onNext,
  onClear,
  onSave,
  onError,
}: {
  active: AdminEntry | null;
  onNext: () => void;
  onClear: () => void;
  onSave: (entryId: number, runType: RunType, t: number | null, p: number) => Promise<boolean>;
  onError: (m: string) => void;
}) {
  const [target, setTarget] = useState<RunType | "auto">("auto");
  const [quick, setQuick] = useState("");
  const [autoSave, setAutoSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastText, setLastText] = useState<string | null>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    timeSeconds: number | null;
    penaltySeconds: number | null;
  } | null>(null);

  const effectiveTarget: RunType | null = active
    ? target === "auto"
      ? nextEmptyRun(active.runs)
      : target
    : null;

  // Reset the panel when the active driver changes.
  useEffect(() => {
    setProposal(null);
    setLastText(null);
    setLastNote(null);
    setQuick("");
    setTarget("auto");
  }, [active?.entryId]);

  const apply = useCallback(
    async (timeSeconds: number | null, penaltySeconds: number | null) => {
      if (!active || !effectiveTarget) return;
      if (timeSeconds === null) {
        onError("Keine Zeit erkannt.");
        return;
      }
      const current = active.runs[effectiveTarget];
      const penalty = penaltySeconds ?? current?.penaltySeconds ?? 0;
      setBusy(true);
      try {
        const ok = await onSave(active.entryId, effectiveTarget, timeSeconds, penalty);
        if (ok) {
          setProposal(null);
          setQuick("");
        }
      } finally {
        setBusy(false);
      }
    },
    [active, effectiveTarget, onSave, onError],
  );

  const submitQuick = async () => {
    const parsed = parseDictation(quick);
    if (parsed.timeSeconds === null) {
      onError(`Keine Zeit erkannt in „${quick}“.`);
      return;
    }
    await apply(parsed.timeSeconds, parsed.penaltySeconds);
  };

  const onTranscribed = useCallback(
    (res: { text: string; note: string; timeSeconds: number | null; penaltySeconds: number | null }) => {
      setLastText(res.text);
      setLastNote(res.note || null);
      if (res.timeSeconds === null) {
        setProposal(null);
        onError(`Keine Zeit erkannt: „${res.text}“`);
        return;
      }
      if (autoSave) {
        void apply(res.timeSeconds, res.penaltySeconds);
      } else {
        setProposal({ timeSeconds: res.timeSeconds, penaltySeconds: res.penaltySeconds });
      }
    },
    [autoSave, apply, onError],
  );

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-4 py-3">
      {!active ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-[var(--color-muted)]">
            Kein Fahrer aktiv — Zeile anklicken oder:
          </span>
          <button
            onClick={onNext}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface)]"
          >
            Ersten Fahrer aktivieren <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 animate-pulse text-[var(--color-live)]" />
              <span className="text-lg font-semibold">
                {active.lastName} {active.firstName}
              </span>
              <span className="text-sm text-[var(--color-muted)]">
                {active.teamName} · Start {active.startingOrder ?? "—"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClear}
                className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                Deaktivieren
              </button>
              <button
                onClick={onNext}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm hover:bg-[var(--color-background)]"
              >
                Nächster Fahrer <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--color-muted)]">Ziel:</span>
            {(["auto", "test", "first", "second"] as const).map((t) => {
              const label = t === "auto" ? `Auto (${RUN_LABEL[nextEmptyRun(active.runs)]})` : RUN_LABEL[t];
              return (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs",
                    target === t
                      ? "bg-[var(--color-accent)] text-white"
                      : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-stretch gap-2">
            <DictationButton
              disabled={busy}
              onResult={onTranscribed}
              onError={onError}
            />
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                void submitQuick();
              }}
              className="flex min-w-[16rem] flex-1 items-center gap-2"
            >
              <input
                type="text"
                inputMode="decimal"
                value={quick}
                onChange={(ev) => setQuick(ev.target.value)}
                disabled={busy}
                placeholder={`${effectiveTarget ? RUN_LABEL[effectiveTarget] : ""}: z. B. „42,35 2“ (Zeit, Strafsek.)`}
                className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-base tabular-nums"
              />
              <button
                type="submit"
                disabled={busy || quick.trim() === ""}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white",
                  (busy || quick.trim() === "") && "opacity-50",
                )}
              >
                <Check className="h-4 w-4" /> Speichern
              </button>
            </form>
            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(ev) => setAutoSave(ev.target.checked)}
              />
              Diktat automatisch speichern
            </label>
          </div>

          {(lastText || proposal) && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm">
              {lastText && (
                <span className="text-[var(--color-muted)]">
                  Gehört: <em>„{lastText}“</em>
                  {lastNote && <span className="ml-2 text-xs opacity-80">· {lastNote}</span>}
                </span>
              )}
              {proposal && (
                <>
                  <span className="font-semibold tabular-nums">
                    {formatSeconds(proposal.timeSeconds)}
                    {proposal.penaltySeconds !== null && (
                      <span className="ml-1 text-[var(--color-pending)]">+{proposal.penaltySeconds}</span>
                    )}
                  </span>
                  <button
                    onClick={() => apply(proposal.timeSeconds, proposal.penaltySeconds)}
                    disabled={busy}
                    className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white"
                  >
                    Übernehmen → {effectiveTarget ? RUN_LABEL[effectiveTarget] : ""}
                  </button>
                  <button
                    onClick={() => setProposal(null)}
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)]"
                  >
                    Verwerfen
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── dictation ─────────────────────────── */

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

function DictationButton({
  disabled,
  onResult,
  onError,
}: {
  disabled: boolean;
  onResult: (r: {
    text: string;
    note: string;
    timeSeconds: number | null;
    penaltySeconds: number | null;
  }) => void;
  onError: (m: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setState("uploading");
        try {
          const form = new FormData();
          form.append("audio", blob, blob.type.includes("mp4") ? "audio.mp4" : "audio.webm");
          const res = await fetch("/api/endlauf26/transcribe", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (!res.ok) {
            const code = typeof data.error === "string" ? data.error : "unknown";
            onError(ERROR_TEXT[code] ?? `Transkription fehlgeschlagen (${code}).`);
            return;
          }
          onResult({
            text: String(data.text ?? ""),
            note: typeof data.note === "string" ? data.note : "",
            timeSeconds: typeof data.timeSeconds === "number" ? data.timeSeconds : null,
            penaltySeconds: typeof data.penaltySeconds === "number" ? data.penaltySeconds : null,
          });
        } finally {
          setState("idle");
        }
      };
      rec.start();
      recorderRef.current = rec;
      setState("recording");
    } catch (err) {
      onError(`Mikrofon nicht verfügbar: ${String(err)}`);
      setState("idle");
    }
  }, [onError, onResult]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (!supported) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
        <Mic className="h-4 w-4" /> Diktat im Browser nicht verfügbar
      </span>
    );
  }

  const recording = state === "recording";
  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      disabled={disabled || state === "uploading"}
      className={cn(
        "inline-flex min-w-[9rem] items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold",
        recording
          ? "bg-[var(--color-live)] text-white"
          : "border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20",
        (disabled || state === "uploading") && "opacity-60",
      )}
      title="Zeit diktieren, z. B. „zweiundvierzig Komma drei fünf, zwei Strafsekunden“"
    >
      {state === "uploading" ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" /> Erkenne…
        </>
      ) : recording ? (
        <>
          <Square className="h-4 w-4 fill-current" /> Stopp
        </>
      ) : (
        <>
          <Mic className="h-4 w-4" /> Diktieren
        </>
      )}
    </button>
  );
}

/* ─────────────────────────── cells ─────────────────────────── */

function EditableRunCell({
  entry,
  runType,
  editable,
  onActivate,
  onSave,
  muted,
}: {
  entry: AdminEntry;
  runType: RunType;
  editable: boolean;
  onActivate: () => void;
  onSave: (entryId: number, runType: RunType, t: number | null, p: number) => Promise<boolean>;
  muted?: boolean;
}) {
  const run: EndlaufRunValue | null = entry.runs[runType];
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState("");
  const [penalty, setPenalty] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);

  const open = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!editable) {
      onActivate();
      return;
    }
    setTime(run?.timeSeconds != null ? String(run.timeSeconds).replace(".", ",") : "");
    setPenalty(String(run?.penaltySeconds ?? 0));
    setEditing(true);
  };

  const save = async () => {
    const t = time.trim() === "" ? null : Number(time.replace(",", "."));
    if (t !== null && !Number.isFinite(t)) return;
    const p = penalty.trim() === "" ? 0 : Number(penalty);
    setBusy(true);
    try {
      const ok = await onSave(entry.entryId, runType, t, Number.isFinite(p) ? p : 0);
      if (ok) setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <td className="px-2 py-1" onClick={(ev) => ev.stopPropagation()}>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            void save();
          }}
          className="flex items-center justify-end gap-1"
        >
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            value={time}
            onChange={(ev) => setTime(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Escape" && setEditing(false)}
            disabled={busy}
            placeholder="Zeit"
            className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums"
          />
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={penalty}
            onChange={(ev) => setPenalty(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Escape" && setEditing(false)}
            disabled={busy}
            title="Strafsekunden"
            className="w-12 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-1 py-1 text-right text-sm tabular-nums"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[var(--color-accent)] p-1 text-white"
            title="Speichern"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </form>
      </td>
    );
  }

  return (
    <td
      onClick={open}
      className={cn(
        "cursor-text px-2 py-1.5 text-right whitespace-nowrap tabular-nums",
        editable && "rounded-sm ring-1 ring-inset ring-[var(--color-live)]/40 hover:bg-[var(--color-background)]",
        muted && "text-[var(--color-muted)]",
      )}
      title={editable ? "Klicken zum Bearbeiten" : "Klicken aktiviert den Fahrer"}
    >
      {run && run.timeSeconds !== null ? (
        <>
          {formatSeconds(run.timeSeconds)}
          {run.penaltySeconds > 0 && (
            <span className="ml-1 text-xs text-[var(--color-pending)]">+{run.penaltySeconds}</span>
          )}
        </>
      ) : (
        <span className="text-[var(--color-muted)]">—</span>
      )}
    </td>
  );
}

function StartingOrderInput({ entry, onSaved }: { entry: AdminEntry; onSaved: () => void }) {
  const initial = entry.startingOrder === null ? "" : String(entry.startingOrder);
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(initial), [initial]);

  const save = async () => {
    if (value === initial) return;
    setBusy(true);
    try {
      await fetch(`/api/endlauf26/entries/${entry.entryId}/start`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startingOrder: value === "" ? null : Number(value) }),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      disabled={busy}
      className={cn(
        "w-12 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1 text-right text-sm",
        busy && "opacity-50",
      )}
      placeholder="—"
    />
  );
}

/* ─────────────────────────── collapsed live class ─────────────────────────── */

function CollapsedLiveClass({
  event,
  group,
  onChange,
  onError,
}: {
  event: AdminEvent;
  group: AdminGroup;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...group.entries].sort((a, b) => {
    const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.lastName.localeCompare(b.lastName, "de");
  });
  const withTimes = group.entries.filter(
    (e) => e.runs.first?.timeSeconds != null || e.runs.second?.timeSeconds != null,
  ).length;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <ChevronRight className={cn("h-4 w-4 text-[var(--color-muted)] transition-transform", open && "rotate-90")} />
          <span className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            {group.name}
          </span>
          <span className="text-xs text-[var(--color-muted)]">
            {group.entries.length} Fahrer · {withTimes} mit Live-Zeiten
          </span>
        </button>
        <ClearClassButton event={event} group={group} onChange={onChange} onError={onError} />
      </div>
      {open && (
        <div className="overflow-x-auto border-t border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-2 py-2 text-left">Start</th>
                <th className="px-3 py-2 text-left">Fahrer</th>
                <th className="px-2 py-2 text-right">Training</th>
                <th className="px-2 py-2 text-right">Lauf 1</th>
                <th className="px-2 py-2 text-right">Lauf 2</th>
                <th className="px-2 py-2 text-right">Gesamt</th>
                <th className="px-2 py-2 text-right">Pos</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr
                  key={e.entryId}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                  style={e.teamName === HOME_TEAM ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td className="px-2 py-1.5" onClick={(ev) => ev.stopPropagation()}>
                    <StartingOrderInput entry={e} onSaved={onChange} />
                  </td>
                  <td className="px-3 py-1.5 font-medium">
                    {e.firstName} {e.lastName.charAt(0)}.
                  </td>
                  <ReadRun run={e.runs.test} muted />
                  <ReadRun run={e.runs.first} />
                  <ReadRun run={e.runs.second} />
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                    {formatSeconds(liveTotal(e.runs))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.positionLive ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReadRun({ run, muted }: { run: EndlaufRunValue | null; muted?: boolean }) {
  if (!run || run.timeSeconds === null) {
    return <td className="px-2 py-1.5 text-right text-[var(--color-muted)]">—</td>;
  }
  return (
    <td className={cn("px-2 py-1.5 text-right whitespace-nowrap tabular-nums", muted && "text-[var(--color-muted)]")}>
      {formatSeconds(run.timeSeconds)}
      {run.penaltySeconds > 0 && (
        <span className="ml-1 text-xs text-[var(--color-pending)]">+{run.penaltySeconds}</span>
      )}
    </td>
  );
}
