import Link from "next/link";

import type { ChampionshipRow } from "@/lib/ranking";
import { RankBadge } from "@/components/rank-badge";
import {
  stickyBodyBg,
  stickyDriverClass,
  stickyRankClass,
} from "@/components/sticky-table-cols";
import { cn } from "@/lib/utils";

/** Local team — its drivers get a tinted row to stand out. */
const HOME_TEAM = "OAMC Reinheim";
const HOME_TEAM_BG = "#082e3f";

export function ChampionshipTable({
  rows,
  raceNumbers,
  ageClassName,
}: {
  rows: ChampionshipRow[];
  raceNumbers: number[];
  ageClassName: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName}
        </h3>
        <span className="text-xs text-[var(--color-muted)]">
          {rows.length} Fahrer
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className={cn("px-3 py-2 text-left", stickyRankClass({ header: true }))}>
                #
              </th>
              <th className={cn("px-3 py-2 text-left", stickyDriverClass({ header: true }))}>
                Fahrer
              </th>
              <th className="px-3 py-2 text-left">Verein</th>
              <th className="px-3 py-2 text-right">Punkte</th>
              <th className="px-3 py-2 text-right">Starts</th>
              <th className="px-3 py-2 text-right">Strafsek.</th>
              {raceNumbers.map((n) => (
                <th key={n} className="px-2 py-2 text-right tabular-nums">
                  R{n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6 + raceNumbers.length}
                  className="px-3 py-6 text-center text-[var(--color-muted)]"
                >
                  Keine Fahrer in dieser Klasse.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isHome = r.teamName === HOME_TEAM;
                return (
                <tr
                  key={r.driverId}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                  style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td
                    className={cn("px-3 py-2", stickyRankClass(), !isHome && "max-md:bg-[var(--color-surface)]")}
                    style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                  >
                    <RankBadge rank={r.rank} isHomeTeam={isHome} />
                  </td>
                  <td
                    className={cn("px-3 py-2 font-medium", stickyDriverClass(), !isHome && "max-md:bg-[var(--color-surface)]")}
                    style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                  >
                    <Link
                      href={`/driver/${r.driverId}`}
                      className="hover:underline"
                    >
                      {r.lastName} {r.firstName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {r.teamName}
                  </td>
                  <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                    {r.totalPoints}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.startedRaces}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
                    {r.totalPenaltySeconds}
                  </td>
                  {raceNumbers.map((n) => {
                    const pts = r.perRace[n] ?? 0;
                    const dropped = r.droppedRaceNumbers.includes(n);
                    return (
                      <td
                        key={n}
                        className={cn(
                          "px-2 py-2 text-right tabular-nums",
                          dropped &&
                            "text-[var(--color-muted)] line-through opacity-60",
                          !dropped && pts === 0 && "text-[var(--color-muted)]",
                        )}
                        title={dropped ? "Streichresultat" : undefined}
                      >
                        {pts}
                      </td>
                    );
                  })}
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
