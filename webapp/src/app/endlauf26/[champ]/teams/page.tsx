import { notFound } from "next/navigation";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { getEndlaufChampionship, getLiveEndlaufEvent } from "@/lib/dal/endlauf26";
import { formatPoints } from "@/lib/endlauf26/format";
import {
  ageClassName,
  championshipFromSlug,
  computeClubStats,
} from "@/lib/endlauf26/ranking";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EndlaufTeamsPage({
  params,
}: {
  params: Promise<{ champ: string }>;
}) {
  const { champ } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();

  const [data, liveEvent] = await Promise.all([
    getEndlaufChampionship(championship),
    getLiveEndlaufEvent(championship),
  ]);
  const stats = computeClubStats(data.rows);
  const byAvg = [...stats].sort((a, b) => b.avgPoints - a.avgPoints);

  // Drivers per class per team for the detail table
  const classes = [...new Set(data.rows.map((r) => r.ageClass))].sort((a, b) => a - b);
  const perClass = new Map<number, Map<number, number>>();
  for (const r of data.rows) {
    const m = perClass.get(r.teamId) ?? new Map<number, number>();
    m.set(r.ageClass, (m.get(r.ageClass) ?? 0) + 1);
    perClass.set(r.teamId, m);
  }

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="teams"
        title="Vereinswertung"
        subtitle="Summe der Meisterschaftspunkte aller Fahrer eines Vereins (inkl. Endlauf-Faktoren und Streichresultaten)"
        isLive={!!liveEvent}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StatsTable
          title="Gesamtpunkte"
          rows={stats}
          value={(s) => formatPoints(s.totalPoints)}
          classes={classes}
          perClass={perClass}
        />
        <StatsTable
          title="Punkte pro Fahrer (Ø)"
          rows={byAvg}
          value={(s) => formatPoints(s.avgPoints)}
          classes={classes}
          perClass={perClass}
        />
      </div>
    </div>
  );
}

function StatsTable({
  title,
  rows,
  value,
  classes,
  perClass,
}: {
  title: string;
  rows: ReturnType<typeof computeClubStats>;
  value: (s: ReturnType<typeof computeClubStats>[number]) => string;
  classes: number[];
  perClass: Map<number, Map<number, number>>;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {title}
        </h3>
        <span className="text-xs text-[var(--color-muted)]">{rows.length} Vereine</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Verein</th>
              <th className="px-3 py-2 text-right">{title === "Gesamtpunkte" ? "Punkte" : "Ø"}</th>
              <th className="px-2 py-2 text-right">Fahrer</th>
              <th className="px-2 py-2 text-right" title="Fahrer auf Platz 1 ihrer Klasse">Führende</th>
              <th className="px-2 py-2 text-right" title="Endlauf-Siege">Siege</th>
              <th className="px-2 py-2 text-right" title="Endlauf-Podien">Podien</th>
              <th className="px-2 py-2 text-right" title="Punkte aus den Endläufen">Endlauf-Pkt.</th>
              {classes.map((c) => (
                <th key={c} className="px-2 py-2 text-right" title={ageClassName(c)}>
                  K{c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const isHome = s.teamName === HOME_TEAM;
              return (
                <tr
                  key={s.teamId}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                  style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td className="px-3 py-2 tabular-nums">{i + 1}.</td>
                  <td className={cn("px-3 py-2 font-medium", isHome && "text-white")}>
                    {s.teamName}
                  </td>
                  <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                    {value(s)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.driverCount}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.classLeaders || "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.endlaufWins || "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.endlaufPodiums || "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">
                    {s.endlaufPoints ? formatPoints(s.endlaufPoints) : "—"}
                  </td>
                  {classes.map((c) => (
                    <td key={c} className="px-2 py-2 text-right tabular-nums text-[var(--color-muted)]">
                      {perClass.get(s.teamId)?.get(c) ?? "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
