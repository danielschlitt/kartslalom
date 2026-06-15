import Link from "next/link";

import { RankBadge } from "@/components/rank-badge";
import { getTeamStandings, type TeamStandingsRow } from "@/lib/dal/teams";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const HOME_TEAM = "OAMC Reinheim";
const HOME_TEAM_BG = "#082e3f";

function formatAvg(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

export default async function TeamsPage() {
  const standings = await getTeamStandings();
  const byAverage = [...standings].sort((a, b) => a.avgRank - b.avgRank);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vereinswertung</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Hessen-Thüringen Süd · 8 Rennen · ohne Streichresultate
        </p>
      </div>

      <TeamStandingsTable
        title="Gesamtpunkte"
        rows={standings}
        rankKey="rank"
        pointsColumn={{ label: "Punkte", value: (row) => String(row.totalPoints) }}
      />

      <TeamStandingsTable
        title="Punkte pro Fahrer (Ø)"
        rows={byAverage}
        rankKey="avgRank"
        pointsColumn={{
          label: "Punkte/Fahrer (Ø)",
          value: (row) => formatAvg(row.avgPointsPerDriver),
        }}
      />
    </div>
  );
}

function TeamStandingsTable({
  title,
  rows,
  rankKey,
  pointsColumn,
}: {
  title: string;
  rows: TeamStandingsRow[];
  rankKey: "rank" | "avgRank";
  pointsColumn: { label: string; value: (row: TeamStandingsRow) => string };
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <h2 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {title}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Verein</th>
              <th className="px-3 py-2 text-right">Fahrer</th>
              <th className="px-3 py-2 text-right">Siege</th>
              <th className="px-3 py-2 text-right">{pointsColumn.label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-[var(--color-muted)]"
                >
                  Noch keine Wertungsdaten vorhanden.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isHome = row.teamName === HOME_TEAM;
                return (
                  <tr
                    key={row.teamId}
                    className="border-b border-[var(--color-border)]/50 last:border-0"
                    style={
                      isHome ? { backgroundColor: HOME_TEAM_BG } : undefined
                    }
                  >
                    <td className="px-3 py-2">
                      <RankBadge rank={row[rankKey]} isHomeTeam={isHome} />
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 font-medium",
                        isHome && "text-white",
                      )}
                    >
                      <Link
                        href={`/teams/${row.teamId}`}
                        className="hover:underline"
                      >
                        {row.teamName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.driverCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.wins}
                    </td>
                    <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                      {pointsColumn.value(row)}
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
