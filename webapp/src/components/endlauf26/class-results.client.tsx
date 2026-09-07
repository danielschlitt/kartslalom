"use client";

/**
 * Official results of one age class at one Endlauf, with alternative
 * scorings on top:
 *   Offiziell · Nur schnellste Runde · Nur schnellste Runde (mit Fehlern) · Ohne Fehler · Nur Fehler
 *
 * The official order is the printed list. The alternatives are "what if"
 * views computed client-side; in the time-based ones a Diff column shows the
 * gap to the leader — or, after clicking a row, to that driver (± values).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ImageIcon, Info } from "lucide-react";

import {
  diffSeconds,
  formatDiff,
  runWithPenalty,
  SCORING_MODES,
  scoreRows,
  type ScoringMode,
} from "@/lib/endlauf26/alt-scoring";
import { formatSeconds } from "@/lib/endlauf26/format";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import type { EndlaufResultImageMeta, EndlaufResultRow } from "@/lib/endlauf26/results-types";
import {
  stickyBodyBg,
  stickyDriverClass,
  stickyRankClass,
} from "@/components/sticky-table-cols";
import { cn } from "@/lib/utils";

export function ClassResults({
  ageClassName,
  rows,
  images,
  factor,
  driverBasePath,
  isAdmin,
  adminHref,
}: {
  ageClassName: string;
  rows: EndlaufResultRow[];
  images: EndlaufResultImageMeta[];
  factor: number;
  /** Driver pages live at `${driverBasePath}/${driverId}`. */
  driverBasePath: string;
  isAdmin?: boolean;
  adminHref?: string;
}) {
  const [mode, setMode] = useState<ScoringMode>("official");
  const [refDriver, setRefDriver] = useState<number | null>(null);

  const scored = useMemo(() => scoreRows(rows, mode), [rows, mode]);
  const timeMode = mode === "fastest" || mode === "fastest-penalty" || mode === "no-penalty";
  const refValue = useMemo(() => {
    if (!timeMode) return null;
    const ref =
      refDriver !== null ? scored.find((s) => s.row.driverId === refDriver) : scored[0];
    return ref?.value ?? null;
  }, [scored, refDriver, timeMode]);
  const refRow = refDriver !== null ? rows.find((r) => r.driverId === refDriver) : null;
  const current = SCORING_MODES.find((m) => m.id === mode)!;
  const warningCount = rows.reduce((n, r) => n + r.warnings.length, 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            {ageClassName}
          </h3>
        </div>
        <p className="px-4 py-4 text-sm text-[var(--color-muted)]">
          Noch keine offizielle Ergebnisliste eingelesen.
          {isAdmin && adminHref && (
            <>
              {" "}
              <Link href={adminHref} className="text-[var(--color-accent)] hover:underline">
                Liste einlesen →
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <span>{rows.length} Fahrer</span>
          {images.map((img, i) => (
            <a
              key={img.id}
              href={`/api/endlauf26/result-images/${img.id}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
              title="Foto der offiziellen Ergebnisliste öffnen"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Ergebnisliste{images.length > 1 ? ` ${i + 1}` : ""} (Foto)
            </a>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] px-4 py-2">
        {SCORING_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            title={m.hint}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              mode === m.id
                ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-foreground)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            )}
          >
            {m.label}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
          <Info className="h-3.5 w-3.5" />
          {current.hint}
          {timeMode && (
            <>
              {" "}
              {refRow ? (
                <>
                  Diff zu <strong>{refRow.firstName} {refRow.lastName}</strong>.{" "}
                  <button
                    type="button"
                    onClick={() => setRefDriver(null)}
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    Zurück zum Führenden
                  </button>
                </>
              ) : (
                "Zeile anklicken → Diff relativ zu diesem Fahrer."
              )}
            </>
          )}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className={cn("px-3 py-2 text-left", stickyRankClass({ header: true }))}>
                {mode === "official" ? "Platz" : "Rang"}
              </th>
              <th className={cn("px-3 py-2 text-left", stickyDriverClass({ header: true }))}>Fahrer</th>
              <th className="px-3 py-2 text-left">Verein</th>
              {mode === "official" && <th className="px-2 py-2 text-right">Start</th>}
              {mode === "official" && (
                <th className="px-2 py-2 text-right text-[var(--color-muted)]">Training</th>
              )}
              {mode === "penalty-only" ? (
                <>
                  <th className="px-2 py-2 text-right">Fehler L1</th>
                  <th className="px-2 py-2 text-right">Fehler L2</th>
                  <th className="px-2 py-2 text-right">Fehler ges.</th>
                  <th className="px-2 py-2 text-right">Gesamtzeit</th>
                </>
              ) : (
                <>
                  <th className="px-2 py-2 text-right">Lauf 1</th>
                  <th className="px-2 py-2 text-right">Lauf 2</th>
                  {mode === "official" && <th className="px-2 py-2 text-right">Fehler</th>}
                  <th className="px-2 py-2 text-right">
                    {mode === "official"
                      ? "Gesamt"
                      : mode === "fastest" || mode === "fastest-penalty"
                        ? "Schnellste"
                        : "Summe"}
                  </th>
                  {timeMode && <th className="px-2 py-2 text-right">Diff</th>}
                </>
              )}
              {mode === "official" ? (
                <th className="px-2 py-2 text-right" title={factor !== 1 ? `Punkte laut Liste · in der Wertung ×${factor}` : "Punkte laut Liste"}>
                  Punkte
                </th>
              ) : (
                <th className="px-2 py-2 text-right" title="Offizieller Platz laut Ergebnisliste">
                  Offiz.
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {scored.map(({ row: r, rank, value, secondary }) => {
              const isHome = r.teamName === HOME_TEAM;
              const isRef = timeMode && refDriver === r.driverId;
              const d = timeMode ? diffSeconds(value, refValue) : null;
              const showPenaltyStrike = mode === "fastest" || mode === "no-penalty";
              const fasterRun =
                mode === "fastest" && r.run1Time !== null && r.run2Time !== null
                  ? r.run1Time <= r.run2Time
                    ? 1
                    : 2
                  : mode === "fastest-penalty" && r.run1Time !== null && r.run2Time !== null
                    ? (runWithPenalty(r.run1Time, r.run1Penalty) ?? 0) <=
                      (runWithPenalty(r.run2Time, r.run2Penalty) ?? 0)
                      ? 1
                      : 2
                    : null;
              return (
                <tr
                  key={r.id}
                  onClick={timeMode ? () => setRefDriver(isRef ? null : r.driverId) : undefined}
                  className={cn(
                    "border-b border-[var(--color-border)]/50 last:border-0",
                    timeMode && "cursor-pointer hover:bg-[var(--color-surface-2)]",
                    isRef && "bg-[var(--color-accent)]/10",
                  )}
                  style={isHome && !isRef ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td
                    className={cn("px-3 py-2", stickyRankClass(), !isHome && "max-md:bg-[var(--color-surface)]")}
                    style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                  >
                    <span
                      className={cn(
                        "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums",
                        isHome && "bg-[var(--color-rank-blue)] text-white",
                        rank === 1 && "bg-[var(--color-rank-green)] text-white",
                        rank === null && "text-[var(--color-muted)]",
                      )}
                    >
                      {rank ?? "—"}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 font-medium",
                      stickyDriverClass(),
                      !isHome && "max-md:bg-[var(--color-surface)]",
                    )}
                    style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                  >
                    <Link
                      href={`${driverBasePath}/${r.driverId}`}
                      onClick={(ev) => ev.stopPropagation()}
                      className="hover:underline"
                    >
                      {r.lastName} {r.firstName}
                    </Link>
                    {!r.qualified && (
                      <span
                        className="ml-2 rounded-sm bg-[var(--color-accent)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase"
                        title="Nachrücker — war in der Liste nicht grün markiert"
                      >
                        Nachrücker
                      </span>
                    )}
                    {r.warnings.length > 0 && (
                      <span
                        className="ml-2 inline-flex align-middle text-[var(--color-pending)]"
                        title={r.warnings.join("\n")}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{r.teamName}</td>
                  {mode === "official" && (
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">
                      {r.startPosition ?? "—"}
                    </td>
                  )}
                  {mode === "official" && (
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">
                      {formatSeconds(r.testTime)}
                    </td>
                  )}
                  {mode === "penalty-only" ? (
                    <>
                      <PenaltyCell n={r.run1Penalty} />
                      <PenaltyCell n={r.run2Penalty} />
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{value ?? "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatSeconds(secondary)}</td>
                    </>
                  ) : (
                    <>
                      <RunCell
                        time={r.run1Time}
                        penalty={r.run1Penalty}
                        strikePenalty={showPenaltyStrike}
                        highlight={fasterRun === 1}
                        dim={fasterRun === 2}
                      />
                      <RunCell
                        time={r.run2Time}
                        penalty={r.run2Penalty}
                        strikePenalty={showPenaltyStrike}
                        highlight={fasterRun === 2}
                        dim={fasterRun === 1}
                      />
                      {mode === "official" && (
                        <td className="px-2 py-2 text-right tabular-nums">{r.totalPenalty ?? "—"}</td>
                      )}
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">
                        {formatSeconds(value)}
                      </td>
                      {timeMode && (
                        <td
                          className={cn(
                            "px-2 py-2 text-right tabular-nums",
                            d === null || Math.abs(d) < 0.0005
                              ? "text-[var(--color-muted)]"
                              : d < 0
                                ? "text-[var(--color-rank-green)]"
                                : "text-[var(--color-pending)]",
                          )}
                        >
                          {formatDiff(d)}
                        </td>
                      )}
                    </>
                  )}
                  {mode === "official" ? (
                    <td className="px-2 py-2 text-right tabular-nums">
                      {r.points ?? "—"}
                      {factor !== 1 && r.points !== null && (
                        <span className="ml-1 text-xs text-[var(--color-accent)]">
                          → {formatFactored(r.points, factor)}
                        </span>
                      )}
                    </td>
                  ) : (
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">
                      {r.position ?? "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {warningCount > 0 && (
        <p className="flex items-start gap-1 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-pending)]" />
          Hinweise aus der Plausibilitätsprüfung ({warningCount}) — die Liste wurde unverändert
          übernommen, Details beim Fahrer per Mouseover.
        </p>
      )}
    </div>
  );
}

function formatFactored(points: number, factor: number): string {
  const v = points * factor;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
}

function RunCell({
  time,
  penalty,
  strikePenalty,
  highlight,
  dim,
}: {
  time: number | null;
  penalty: number;
  strikePenalty: boolean;
  highlight: boolean;
  dim: boolean;
}) {
  if (time === null) {
    return <td className="px-2 py-2 text-right text-[var(--color-muted)]">—</td>;
  }
  return (
    <td
      className={cn(
        "px-2 py-2 text-right whitespace-nowrap tabular-nums",
        highlight && "font-semibold text-[var(--color-fastest-overall-fg)]",
        dim && "text-[var(--color-muted)]",
      )}
    >
      {formatSeconds(time)}
      {penalty > 0 && (
        <span
          className={cn(
            "ml-1 text-xs text-[var(--color-pending)]",
            strikePenalty && "line-through opacity-60",
          )}
          title={strikePenalty ? "Strafsekunden werden in dieser Ansicht ignoriert" : undefined}
        >
          +{penalty}
        </span>
      )}
    </td>
  );
}

function PenaltyCell({ n }: { n: number }) {
  return (
    <td className={cn("px-2 py-2 text-right tabular-nums", n === 0 && "text-[var(--color-muted)]")}>
      {n}
    </td>
  );
}
