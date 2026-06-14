import { ChampionshipTable } from "@/components/championship-table";
import { FilterBar, parseViewMode } from "@/components/filter-bar";
import { SeriesTabs, type SeriesParam } from "@/components/series-tabs";
import {
  getChampionshipDriversWithView,
  seriesRaceNumbers,
} from "@/lib/dal/races";
import { computeChampionship } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export default async function ChampionshipPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; metric?: string; penalty?: string }>;
}) {
  const sp = await searchParams;
  const series: SeriesParam = sp.series === "hmj" ? "hmj" : "hts";
  const view = parseViewMode(sp);
  const raceNumbers = seriesRaceNumbers(series);

  const drivers = await getChampionshipDriversWithView(view);
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
          <h1 className="text-2xl font-semibold">Meisterschaftsstand</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {series === "hts"
              ? "Hessen-Thüringen Süd · 8 Rennen · 2 Streichresultate"
              : "HMJ · 5 Rennen · 1 Streichresultat"}
          </p>
        </div>
        <SeriesTabs
          active={series}
          basePath="/championship"
          searchParams={{ metric: sp.metric, penalty: sp.penalty }}
        />
      </div>

      <FilterBar
        basePath="/championship"
        searchParams={{ series, metric: sp.metric, penalty: sp.penalty }}
        metric={view.metric}
        penaltyMode={view.penaltyMode}
      />

      <p className="text-xs text-[var(--color-muted)]">
        Streichresultate sind <span className="line-through">durchgestrichen</span>.
        Virtuelle Wertungen werden für Rennen mit erfassten Laufzeiten neu
        berechnet — Rennen ohne Zeiten behalten ihre offiziellen Punkte.
      </p>

      <div className="space-y-6">
        {[...byClass.values()].map((g) => (
          <ChampionshipTable
            key={g.name}
            ageClassName={g.name}
            rows={g.rows}
            raceNumbers={raceNumbers}
          />
        ))}
        {byClass.size === 0 && (
          <p className="text-sm text-[var(--color-muted)]">
            Noch keine Wertungsdaten vorhanden.
          </p>
        )}
      </div>
    </div>
  );
}
