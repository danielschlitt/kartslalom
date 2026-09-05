import { Zap } from "lucide-react";
import type { EndlaufEntry } from "@/lib/dal/endlauf26";
import { bestRunTotal, type EndlaufRunValue } from "@/lib/endlauf26/ranking";
import { formatSeconds } from "@/lib/endlauf26/format";
import {
  stickyBodyBg,
  stickyDriverClass,
  stickyRankClass,
} from "@/components/sticky-table-cols";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import { cn } from "@/lib/utils";

/**
 * Read-only live timing board for one age class. Sorted by live position
 * (drivers without a time follow in starting order). Highlights the driver
 * currently on track.
 */
export function LiveBoard({
  entries,
  liveEntryId,
  ageClassName,
  finalized,
  showPoints,
}: {
  entries: EndlaufEntry[];
  liveEntryId: number | null;
  ageClassName: string;
  finalized?: boolean;
  showPoints?: boolean;
}) {
  const sorted = [...entries].sort((a, b) => {
    const ap = a.positionLive ?? Number.MAX_SAFE_INTEGER;
    const bp = b.positionLive ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.lastName.localeCompare(b.lastName, "de");
  });

  const bestOverall = sorted.reduce<number | null>((best, e) => {
    const v = bestRunTotal(e.runs);
    if (v === null) return best;
    return best === null ? v : Math.min(best, v);
  }, null);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName}
          {finalized && <span className="ml-2 normal-case tracking-normal">· finalisiert</span>}
        </h3>
        <span className="text-xs text-[var(--color-muted)]">{entries.length} Fahrer</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className={cn("px-3 py-2 text-left", stickyRankClass({ header: true }))}>Pos</th>
              <th className={cn("px-3 py-2 text-left", stickyDriverClass({ header: true }))}>Fahrer</th>
              <th className="px-3 py-2 text-left">Verein</th>
              <th className="px-2 py-2 text-right">Start</th>
              <th className="px-2 py-2 text-right">Training</th>
              <th className="px-2 py-2 text-right">Lauf 1</th>
              <th className="px-2 py-2 text-right">Pos L1</th>
              <th className="px-2 py-2 text-right">Lauf 2</th>
              <th className="px-2 py-2 text-right">Pos L2</th>
              <th className="px-2 py-2 text-right">Bester</th>
              {showPoints && <th className="px-2 py-2 text-right">Punkte</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const isCurrent = liveEntryId === e.entryId;
              // Own club is blue — but the "on track" highlight takes precedence.
              const isHome = e.teamName === HOME_TEAM && !isCurrent;
              const best = bestRunTotal(e.runs);
              return (
                <tr
                  key={e.entryId}
                  className={cn(
                    "border-b border-[var(--color-border)]/50 last:border-0",
                    isCurrent && "bg-[var(--color-live)]/15",
                  )}
                  style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td
                    className={cn("px-3 py-2", stickyRankClass(), !isHome && "max-md:bg-[var(--color-surface)]")}
                    style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                  >
                    <span
                      className={cn(
                        "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums",
                        isHome && "bg-[var(--color-rank-blue)] text-white",
                        e.positionLive === 1 && "bg-[var(--color-rank-green)] text-white",
                        e.positionLive === null && "text-[var(--color-muted)]",
                      )}
                      title={finalized && best === null ? "nicht gestartet" : undefined}
                    >
                      {finalized
                        ? (e.finishPosition ?? (best === null ? "n. g." : "—"))
                        : (e.positionLive ?? "—")}
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
                    <span className="inline-flex items-center gap-1.5">
                      {isCurrent && (
                        <Zap className="h-3.5 w-3.5 animate-pulse text-[var(--color-live)]" />
                      )}
                      {e.lastName} {e.firstName}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{e.teamName}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">
                    {e.startingOrder ?? "—"}
                  </td>
                  <RunCell run={e.runs.test} muted />
                  <RunCell run={e.runs.first} isBest={best !== null && runTotal(e.runs.first) === bestOverall} />
                  <td className="px-2 py-2 text-right tabular-nums">{e.positionRun1 ?? "—"}</td>
                  <RunCell run={e.runs.second} isBest={best !== null && runTotal(e.runs.second) === bestOverall} />
                  <td className="px-2 py-2 text-right tabular-nums">{e.positionRun2 ?? "—"}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">
                    {formatSeconds(best)}
                  </td>
                  {showPoints && (
                    <td className="px-2 py-2 text-right tabular-nums">
                      {finalized ? e.pointsAwarded : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function runTotal(r: EndlaufRunValue | null): number | null {
  if (!r || r.timeSeconds === null) return null;
  return r.timeSeconds + r.penaltySeconds;
}

function RunCell({
  run,
  muted,
  isBest,
}: {
  run: EndlaufRunValue | null;
  muted?: boolean;
  isBest?: boolean;
}) {
  if (!run || run.timeSeconds === null) {
    return <td className="px-2 py-2 text-right text-[var(--color-muted)]">—</td>;
  }
  return (
    <td
      className={cn(
        "px-2 py-2 text-right whitespace-nowrap tabular-nums",
        muted && "text-[var(--color-muted)]",
        isBest && "text-[var(--color-fastest-overall-fg)]",
      )}
    >
      {formatSeconds(run.timeSeconds)}
      {run.penaltySeconds > 0 && (
        <span className="ml-1 text-xs text-[var(--color-pending)]">+{run.penaltySeconds}</span>
      )}
    </td>
  );
}
