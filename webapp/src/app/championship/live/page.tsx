import Link from "next/link";
import { Zap } from "lucide-react";
import { ChampionshipTable } from "@/components/championship-table";
import { FilterBar, parseViewMode } from "@/components/filter-bar";
import { SeriesTabs, type SeriesParam } from "@/components/series-tabs";
import {
  getAllRaceEvents,
  getChampionshipDriversWithView,
  seriesRaceNumbers,
} from "@/lib/dal/races";
import { computeChampionship } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export default async function LiveChampionshipPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; metric?: string; penalty?: string }>;
}) {
  const sp = await searchParams;
  const series: SeriesParam = sp.series === "hmj" ? "hmj" : "hts";
  const view = parseViewMode(sp);
  const raceNumbers = seriesRaceNumbers(series);

  const [drivers, allEvents] = await Promise.all([
    getChampionshipDriversWithView(view),
    getAllRaceEvents(),
  ]);

  const liveEvent = allEvents.find((e) => e.status === "live");
  const rows = computeChampionship(drivers, {
    series,
    seriesRaceNumbers: raceNumbers,
  });

  const byClass = new Map<number, { name: string; rows: typeof rows }>();
  for (const r of rows) {
    let group = byClass.get(r.ageClassId);
    if (!group) {
      group = { name: r.ageClassName, rows: [] };
      byClass.set(r.ageClassId, group);
    }
    group.rows.push(r);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Live-Meisterschaft</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {liveEvent
              ? `Inkl. laufendem Rennen: ${liveEvent.name}`
              : "Aktuell kein laufendes Rennen — gleicher Stand wie Endwertung."}
          </p>
        </div>
        <SeriesTabs
          active={series}
          basePath="/championship/live"
          searchParams={{ metric: sp.metric, penalty: sp.penalty }}
        />
      </div>

      <FilterBar
        basePath="/championship/live"
        searchParams={{ series, metric: sp.metric, penalty: sp.penalty }}
        metric={view.metric}
        penaltyMode={view.penaltyMode}
      />

      {liveEvent && (
        <Link
          href={`/events/${liveEvent.id}`}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--color-live)]/40 bg-[var(--color-live)]/10 px-3 py-2 text-sm text-[var(--color-live)] hover:bg-[var(--color-live)]/15"
        >
          <Zap className="h-4 w-4 animate-pulse" />
          Live: {liveEvent.name} öffnen →
        </Link>
      )}

      <div className="space-y-6">
        {[...byClass.values()].map((g) => (
          <ChampionshipTable
            key={g.name}
            ageClassName={g.name}
            rows={g.rows}
            raceNumbers={raceNumbers}
          />
        ))}
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `setTimeout(() => location.reload(), 5000);`,
        }}
      />
    </div>
  );
}
