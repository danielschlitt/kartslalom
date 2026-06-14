import { ChampionshipTable } from "@/components/championship-table";
import { seriesSubtitle } from "@/components/championship-subtitle";
import {
  FilterBar,
  parseApplyDrops,
  parseViewMode,
} from "@/components/filter-bar";
import { SeriesTabs, type SeriesParam } from "@/components/series-tabs";
import {
  getChampionshipDriversWithView,
  getCompletedRaceNumbers,
  seriesRaceNumbers,
} from "@/lib/dal/races";
import { computeChampionship } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export default async function ChampionshipPage({
  searchParams,
}: {
  searchParams: Promise<{
    series?: string;
    metric?: string;
    penalty?: string;
    drops?: string;
  }>;
}) {
  const sp = await searchParams;
  const series: SeriesParam = sp.series === "hmj" ? "hmj" : "hts";
  const view = parseViewMode(sp);
  const applyDrops = parseApplyDrops(sp);
  const raceNumbers = seriesRaceNumbers(series);

  const [drivers, completedRaceNumbers] = await Promise.all([
    getChampionshipDriversWithView(view),
    getCompletedRaceNumbers(),
  ]);
  const rows = computeChampionship(drivers, {
    series,
    seriesRaceNumbers: raceNumbers,
    completedRaceNumbers,
    applyDrops,
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
            {seriesSubtitle(series, applyDrops)}
          </p>
        </div>
        <SeriesTabs
          active={series}
          basePath="/championship"
          searchParams={{
            metric: sp.metric,
            penalty: sp.penalty,
            drops: sp.drops,
          }}
        />
      </div>

      <FilterBar
        basePath="/championship"
        searchParams={{
          series,
          metric: sp.metric,
          penalty: sp.penalty,
          drops: sp.drops,
        }}
        metric={view.metric}
        penaltyMode={view.penaltyMode}
        applyDrops={applyDrops}
      />

      <p className="text-xs text-[var(--color-muted)]">
        {applyDrops ? (
          <>
            Streichresultate sind{" "}
            <span className="line-through">durchgestrichen</span>. Nur beendete
            Rennen werden für Streichergebnisse herangezogen.
          </>
        ) : (
          <>Streichergebnisse sind ausgeschaltet — alle Rennen zählen voll.</>
        )}
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

