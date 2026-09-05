"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, Eye, LockOpen, RefreshCw, Trash2, Zap } from "lucide-react";
import Link from "next/link";

import { cn, formatDateDe } from "@/lib/utils";
import { DEFAULT_VIEW, rankRaceEntries } from "@/lib/ranking";
import { ResultsSheetImport } from "@/components/results-sheet-import.client";

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Nicht als Admin freigeschaltet — Seite neu laden und Admin-Token eingeben.",
  age_class_finalized:
    "Klasse ist finalisiert — zum Korrigieren zuerst „Wieder öffnen“, dann Zeiten ändern und erneut finalisieren.",
  not_finalized: "Klasse ist nicht finalisiert.",
  age_class_still_live: "Altersklasse ist noch live — zuerst andere Klasse auswählen.",
  invalid_time: "Ungültige Zeit.",
  invalid_penalty: "Ungültige Strafsekunden.",
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

interface RunValue {
  timeSeconds: number | null;
  penaltySeconds: number;
}

export interface AdminEntry {
  entryId: number;
  firstName: string;
  lastName: string;
  teamName: string;
  startingOrder: number | null;
  driverType: "championship" | "vorstarter" | "gaststarter";
  /** Last saved finishing position from the Endwertung, if any. */
  storedFinishPosition: number | null;
  runs: {
    test: RunValue | null;
    first: RunValue | null;
    second: RunValue | null;
  };
}

export interface AdminGroup {
  ageClassId: number;
  name: string;
  isFinalized: boolean;
  entries: AdminEntry[];
}

export function AdminEventClient({
  event,
  groups,
}: {
  event: {
    id: number;
    number: number;
    name: string;
    eventDate: string;
    status: "upcoming" | "live" | "completed";
    liveAgeClassId: number | null;
  };
  groups: AdminGroup[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const showError = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 6000);
  }, []);

  return (
    <div className="space-y-6">
      {flash && (
        <div className="sticky top-2 z-30 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 backdrop-blur">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {flash}
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--color-muted)]">
            R{event.number} · {formatDateDe(event.eventDate)}
          </div>
          <h1 className="text-2xl font-semibold">Admin: {event.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {event.status === "live" && event.liveAgeClassId && (
            <Link
              href="/live"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-live)]/40 bg-[var(--color-live)]/10 px-3 py-1.5 text-sm text-[var(--color-live)] hover:bg-[var(--color-live)]/15"
            >
              <Zap className="h-4 w-4 animate-pulse" />
              Live-Ansicht
            </Link>
          )}
          <Link
            href={`/events/${event.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            <Eye className="h-4 w-4" />
            Ergebnisse
          </Link>
          <button
            onClick={() => startTransition(() => router.refresh())}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} />
            Neu laden
          </button>
        </div>
      </header>

      <StatusControl
        eventId={event.id}
        status={event.status}
        onChange={() => router.refresh()}
      />

      {event.status === "live" && (
        <LiveAgeClassControl
          eventId={event.id}
          groups={groups}
          liveAgeClassId={event.liveAgeClassId}
          onChange={() => router.refresh()}
        />
      )}

      <div className="space-y-8">
        {groups.map((g) => (
          <AgeClassEditor
            key={g.ageClassId}
            eventId={event.id}
            eventStatus={event.status}
            liveAgeClassId={event.liveAgeClassId}
            group={g}
            onChange={() => router.refresh()}
            onError={showError}
          />
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">
            Für dieses Rennen sind noch keine Einträge vorhanden.
          </p>
        )}
      </div>
    </div>
  );
}

function StatusControl({
  eventId,
  status,
  onChange,
}: {
  eventId: number;
  status: "upcoming" | "live" | "completed";
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const setStatus = async (next: typeof status) => {
    setBusy(next);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("status update failed");
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
            status === s
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

function LiveAgeClassControl({
  eventId,
  groups,
  liveAgeClassId,
  onChange,
}: {
  eventId: number;
  groups: AdminGroup[];
  liveAgeClassId: number | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);

  const setLiveClass = async (ageClassId: number | null) => {
    setBusy(ageClassId ?? -1);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/live-age-class`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageClassId }),
      });
      if (!res.ok) throw new Error("live age class update failed");
      onChange();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-live)]/40 bg-[var(--color-live)]/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-live)]">
        <Zap className="h-4 w-4" />
        Aktive Altersklasse (Live)
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.ageClassId}
            onClick={() => setLiveClass(g.ageClassId)}
            disabled={busy !== null || g.isFinalized}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              liveAgeClassId === g.ageClassId
                ? "bg-[var(--color-live)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
              (busy !== null || g.isFinalized) && "opacity-50",
            )}
          >
            {g.name}
            {g.isFinalized && " ✓"}
          </button>
        ))}
        <button
          onClick={() => setLiveClass(null)}
          disabled={busy !== null}
          className={cn(
            "rounded-md border border-dashed border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            liveAgeClassId === null && "border-[var(--color-live)]/40 bg-[var(--color-live)]/10",
            busy !== null && "opacity-50",
          )}
        >
          Keine
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Nur eine Altersklasse ist gleichzeitig live. Nach Abschluss die nächste
        auswählen und die beendete Klasse finalisieren.
      </p>
    </div>
  );
}

