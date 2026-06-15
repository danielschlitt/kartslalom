import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { ChampionshipTable } from "@/components/championship-table";
import { seriesSubtitle } from "@/components/championship-subtitle";
import { DropsToggle, parseApplyDrops } from "@/components/drops-toggle";
import { SeriesTabs, type SeriesParam } from "@/components/series-tabs";
import {
  getAllAgeClasses,
  getChampionshipDrivers,
  seriesRaceNumbers,
} from "@/lib/dal/races";
import { computeChampionship } from "@/lib/ranking";

export const dynamic = "force-dynamic";

export default async function ChampionshipClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    series?: string;
    drops?: string;
  }>;
}) {
  const { id } = await params;
  const classId = Number(id);
  if (!Number.isFinite(classId)) notFound();

  const sp = await searchParams;
  const series: SeriesParam = sp.series === "hmj" ? "hmj" : "hts";
  const applyDrops = parseApplyDrops(sp);
  const raceNumbers = seriesRaceNumbers(series);
  const basePath = `/championship/class/${classId}`;

  const [allClasses, drivers] = await Promise.all([
    getAllAgeClasses(),
    getChampionshipDrivers(),
  ]);

  const ageClass = allClasses.find((c) => c.id === classId);
  if (!ageClass) notFound();

  const rows = computeChampionship(drivers, {
    series,
    seriesRaceNumbers: raceNumbers,
    applyDrops,
  }).filter((r) => r.ageClassId === classId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/championship"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Alle Klassen
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Meisterschaft {ageClass.name}
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            {seriesSubtitle(series, applyDrops)}
          </p>
        </div>
        <SeriesTabs
          active={series}
          basePath={basePath}
          searchParams={{ drops: sp.drops }}
        />
      </div>

      <DropsToggle
        basePath={basePath}
        searchParams={{ series, drops: sp.drops }}
        applyDrops={applyDrops}
      />

      <p className="text-xs text-[var(--color-muted)]">
        {applyDrops ? (
          <>
            Streichresultate sind{" "}
            <span className="line-through">durchgestrichen</span>. Nur
            finalisierte Altersklassen werden für Streichergebnisse
            herangezogen.
          </>
        ) : (
          <>Streichergebnisse sind ausgeschaltet — alle Rennen zählen voll.</>
        )}
      </p>

      <ChampionshipTable
        ageClassName={ageClass.name}
        rows={rows}
        raceNumbers={raceNumbers}
      />
    </div>
  );
}
