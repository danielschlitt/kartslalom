import {
  dkmSpots,
  qualifiesForDkm,
  type Endlauf26Championship,
  type Endlauf26Row,
  type EndlaufEventInfo,
  type ScoreCell,
} from "@/lib/endlauf26/ranking";
import { formatFactor, formatPoints } from "@/lib/endlauf26/format";
import { GermanFlag } from "@/components/endlauf26/german-flag";
import { Movement } from "@/components/endlauf26/movement";
import {
  stickyBodyBg,
  stickyDriverClass,
  stickyRankClass,
} from "@/components/sticky-table-cols";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import { cn } from "@/lib/utils";

const SHARED_RANK_BG = "rgba(250, 204, 21, 0.18)"; // yellow = same place
const SHARED_RANK_FG = "#fde047";

export function EndlaufChampionshipTable({
  championship,
  rows,
  events,
  ageClassName,
  driverHref,
}: {
  championship: Endlauf26Championship;
  rows: Endlauf26Row[];
  events: EndlaufEventInfo[];
  ageClassName: string;
  driverHref?: (driverId: number) => string;
}) {
  const scoreKeys = rows[0]?.cells.map((c) => ({
    key: c.key,
    label: c.label,
    factor: c.factor,
    kind: c.kind,
  })) ?? [];
  const groupLabel = championship === "hmj" ? "Verband" : "Region";
  const ageClass = rows[0]?.ageClass ?? null;
  const spots = ageClass === null ? 0 : dkmSpots(championship, ageClass);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName}
        </h3>
        <span className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
          {spots > 0 && (
            <span className="inline-flex items-center gap-1" title="Startplätze bei der Deutschen Kartslalom Meisterschaft der dmsj">
              <GermanFlag /> {spots} DKM-Plätze
            </span>
          )}
          <span>{rows.length} Fahrer</span>
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
              <th className="px-2 py-2 text-left">{groupLabel}</th>
              <th className="px-3 py-2 text-right">Punkte</th>
              {scoreKeys.map((s) => (
                <th
                  key={s.key}
                  className={cn(
                    "px-2 py-2 text-right whitespace-nowrap",
                    s.kind === "endlauf" && "text-[var(--color-accent)]",
                  )}
                  title={s.factor !== 1 ? `Faktor ${formatFactor(s.factor)}` : undefined}
                >
                  {s.label}
                  {s.factor !== 1 && (
                    <span className="ml-1 font-normal normal-case opacity-70">
                      {formatFactor(s.factor)}
                    </span>
                  )}
                </th>
              ))}
              <th className="px-2 py-2 text-right whitespace-nowrap border-l border-[var(--color-border)]">
                Vor Endlauf
              </th>
              {events.map((e) => (
                <th key={e.eventId} className="px-2 py-2 text-right whitespace-nowrap">
                  nach {e.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6 + scoreKeys.length + events.length}
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
                  className={cn(
                    "border-b border-[var(--color-border)]/50 last:border-0",
                    r.excluded && "opacity-50",
                  )}
                  style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td
                    className={cn("px-3 py-2", stickyRankClass(), !isHome && "max-md:bg-[var(--color-surface)]")}
                    style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                  >
                    <RankCell
                      rank={r.rank}
                      shared={r.sharedRank}
                      excluded={r.excluded}
                      isHome={isHome}
                      dkm={!r.excluded && qualifiesForDkm(championship, r.ageClass, r.rank)}
                    />
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 font-medium",
                      stickyDriverClass(),
                      !isHome && "max-md:bg-[var(--color-surface)]",
                    )}
                    style={stickyBodyBg(isHome, HOME_TEAM_BG)}
                  >
                    {driverHref ? (
                      <a href={driverHref(r.driverId)} className="hover:underline">
                        {r.lastName} {r.firstName}
                      </a>
                    ) : (
                      <>
                        {r.lastName} {r.firstName}
                      </>
                    )}
                    {r.withdrawn ? (
                      <span
                        className="ml-2 rounded-sm bg-[var(--color-live)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-live)] uppercase"
                        title="Abgemeldet — tritt bei den Endläufen nicht an, nicht gewertet"
                      >
                        abgemeldet
                      </span>
                    ) : r.excluded ? (
                      <span
                        className="ml-2 rounded-sm bg-[var(--color-live)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-live)] uppercase"
                        title="Nicht alle Endläufe bestritten — nicht gewertet"
                      >
                        n. g.
                      </span>
                    ) : null}
                    {r.nominated && (
                      <span
                        className="ml-2 rounded-sm bg-[var(--color-accent)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase"
                        title="Nachrücker — war in der Liste nicht grün markiert, startet aber bei den Endläufen"
                      >
                        Nachrücker
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{r.teamName}</td>
                  <td className="px-2 py-2 text-[var(--color-muted)]">
                    {championship === "hmj" ? r.verband : r.region}
                  </td>
                  <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                    {formatPoints(r.totalPoints)}
                  </td>
                  {r.cells.map((c) => (
                    <ScoreCellView key={c.key} cell={c} />
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums border-l border-[var(--color-border)]">
                    {r.rankBefore ?? "—"}
                  </td>
                  {r.movement.map((m) => (
                    <td key={m.eventId} className="px-2 py-2 text-right">
                      <Movement delta={m.delta} />
                    </td>
                  ))}
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

function RankCell({
  rank,
  shared,
  excluded,
  isHome,
  dkm = false,
}: {
  rank: number | null;
  shared: boolean;
  excluded: boolean;
  isHome: boolean;
  /** Position qualifies for the national finals (DKM der dmsj) → small German flag. */
  dkm?: boolean;
}) {
  if (excluded || rank === null) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs text-[var(--color-muted)]">
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "relative inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold tabular-nums",
        isHome && !shared && "bg-[var(--color-rank-blue)] text-white",
      )}
      style={
        shared
          ? { backgroundColor: SHARED_RANK_BG, color: SHARED_RANK_FG }
          : undefined
      }
      title={shared ? "Punktgleich — gleicher Platz" : undefined}
    >
      {rank}.
      {dkm && (
        <GermanFlag className="absolute -top-1 -right-1.5 h-2 w-3 shadow-[0_0_0_1px_var(--color-surface)]" />
      )}
    </span>
  );
}

function ScoreCellView({ cell }: { cell: ScoreCell }) {
  if (!cell.available) {
    return (
      <td className="px-2 py-2 text-right text-[var(--color-muted)]">—</td>
    );
  }
  if (!cell.started) {
    return (
      <td
        className={cn(
          "px-2 py-2 text-right text-[var(--color-muted)] tabular-nums",
          cell.dropped && "line-through opacity-60",
        )}
        title={cell.dropped ? "Streichresultat (nicht gestartet)" : "nicht gestartet"}
      >
        0
      </td>
    );
  }
  return (
    <td
      className={cn(
        "px-2 py-2 text-right whitespace-nowrap tabular-nums",
        cell.dropped && "text-[var(--color-muted)] line-through opacity-60",
      )}
      title={
        cell.dropped
          ? `Streichresultat · Platz ${cell.position} · ${formatPoints(cell.points)} Punkte`
          : cell.factor !== 1
            ? `Platz ${cell.position} · ${cell.basePoints} × ${cell.factor} = ${formatPoints(cell.points)}`
            : `Platz ${cell.position}`
      }
    >
      <span className="text-xs text-[var(--color-muted)]">{cell.position}.</span>{" "}
      <span className="font-medium">{formatPoints(cell.points)}</span>
    </td>
  );
}