function AgeClassEditor({
  eventId,
  eventStatus,
  liveAgeClassId,
  group,
  onChange,
  onError,
}: {
  eventId: number;
  eventStatus: "upcoming" | "live" | "completed";
  liveAgeClassId: number | null;
  group: AdminGroup;
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const sorted = [...group.entries].sort((a, b) => {
    const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.lastName.localeCompare(b.lastName);
  });

  const isCurrentlyLive =
    eventStatus === "live" && liveAgeClassId === group.ageClassId;
  const runCount = group.entries.reduce(
    (n, e) => n + [e.runs.test, e.runs.first, e.runs.second].filter(Boolean).length,
    0,
  );
  const [busy, setBusy] = useState(false);

  const reopen = async () => {
    if (
      !confirm(
        `${group.name} wieder öffnen?\n\nDie Zeiten werden wieder editierbar (z. B. nach einer Korrektur durch die Rennleitung). Platzierungen und Punkte bleiben bis zur erneuten Finalisierung unverändert — danach „Aus Zeiten finalisieren“ klicken, damit alles neu berechnet wird.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/admin/events/${eventId}/finalize-age-class`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageClassId: group.ageClassId }),
      });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (
      !confirm(
        `Wirklich ALLE Zeiten der ${group.name} löschen?\n\n${runCount} Läufe von ${group.entries.length} Fahrern werden entfernt (Training, Lauf 1, Lauf 2). Das kann nicht rückgängig gemacht werden.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/admin/events/${eventId}/runs`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ageClassId: group.ageClassId }),
      });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
              {group.name} — Live-Zeiten
            </h3>
            {isCurrentlyLive && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-live)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-live)]">
                <Zap className="h-3 w-3 animate-pulse" />
                LIVE
              </span>
            )}
            {group.isFinalized && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-rank-grey)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--color-muted)]">
                <Check className="h-3 w-3" />
                Finalisiert
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {group.isFinalized ? (
              <button
                onClick={reopen}
                disabled={busy}
                title="Zeiten wieder editierbar machen, z. B. nach einer Korrektur durch die Rennleitung"
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                  busy && "opacity-50",
                )}
              >
                <LockOpen className="h-3.5 w-3.5" /> Wieder öffnen (Korrektur)
              </button>
            ) : (
              runCount > 0 && (
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
              )
            )}
          </div>
        </div>
        {group.isFinalized && (
          <p className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
            Zeiten sind gesperrt. Für eine Korrektur die Klasse wieder öffnen, Zeiten ändern
            (oder per Foto neu einlesen) und anschließend erneut „Aus Zeiten finalisieren“ —
            Platzierungen und Punkte werden dann neu berechnet.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-2 py-2 text-left">Start</th>
                <th className="px-3 py-2 text-left">Fahrer</th>
                <th className="px-3 py-2 text-left">Verein</th>
                <th className="px-2 py-2 text-right">Test Zeit</th>
                <th className="px-2 py-2 text-right">Test +s</th>
                <th className="px-2 py-2 text-right">L1 Zeit</th>
                <th className="px-2 py-2 text-right">L1 +s</th>
                <th className="px-2 py-2 text-right">L2 Zeit</th>
                <th className="px-2 py-2 text-right">L2 +s</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <EntryRow
                  key={e.entryId}
                  entry={e}
                  locked={group.isFinalized}
                  onChange={onChange}
                  onError={onError}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live: read the posted sheet; completed + re-opened: correct from a photo. */}
      {eventStatus !== "upcoming" && !group.isFinalized && (
        <ResultsSheetImport
          ocrEndpoint={`/api/admin/events/${eventId}/ocr-results`}
          importEndpoint={`/api/admin/events/${eventId}/import-runs`}
          classPayload={{ ageClassId: group.ageClassId }}
          classLabel={group.name}
          entries={sorted.map((e) => ({
            entryId: e.entryId,
            firstName: e.firstName,
            lastName: e.lastName,
            teamName: e.teamName,
            startingOrder: e.startingOrder,
            runs: e.runs,
          }))}
          onImported={onChange}
        />
      )}

      {!group.isFinalized && !isCurrentlyLive && (
        <ManualResultsForm
          eventId={eventId}
          ageClassId={group.ageClassId}
          ageClassName={group.name}
          entries={sorted}
          onSaved={onChange}
        />
      )}
    </section>
  );
}

