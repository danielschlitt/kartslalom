"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronRight,
  Eye,
  Lock,
  LockOpen,
  Mic,
  RefreshCw,
  Square,
  Zap,
} from "lucide-react";

import { parseDictation } from "@/lib/endlauf26/dictation";
import { formatFactor, formatSeconds } from "@/lib/endlauf26/format";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import type { EndlaufEntryRuns, EndlaufRunValue } from "@/lib/endlauf26/ranking";
import { bestRunTotal } from "@/lib/endlauf26/ranking";
import { cn } from "@/lib/utils";

/* ────────────────────────────── types ────────────────────────────── */

export interface AdminEntry {
  entryId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  startingOrder: number | null;
  runs: EndlaufEntryRuns;
  positionRun1: number | null;
  positionRun2: number | null;
  positionLive: number | null;
  finishPosition: number | null;
  pointsAwarded: number;
}

export interface AdminGroup {
  ageClass: number;
  name: string;
  isFinalized: boolean;
  entries: AdminEntry[];
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
  age_class_finalized: "Klasse ist bereits abgeschlossen.",
  event_not_live: "Der Endlauf ist nicht live.",
  age_class_not_active: "Diese Klasse ist nicht aktiv.",
  driver_not_active: "Fahrer ist nicht aktiviert.",
  no_live_age_class: "Zuerst eine Klasse aktivieren.",
  entry_not_in_live_class: "Fahrer gehört nicht zur aktiven Klasse.",
  age_class_still_live: "Klasse ist noch aktiv — zuerst deaktivieren.",
  already_finalized: "Klasse ist bereits abgeschlossen.",
  no_times: "Keine Zeiten vorhanden.",
  missing_api_key: "OPENAI_API_KEY fehlt — Diktat nicht verfügbar.",
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

/* ────────────────────────────── root ────────────────────────────── */

export function AdminEndlaufClient({
  basePath,
  event,
  groups,
}: {
  basePath: string;
  event: AdminEvent;
  groups: AdminGroup[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const [flash, setFlash] = useState<string | null>(null);
  const showError = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }, []);

  const activeGroup = groups.find((g) => g.ageClass === event.liveAgeClass) ?? null;
  const otherGroups = groups.filter((g) => g.ageClass !== event.liveAgeClass);

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

      <StatusControl event={event} onChange={refresh} onError={showError} />

      {event.status === "live" && (
        <LiveClassControl event={event} groups={groups} onChange={refresh} onError={showError} />
      )}

      {event.status !== "live" && (
        <p className="text-sm text-[var(--color-muted)]">
          Zum Erfassen von Zeiten den Endlauf auf <strong>Live</strong> setzen, dann eine Klasse
          und den aktuellen Fahrer aktivieren. Reihenfolge je Klasse: Training Fahrer 1, Training
          Fahrer 2, Lauf 1 Fahrer 1, Lauf 1 Fahrer 2, nächstes Paar … danach Lauf 2 für alle.
        </p>
      )}

      {activeGroup && (
        <ActiveClassEditor
          event={event}
          group={activeGroup}
          onChange={refresh}
          onError={showError}
        />
      )}

      <div className="space-y-3">
        {otherGroups.map((g) => (
          <CollapsedClass
            key={g.ageClass}
            event={event}
            group={g}
            onChange={refresh}
            onError={showError}
          />
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">
            Für diesen Endlauf sind keine Fahrer eingetragen. <code>make seed-endlauf26</code>{" "}
            ausführen.
          </p>
        )}
      </div>
    </div>
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
      !confirm("Endlauf beenden? Aktive Klasse und Fahrer werden zurückgesetzt.")
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
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
            disabled={busy || g.isFinalized}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              event.liveAgeClass === g.ageClass
                ? "bg-[var(--color-live)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
              (busy || g.isFinalized) && "opacity-50",
            )}
          >
            {g.name}
            {g.isFinalized && " ✓"}
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
        Nur eine Klasse ist gleichzeitig aktiv. Nach dem letzten Lauf die Klasse deaktivieren
        („Keine“ oder nächste Klasse) und dann abschließen — erst dann fließen die Punkte in die
        Endlaufwertung.
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
              {group.name} — Zeiten
            </h3>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-live)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-live)]">
              <Zap className="h-3 w-3 animate-pulse" />
              AKTIV
            </span>
          </div>
          <span className="text-xs text-[var(--color-muted)]">
            Startreihenfolge von unten nach oben · Zeile anklicken = Fahrer aktivieren
          </span>
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
                <th className="px-3 py-2 text-left">Verein</th>
                <th className="px-2 py-2 text-right">Training</th>
                <th className="px-2 py-2 text-right">Lauf 1</th>
                <th className="px-2 py-2 text-right" title="Live-Position nach Lauf 1">Pos L1</th>
                <th className="px-2 py-2 text-right">Lauf 2</th>
                <th className="px-2 py-2 text-right" title="Live-Position nach Lauf 2">Pos L2</th>
                <th className="px-2 py-2 text-right">Bester</th>
                <th className="px-2 py-2 text-right" title="Live-Gesamtposition">Pos</th>
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
                        {e.lastName} {e.firstName}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-muted)]">{e.teamName}</td>
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
                    <td className="px-2 py-1.5 text-right tabular-nums">{e.positionRun1 ?? "—"}</td>
                    <EditableRunCell
                      entry={e}
                      runType="second"
                      editable={isActive}
                      onActivate={() => activate(e.entryId)}
                      onSave={saveRun}
                    />
                    <td className="px-2 py-1.5 text-right tabular-nums">{e.positionRun2 ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                      {formatSeconds(bestRunTotal(e.runs))}
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
    (res: { text: string; timeSeconds: number | null; penaltySeconds: number | null }) => {
      setLastText(res.text);
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
  onResult: (r: { text: string; timeSeconds: number | null; penaltySeconds: number | null }) => void;
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

/* ─────────────────────────── collapsed class ─────────────────────────── */

function CollapsedClass({
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
  const [busy, setBusy] = useState(false);
  const sorted = [...group.entries].sort((a, b) => {
    if (group.isFinalized) {
      const ap = a.finishPosition ?? Number.MAX_SAFE_INTEGER;
      const bp = b.finishPosition ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
    }
    const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.lastName.localeCompare(b.lastName, "de");
  });
  const withTimes = group.entries.filter(
    (e) => e.runs.first?.timeSeconds != null || e.runs.second?.timeSeconds != null,
  ).length;

  const finalize = async () => {
    if (
      !confirm(
        `${group.name} abschließen?\n\nPlatz und Punkte werden aus den Zeiten berechnet (bester Lauf + Strafsek., Faktor ${formatFactor(event.factor)} in der Wertung) und die Klasse wird gesperrt. ${withTimes} von ${group.entries.length} Fahrern haben Zeiten.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/events/${event.id}/finalize-class`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageClass: group.ageClass, force: withTimes === 0 }),
      });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!confirm(`${group.name} wieder öffnen? Die Punkte fallen bis zum erneuten Abschluss aus der Wertung.`)) return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/endlauf26/events/${event.id}/finalize-class`, {
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
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
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
            {group.entries.length} Fahrer · {withTimes} mit Zeiten
          </span>
          {group.isFinalized && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-rank-green)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--color-rank-green)]">
              <Check className="h-3 w-3" /> Abgeschlossen
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {group.isFinalized ? (
            <button
              onClick={reopen}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <LockOpen className="h-3.5 w-3.5" /> Wieder öffnen
            </button>
          ) : (
            <button
              onClick={finalize}
              disabled={busy || (event.status === "live" && event.liveAgeClass === group.ageClass)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-background)]",
                busy && "opacity-50",
              )}
            >
              <Lock className="h-3.5 w-3.5" /> Klasse abschließen → Wertung
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="overflow-x-auto border-t border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-2 py-2 text-left">{group.isFinalized ? "Platz" : "Start"}</th>
                <th className="px-3 py-2 text-left">Fahrer</th>
                <th className="px-3 py-2 text-left">Verein</th>
                <th className="px-2 py-2 text-right">Training</th>
                <th className="px-2 py-2 text-right">Lauf 1</th>
                <th className="px-2 py-2 text-right">Pos L1</th>
                <th className="px-2 py-2 text-right">Lauf 2</th>
                <th className="px-2 py-2 text-right">Pos L2</th>
                <th className="px-2 py-2 text-right">Bester</th>
                <th className="px-2 py-2 text-right">{group.isFinalized ? "Punkte" : "Pos"}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr
                  key={e.entryId}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                  style={e.teamName === HOME_TEAM ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td className="px-2 py-1.5 tabular-nums">
                    {group.isFinalized ? (e.finishPosition ?? "—") : (e.startingOrder ?? "—")}
                  </td>
                  <td className="px-3 py-1.5 font-medium">
                    {e.lastName} {e.firstName}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--color-muted)]">{e.teamName}</td>
                  <ReadRun run={e.runs.test} muted />
                  <ReadRun run={e.runs.first} />
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.positionRun1 ?? "—"}</td>
                  <ReadRun run={e.runs.second} />
                  <td className="px-2 py-1.5 text-right tabular-nums">{e.positionRun2 ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                    {formatSeconds(bestRunTotal(e.runs))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {group.isFinalized ? e.pointsAwarded : (e.positionLive ?? "—")}
                  </td>
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
