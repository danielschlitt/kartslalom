"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { ChevronRight, UserMinus, UserPlus, Users } from "lucide-react";

import type { EndlaufFieldDriver } from "@/lib/dal/endlauf26";
import { formatPoints } from "@/lib/endlauf26/format";
import {
  ageClassName,
  ENDLAUF26_AGE_CLASSES,
  type Endlauf26Championship,
} from "@/lib/endlauf26/ranking";
import { cn } from "@/lib/utils";

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Nicht als Admin freigeschaltet — Seite neu laden und Admin-Token eingeben.",
  not_found: "Fahrer nicht gefunden.",
  not_in_field: "Fahrer gehört nicht zum Endlauf-Feld.",
  already_qualified: "Fahrer ist bereits qualifiziert.",
  has_times: "Für diesen Fahrer sind schon Zeiten erfasst — Nominierung kann nicht zurückgenommen werden.",
};

/**
 * Championship-wide field management: flag drivers as not competing and
 * nominate replacement candidates from the non-qualified part of the
 * standings list. Both apply to every Endlauf of the championship.
 */
export function FieldAdmin({
  championship,
  drivers,
}: {
  championship: Endlauf26Championship;
  drivers: EndlaufFieldDriver[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const patch = useCallback(
    async (driverId: number, body: { withdrawn?: boolean; nominated?: boolean }) => {
      setBusyId(driverId);
      setFlash(null);
      try {
        const res = await fetch(`/api/endlauf26/drivers/${driverId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setFlash(ERROR_TEXT[data.error ?? ""] ?? `Fehler (${data.error ?? res.status}).`);
        }
        startTransition(() => router.refresh());
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  const classes = ENDLAUF26_AGE_CLASSES.map((c) => ({
    ageClass: c,
    field: drivers.filter((d) => d.ageClass === c && (d.qualified || d.nominated)),
    candidates: drivers.filter((d) => d.ageClass === c && !d.qualified && !d.nominated),
  })).filter((c) => c.field.length > 0 || c.candidates.length > 0);

  const withdrawnTotal = drivers.filter((d) => d.withdrawn && (d.qualified || d.nominated)).length;
  const nominatedTotal = drivers.filter((d) => d.nominated).length;

  return (
    <section id="fahrerfeld" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            <Users className="h-4 w-4" />
            Fahrerfeld
            <span className="font-normal normal-case tracking-normal">
              · {withdrawnTotal} abgemeldet · {nominatedTotal} nachnominiert
            </span>
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-[var(--color-muted)]">
            Gilt für alle Endläufe der Meisterschaft. <strong>Abgemeldete</strong> Fahrer
            verschwinden aus Startlisten und Live-Ansicht und werden nicht mehr gewertet — sie
            stehen ohne Platz am Ende ihrer Klasse.{" "}
            <strong>Nachnominierte</strong> Fahrer aus der Restliste zählen wie Qualifizierte
            und starten in noch nicht begonnenen Klassen als Erste (Startreihenfolge von unten
            nach oben).
          </p>
        </div>
      </div>

      {flash && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {flash}
        </div>
      )}

      <div className="space-y-2">
        {classes.map((c) => (
          <ClassField
            key={c.ageClass}
            championship={championship}
            ageClass={c.ageClass}
            field={c.field}
            candidates={c.candidates}
            busyId={busyId}
            disabled={pending}
            onPatch={patch}
          />
        ))}
        {classes.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">
            Keine Fahrer importiert. <code>make seed-endlauf26</code> ausführen.
          </p>
        )}
      </div>
    </section>
  );
}

function ClassField({
  championship,
  ageClass,
  field,
  candidates,
  busyId,
  disabled,
  onPatch,
}: {
  championship: Endlauf26Championship;
  ageClass: number;
  field: EndlaufFieldDriver[];
  candidates: EndlaufFieldDriver[];
  busyId: number | null;
  disabled: boolean;
  onPatch: (driverId: number, body: { withdrawn?: boolean; nominated?: boolean }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [candidateId, setCandidateId] = useState<string>("");
  const withdrawn = field.filter((d) => d.withdrawn).length;
  const nominated = field.filter((d) => d.nominated).length;
  const competing = field.length - withdrawn;
  const groupLabel = championship === "hmj" ? "Verband" : "Region";

  const sorted = useMemo(
    () =>
      [...field].sort((a, b) => {
        // Qualified by list position first, nominated drivers at the end.
        if (a.nominated !== b.nominated) return a.nominated ? 1 : -1;
        const ap = a.seasonPosition ?? Number.MAX_SAFE_INTEGER;
        const bp = b.seasonPosition ?? Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
        return a.lastName.localeCompare(b.lastName, "de");
      }),
    [field],
  );

  const nominate = async () => {
    const id = Number(candidateId);
    const cand = candidates.find((c) => c.driverId === id);
    if (!cand) return;
    if (
      !confirm(
        `${cand.lastName} ${cand.firstName} (${cand.teamName}) für ${ageClassName(ageClass)} nachnominieren?\n\nDer Fahrer wird in alle Endläufe eingetragen und zählt in der Wertung wie ein qualifizierter Fahrer.`,
      )
    )
      return;
    await onPatch(id, { nominated: true });
    setCandidateId("");
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-[var(--color-muted)] transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName(ageClass)}
        </span>
        <span className="text-xs text-[var(--color-muted)]">
          {competing} am Start
          {withdrawn > 0 && (
            <>
              {" · "}
              <span className="text-[var(--color-live)]">{withdrawn} abgemeldet</span>
            </>
          )}
          {nominated > 0 && (
            <>
              {" · "}
              <span className="text-[var(--color-accent)]">{nominated} nachnominiert</span>
            </>
          )}
          {" · "}
          {candidates.length} Ersatzkandidaten
        </span>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-3 py-2 text-right">Saison</th>
                  <th className="px-3 py-2 text-left">Fahrer</th>
                  <th className="px-3 py-2 text-left">Verein</th>
                  <th className="px-2 py-2 text-left">{groupLabel}</th>
                  <th className="px-2 py-2 text-right">Punkte</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const busy = busyId === d.driverId;
                  return (
                    <tr
                      key={d.driverId}
                      className={cn(
                        "border-b border-[var(--color-border)]/50 last:border-0",
                        d.withdrawn && "opacity-60",
                        busy && "opacity-40",
                      )}
                    >
                      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--color-muted)]">
                        {d.seasonPosition ?? "—"}.
                      </td>
                      <td className="px-3 py-1.5 font-medium">
                        {d.lastName} {d.firstName}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-muted)]">{d.teamName}</td>
                      <td className="px-2 py-1.5 text-[var(--color-muted)]">
                        {championship === "hmj" ? d.verband : d.region}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {d.seasonPoints === null ? "—" : formatPoints(d.seasonPoints)}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusBadge driver={d} />
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">
                        {d.withdrawn ? (
                          <ActionButton
                            disabled={disabled || busy}
                            onClick={() => onPatch(d.driverId, { withdrawn: false })}
                            icon={<UserPlus className="h-3.5 w-3.5" />}
                            label="Wieder anmelden"
                          />
                        ) : (
                          <ActionButton
                            disabled={disabled || busy}
                            onClick={() => {
                              if (
                                confirm(
                                  `${d.lastName} ${d.firstName} für alle Endläufe abmelden?\n\nDer Fahrer verschwindet aus den Startlisten${d.hasTimes ? " — bereits erfasste Zeiten bleiben erhalten" : ""}.`,
                                )
                              )
                                void onPatch(d.driverId, { withdrawn: true });
                            }}
                            icon={<UserMinus className="h-3.5 w-3.5" />}
                            label="Abmelden"
                            danger
                          />
                        )}
                        {d.nominated && !d.hasTimes && (
                          <ActionButton
                            disabled={disabled || busy}
                            onClick={() => {
                              if (
                                confirm(
                                  `Nominierung von ${d.lastName} ${d.firstName} zurücknehmen? Die Einträge in allen Endläufen werden entfernt.`,
                                )
                              )
                                void onPatch(d.driverId, { nominated: false });
                            }}
                            label="Nominierung zurücknehmen"
                            className="ml-1"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-[var(--color-muted)]">
                      Keine Fahrer im Feld.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              void nominate();
            }}
            className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-4 py-3"
          >
            <UserPlus className="h-4 w-4 text-[var(--color-accent)]" />
            <span className="text-sm font-medium">Nachnominieren:</span>
            <select
              value={candidateId}
              onChange={(ev) => setCandidateId(ev.target.value)}
              disabled={disabled || candidates.length === 0}
              className="min-w-[18rem] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm"
            >
              <option value="">
                {candidates.length === 0
                  ? "Keine Ersatzkandidaten in dieser Klasse"
                  : "Fahrer aus der Restliste wählen…"}
              </option>
              {candidates.map((c) => (
                <option key={c.driverId} value={c.driverId}>
                  {c.seasonPosition ?? "—"}. {c.lastName} {c.firstName} · {c.teamName}
                  {championship === "hmj" ? (c.verband ? ` · ${c.verband}` : "") : c.region ? ` · ${c.region}` : ""}
                  {c.seasonPoints !== null ? ` · ${formatPoints(c.seasonPoints)} Pkt.` : ""}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={disabled || candidateId === ""}
              className={cn(
                "inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white",
                (disabled || candidateId === "") && "opacity-50",
              )}
            >
              <UserPlus className="h-4 w-4" /> In alle Endläufe eintragen
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ driver }: { driver: EndlaufFieldDriver }) {
  if (driver.withdrawn) {
    return (
      <span className="rounded-sm bg-[var(--color-live)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-live)] uppercase">
        abgemeldet
      </span>
    );
  }
  if (driver.nominated) {
    return (
      <span className="rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase">
        Nachrücker
      </span>
    );
  }
  return <span className="text-xs text-[var(--color-muted)]">qualifiziert</span>;
}

function ActionButton({
  onClick,
  disabled,
  icon,
  label,
  danger,
  className,
}: {
  onClick: () => void;
  disabled: boolean;
  icon?: React.ReactNode;
  label: string;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
        danger
          ? "border-[var(--color-live)]/40 text-[var(--color-live)] hover:bg-[var(--color-live)]/10"
          : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
        disabled && "opacity-50",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