function ManualResultsForm({
  eventId,
  ageClassId,
  ageClassName,
  entries,
  onSaved,
}: {
  eventId: number;
  ageClassId: number;
  ageClassName: string;
  entries: AdminEntry[];
  onSaved: () => void;
}) {
  const hasScoringTimes = entries.some(
    (e) =>
      e.runs.first?.timeSeconds != null || e.runs.second?.timeSeconds != null,
  );

  // When timings exist, we let the server derive the official positions from
  // the runs (best run + Strafsekunden). The form then becomes a read-only
  // preview of what will be written so the admin can sanity-check before
  // finalizing.
  const proposed = useMemo(() => {
    if (!hasScoringTimes) return null;
    const ranked = rankRaceEntries(
      entries.map((e) => ({
        entryId: e.entryId,
        driverId: e.entryId, // stable tiebreaker; admin entries don't expose driverId, entryId is unique within the class
        driverType: e.driverType,
        ageClassId,
        runs: e.runs,
      })),
      new Map(),
      DEFAULT_VIEW,
    );
    const out = new Map<number, number | null>();
    for (const r of ranked) out.set(r.entry.entryId, r.finishPosition);
    return out;
  }, [hasScoringTimes, entries, ageClassId]);

  const [positions, setPositions] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      entries.map((e) => [
        e.entryId,
        e.storedFinishPosition === null ? "" : String(e.storedFinishPosition),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const positionFor = (entryId: number): string => {
    if (proposed) {
      const p = proposed.get(entryId);
      return p === null || p === undefined ? "" : String(p);
    }
    return positions[entryId] ?? "";
  };

  const sortedForForm = [...entries].sort((a, b) => {
    const sa = proposed
      ? (proposed.get(a.entryId) ?? Number.MAX_SAFE_INTEGER)
      : (a.storedFinishPosition ?? Number.MAX_SAFE_INTEGER);
    const sb = proposed
      ? (proposed.get(b.entryId) ?? Number.MAX_SAFE_INTEGER)
      : (b.storedFinishPosition ?? Number.MAX_SAFE_INTEGER);
    if (sa !== sb) return sa - sb;
    return a.lastName.localeCompare(b.lastName);
  });

  const updatePosition = (entryId: number, value: string) => {
    setPositions((prev) => ({ ...prev, [entryId]: value }));
  };

  const validateManual = (): {
    entryId: number;
    finishPosition: number | null;
  }[] | null => {
    const results: { entryId: number; finishPosition: number | null }[] = [];
    const seen = new Set<number>();
    for (const e of entries) {
      const raw = positions[e.entryId] ?? "";
      if (raw === "") {
        results.push({ entryId: e.entryId, finishPosition: null });
        continue;
      }
      const num = Number(raw);
      if (!Number.isInteger(num) || num < 1) {
        setError(`Ungültige Position für ${e.lastName} ${e.firstName}.`);
        return null;
      }
      if (seen.has(num)) {
        setError(`Position ${num} ist doppelt vergeben.`);
        return null;
      }
      seen.add(num);
      results.push({ entryId: e.entryId, finishPosition: num });
    }
    return results;
  };

  const save = async () => {
    setError(null);

    let body: Record<string, unknown> = { ageClassId };
    if (!hasScoringTimes) {
      const results = validateManual();
      if (!results) return;
      body = { ageClassId, results };
    }

    const confirmText = hasScoringTimes
      ? `Endwertung für ${ageClassName} aus den eingetragenen Zeiten finalisieren? Positionen und Punkte werden automatisch berechnet (Bester Lauf + Strafsek.).`
      : `Endwertung für ${ageClassName} speichern? Die Meisterschaftspunkte werden anhand der Positionen vergeben und die Klasse wird finalisiert.`;
    if (!confirm(confirmText)) return;

    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/finalize-age-class`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "age_class_still_live"
            ? "Altersklasse ist noch live — zuerst andere Klasse auswählen."
            : data.error === "duplicate_position"
              ? "Doppelte Positionen — bitte korrigieren."
              : data.error === "invalid_entry"
                ? "Ein Fahrer gehört nicht zur Altersklasse."
                : "Speichern fehlgeschlagen.",
        );
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName} — Endwertung (Meisterschaft)
        </h3>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-[var(--color-muted)]">
          {hasScoringTimes
            ? "Positionen werden aus den eingetragenen Zeiten berechnet (Bester Lauf + Strafsekunden). Punkte werden anhand der Punktetabelle vergeben (nur Meisterschaftsfahrer; Vor- und Gaststarter ohne Punkte)."
            : "Trage die offiziellen Platzierungen ein. Punkte werden aus der Punktetabelle abgeleitet (nur Meisterschaftsfahrer erhalten Punkte; Vor- und Gaststarter behalten ihre Platzierung, ohne Punkte). Leer lassen = nicht gewertet / DNF."}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left">Fahrer</th>
                <th className="px-3 py-2 text-left">Verein</th>
                <th className="px-2 py-2 text-right">Platz</th>
              </tr>
            </thead>
            <tbody>
              {sortedForForm.map((e) => (
                <tr
                  key={e.entryId}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                >
                  <td className="px-3 py-1.5 font-medium">
                    {e.lastName} {e.firstName}
                    {e.driverType !== "championship" && (
                      <span className="ml-2 rounded-sm bg-[var(--color-surface-2)] px-1 py-0.5 text-[10px] text-[var(--color-muted)] uppercase">
                        {e.driverType}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--color-muted)]">
                    {e.teamName}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={positionFor(e.entryId)}
                      onChange={(ev) =>
                        updatePosition(e.entryId, ev.target.value)
                      }
                      disabled={busy || hasScoringTimes}
                      readOnly={hasScoringTimes}
                      className={cn(
                        "w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums",
                        (busy || hasScoringTimes) && "opacity-60",
                      )}
                      placeholder="—"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {error ? (
            <span className="text-xs text-red-400">{error}</span>
          ) : (
            <span />
          )}
          <button
            onClick={save}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-background)]",
              busy && "cursor-not-allowed opacity-50",
            )}
          >
            <Check className="h-3.5 w-3.5" />
            {busy
              ? "Speichern…"
              : hasScoringTimes
                ? "Aus Zeiten finalisieren"
                : "Endwertung speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  locked,
  onChange,
  onError,
}: {
  entry: AdminEntry;
  locked: boolean;
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const hasRuns = !!(entry.runs.test || entry.runs.first || entry.runs.second);

  const clearDriver = async () => {
    if (
      !confirm(
        `Alle Zeiten von ${entry.lastName} ${entry.firstName} löschen (Training, Lauf 1, Lauf 2)?`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await apiCall(`/api/admin/entries/${entry.entryId}/runs`, { method: "DELETE" });
      if (!r.ok) onError(r.error);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const common = { entryId: entry.entryId, disabled: locked || busy, onSaved: onChange, onError };
  return (
    <tr className="border-b border-[var(--color-border)]/50 last:border-0">
      <td className="px-2 py-1.5">
        <StartingOrderInput entry={entry} onSaved={onChange} />
      </td>
      <td className="px-3 py-1.5 font-medium">
        {entry.lastName} {entry.firstName}
        {entry.driverType !== "championship" && (
          <span className="ml-2 rounded-sm bg-[var(--color-surface-2)] px-1 py-0.5 text-[10px] text-[var(--color-muted)] uppercase">
            {entry.driverType}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-[var(--color-muted)]">{entry.teamName}</td>
      <RunInput {...common} runType="test" run={entry.runs.test} />
      <RunInput {...common} runType="first" run={entry.runs.first} />
      <RunInput {...common} runType="second" run={entry.runs.second} />
      <td className="px-2 py-1.5 text-right">
        {hasRuns && !locked && (
          <button
            onClick={clearDriver}
            disabled={busy}
            title="Alle Zeiten dieses Fahrers löschen"
            className={cn(
              "rounded-md p-1 text-[var(--color-muted)] hover:bg-red-500/10 hover:text-red-400",
              busy && "opacity-50",
            )}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}

function StartingOrderInput({
  entry,
  onSaved,
}: {
  entry: AdminEntry;
  onSaved: () => void;
}) {
  const initial = entry.startingOrder === null ? "" : String(entry.startingOrder);
  const [value, setValue] = useState<string>(initial);
  const [busy, setBusy] = useState(false);
  // Keep in sync when the server data changes underneath us (router.refresh
  // after a bulk import) — otherwise the input would keep showing stale values.
  useEffect(() => setValue(initial), [initial]);

  const save = async () => {
    if (value === initial) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/entries/${entry.entryId}/start`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startingOrder: value === "" ? null : Number(value),
        }),
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
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      disabled={busy}
      className={cn(
        "w-14 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right text-sm",
        busy && "opacity-50",
      )}
      placeholder="—"
    />
  );
}

