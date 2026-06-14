"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Eye, RefreshCw, Zap } from "lucide-react";
import Link from "next/link";

import { cn, formatDateDe } from "@/lib/utils";

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

  return (
    <div className="space-y-6">
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
}: {
  eventId: number;
  eventStatus: "upcoming" | "live" | "completed";
  liveAgeClassId: number | null;
  group: AdminGroup;
  onChange: () => void;
}) {
  const sorted = [...group.entries].sort((a, b) => {
    const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.lastName.localeCompare(b.lastName);
  });

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            {group.name}
          </h3>
          {liveAgeClassId === group.ageClassId && (
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
        {!group.isFinalized && (
          <FinalizeButton
            eventId={eventId}
            ageClassId={group.ageClassId}
            disabled={
              eventStatus === "live" && liveAgeClassId === group.ageClassId
            }
            onFinalized={onChange}
          />
        )}
      </div>
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <EntryRow key={e.entryId} entry={e} onChange={onChange} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FinalizeButton({
  eventId,
  ageClassId,
  disabled,
  onFinalized,
}: {
  eventId: number;
  ageClassId: number;
  disabled: boolean;
  onFinalized: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalize = async () => {
    if (
      !confirm(
        "Endwertung speichern? Meisterschaftspunkte werden aus den aktuellen Zeiten berechnet und können danach nicht mehr automatisch geändert werden.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/finalize-age-class`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ageClassId }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "age_class_still_live"
            ? "Altersklasse ist noch live — zuerst andere Klasse auswählen."
            : "Speichern fehlgeschlagen.",
        );
        return;
      }
      onFinalized();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={finalize}
        disabled={disabled || busy}
        title={
          disabled
            ? "Altersklasse muss zuerst beendet werden (nicht mehr als live markiert)"
            : undefined
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1 text-xs font-medium hover:bg-[var(--color-background)]",
          (disabled || busy) && "cursor-not-allowed opacity-50",
        )}
      >
        <Check className="h-3.5 w-3.5" />
        {busy ? "Speichern…" : "Endwertung speichern"}
      </button>
    </div>
  );
}

function EntryRow({
  entry,
  onChange,
}: {
  entry: AdminEntry;
  onChange: () => void;
}) {
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
      <RunInput entryId={entry.entryId} runType="test" run={entry.runs.test} onSaved={onChange} />
      <RunInput entryId={entry.entryId} runType="first" run={entry.runs.first} onSaved={onChange} />
      <RunInput entryId={entry.entryId} runType="second" run={entry.runs.second} onSaved={onChange} />
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
  const [value, setValue] = useState<string>(
    entry.startingOrder === null ? "" : String(entry.startingOrder),
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (value === (entry.startingOrder === null ? "" : String(entry.startingOrder))) return;
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
  onSaved,
}: {
  entryId: number;
  runType: "test" | "first" | "second";
  run: RunValue | null;
  onSaved: () => void;
}) {
  const [time, setTime] = useState<string>(
    run?.timeSeconds === null || run?.timeSeconds === undefined
      ? ""
      : String(run.timeSeconds),
  );
  const [penalty, setPenalty] = useState<string>(
    run ? String(run.penaltySeconds) : "0",
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        runType,
        timeSeconds: time === "" ? null : Number(time.replace(",", ".")),
        penaltySeconds: penalty === "" ? 0 : Number(penalty),
      };
      await fetch(`/api/admin/entries/${entryId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

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
          disabled={busy}
          className={cn(
            "w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums",
            busy && "opacity-50",
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
          disabled={busy}
          min={0}
          className={cn(
            "w-14 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-right text-sm tabular-nums",
            busy && "opacity-50",
          )}
        />
      </td>
    </>
  );
}
