import { cn, formatTime } from "@/lib/utils";
import { RankBadge } from "@/components/rank-badge";
import { RunCells } from "@/components/run-cell";
import {
  stickyBodyBg,
  stickyDriverClass,
  stickyRankClass,
} from "@/components/sticky-table-cols";
import type {
  EntryHighlights,
  RankedEntry,
  RankableEntry,
} from "@/lib/ranking";
import type { EnrichedEntry } from "@/lib/dal/races";

const HOME_TEAM = "OAMC Reinheim";
const HOME_TEAM_BG = "#082e3f";

export function StandingsTable({
  ageClassName,
  ranked,
  highlights,
  showTestRun,
  showPoints = true,
}: {
  ageClassName: string;
  ranked: RankedEntry<EnrichedEntry>[];
  highlights: Map<number, EntryHighlights>;
  showTestRun?: boolean;
  /** Set to false on the live page so provisional standings never imply championship points. */
  showPoints?: boolean;
}) {
  const emptyColSpan =
    3 + (showPoints ? 1 : 0) + (showTestRun ? 3 : 0) + 3 + 3 + 1;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName}
        </h3>
        <span className="text-xs text-[var(--color-muted)]">
          {ranked.length} Fahrer
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th rowSpan={2} className={cn("px-3 py-2 text-left", stickyRankClass({ header: true }))}>
                #
              </th>
              <th rowSpan={2} className={cn("px-3 py-2 text-left", stickyDriverClass({ header: true }))}>
                Fahrer
              </th>
              <th rowSpan={2} className="px-3 py-2 text-left">Verein</th>
              {showPoints && (
                <th rowSpan={2} className="px-3 py-2 text-right">Punkte</th>
              )}
              {showTestRun && (
                <th colSpan={3} className="border-l border-[var(--color-border)] px-2 py-1 text-center">
                  Testlauf
                </th>
              )}
              <th colSpan={3} className="border-l border-[var(--color-border)] px-2 py-1 text-center">
                1. Wertungslauf
              </th>
              <th colSpan={3} className="border-l border-[var(--color-border)] px-2 py-1 text-center">
                2. Wertungslauf
              </th>
              <th rowSpan={2} className="border-l border-[var(--color-border)] px-3 py-2 text-right">
                Bestzeit
              </th>
            </tr>
            <tr className="border-b border-[var(--color-border)] text-[10px]">
              {showTestRun && <SubHeaders />}
              <SubHeaders />
              <SubHeaders />
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={emptyColSpan} className="px-3 py-6 text-center text-[var(--color-muted)]">
                  Keine Einträge.
                </td>
              </tr>
            ) : (
              ranked.map((r) => {
                const e = r.entry;
                const hl = highlights.get(e.entryId);
                const isExtra = e.driverType !== "championship";
                const isHome = e.teamName === HOME_TEAM;
                const bestTotal = bestTotalFor(e);
                return (
                  <tr
                    key={e.entryId}
                    className={cn(
                      "border-b border-[var(--color-border)]/50 last:border-0",
                      r.isPending && "opacity-60",
                    )}
                    style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                  >
                    <td
                      className={cn("px-3 py-1.5", stickyRankClass(), !isHome && "max-md:bg-[var(--color-surface)]")}
                      style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                    >
                      {r.finishPosition ? (
                        <RankBadge rank={r.finishPosition} isHomeTeam={isHome} />
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td
                      className={cn("px-3 py-1.5", stickyDriverClass(), !isHome && "max-md:bg-[var(--color-surface)]")}
                      style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                    >
                      <div className="font-medium">
                        {e.lastName} {e.firstName}
                        {isExtra && (
                          <span className="ml-2 rounded-sm bg-[var(--color-surface-2)] px-1 py-0.5 text-[10px] font-normal text-[var(--color-muted)] uppercase">
                            {e.driverType === "vorstarter" ? "Vorstarter" : "Gaststarter"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-muted)]">{e.teamName}</td>
                    {showPoints && (
                      <td className="px-3 py-1.5 text-right text-base font-semibold tabular-nums">
                        {r.pointsAwarded}
                      </td>
                    )}
                    {showTestRun && (
                      <RunCells run={e.runs.test} withSeparator />
                    )}
                    <RunCells run={e.runs.first} highlight={hl?.first} withSeparator />
                    <RunCells run={e.runs.second} highlight={hl?.second} withSeparator />
                    <td className="border-l border-[var(--color-border)]/40 px-3 py-1.5 text-right font-semibold tabular-nums">
                      {formatTime(bestTotal)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubHeaders() {
  return (
    <>
      <th className="border-l border-[var(--color-border)]/40 px-2 py-1 text-right">Zeit</th>
      <th className="px-2 py-1 text-right">Strafsek.</th>
      <th className="px-2 py-1 text-right">Gesamt</th>
    </>
  );
}

function bestTotalFor(e: RankableEntry): number | null {
  const a = e.runs.first;
  const b = e.runs.second;
  const ta = a?.timeSeconds === null || a?.timeSeconds === undefined ? null : a.timeSeconds + a.penaltySeconds;
  const tb = b?.timeSeconds === null || b?.timeSeconds === undefined ? null : b.timeSeconds + b.penaltySeconds;
  if (ta === null) return tb;
  if (tb === null) return ta;
  return Math.min(ta, tb);
}