function RunInput({
  entryId,
  runType,
  run,
  disabled,
  onSaved,
  onError,
}: {
  entryId: number;
  runType: "test" | "first" | "second";
  run: RunValue | null;
  disabled: boolean;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const initialTime =
    run?.timeSeconds === null || run?.timeSeconds === undefined
      ? ""
      : String(run.timeSeconds);
  const initialPenalty = run ? String(run.penaltySeconds) : "0";
  const [time, setTime] = useState<string>(initialTime);
  const [penalty, setPenalty] = useState<string>(initialPenalty);
  const [busy, setBusy] = useState(false);
  // Re-sync with server data after a refresh (e.g. bulk import from a photo).
  useEffect(() => setTime(initialTime), [initialTime]);
  useEffect(() => setPenalty(initialPenalty), [initialPenalty]);

  const save = async () => {
    if (time === initialTime && penalty === initialPenalty) return;
    setBusy(true);
    try {
      const body = {
        runType,
        timeSeconds: time === "" ? null : Number(time.replace(",", ".")),
        penaltySeconds: penalty === "" ? 0 : Number(penalty),
      };
      const r = await apiCall(`/api/admin/entries/${entryId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        onError(r.error);
        setTime(initialTime);
        setPenalty(initialPenalty);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || busy;
  return (
    <>
      <td className="px-2 py-1.5">
        <input
          type="text"
          inputMode="decimal"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          disabled={off}
          title={disabled ? "Klasse ist finalisiert — zum Korrigieren wieder öffnen" : undefined}
          className={cn(
            "w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums",
            off && "opacity-50",
          )}
          placeholder="—"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          inputMode="numeric"
          value={penalty}
          onChange={(e) => setPenalty(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          disabled={off}
          title={disabled ? "Klasse ist finalisiert — zum Korrigieren wieder öffnen" : undefined}
          min={0}
          className={cn(
            "w-14 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums",
            off && "opacity-50",
          )}
        />
      </td>
    </>
  );
}
