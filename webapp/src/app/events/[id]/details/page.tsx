import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  EventAnalysisFilterBar,
  parseAnalysisView,
} from "@/components/filter-bar";
import { StandingsTable } from "@/components/standings-table";
import {
  getAllAgeClasses,
  getEnrichedEntriesForEvent,
  getPointsScale,
  getRaceEvent,
} from "@/lib/dal/races";
import {
  computeHighlights,
  rankRaceEntries,
  type RankedEntry,
} from "@/lib/ranking";
import type { EnrichedEntry } from "@/lib/dal/races";
import { formatDateDe } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RaceEventDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    ageClassId?: string;
    metric?: string;
    penalty?: string;
  }>;
}) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  const sp = await searchParams;
  const requestedAgeClassId = sp.ageClassId ? Number(sp.ageClassId) : null;
  const view = parseAnalysisView(sp);

  const event = await getRaceEvent(eventId);
  if (!event) notFound();

  const [entries, pointsScale, allAgeClasses] = await Promise.all([
    getEnrichedEntriesForEvent(eventId),
    getPointsScale(),
    getAllAgeClasses(),
  ]);

  // Restrict to age classes that actually have entries in this event so the
  // selector never offers an empty class.
  const presentAgeClassIds = new Set(entries.map((e) => e.ageClassId));
  const ageClassOptions = allAgeClasses.filter((c) =>
    presentAgeClassIds.has(c.id),
  );

  const ageClassId =
    requestedAgeClassId && presentAgeClassIds.has(requestedAgeClassId)
      ? requestedAgeClassId
      : (ageClassOptions[0]?.id ?? null);

  if (ageClassId === null) {
    return (
      <DetailsShell
        eventId={eventId}
        eventNumber={event.number}
        eventName={event.name}
        eventDate={event.eventDate}
      >
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-muted)]">
          Für dieses Rennen sind noch keine Fahrer eingetragen.
        </p>
      </DetailsShell>
    );
  }

  const ageClass = ageClassOptions.find((c) => c.id === ageClassId)!;
  const classEntries = entries.filter((e) => e.ageClassId === ageClassId);
  const ranked = rankRaceEntries(classEntries, pointsScale, view);
  const highlights = computeHighlights(classEntries);

  const display: RankedEntry<EnrichedEntry>[] = ranked.sort((a, b) => {
    const ap = a.finishPosition ?? Number.MAX_SAFE_INTEGER;
    const bp = b.finishPosition ?? Number.MAX_SAFE_INTEGER;
    return ap - bp;
  });

  const basePath = `/events/${eventId}/details`;
  const filterSearchParams: Record<string, string | undefined> = {
    ageClassId: String(ageClassId),
    metric: sp.metric,
    penalty: sp.penalty,
  };

  return (
    <DetailsShell
      eventId={eventId}
      eventNumber={event.number}
      eventName={event.name}
      eventDate={event.eventDate}
    >
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <h2 className="text-lg font-semibold">
          Analyse {ageClass.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          {ageClassOptions.map((c) => {
            const sp2 = new URLSearchParams();
            sp2.set("ageClassId", String(c.id));
            if (sp.metric) sp2.set("metric", sp.metric);
            if (sp.penalty) sp2.set("penalty", sp.penalty);
            const active = c.id === ageClassId;
            return (
              <Link
                key={c.id}
                href={`${basePath}?${sp2.toString()}`}
                className={
                  active
                    ? "rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs text-[var(--color-accent-foreground)]"
                    : "rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                }
              >
                {c.name}
              </Link>
            );
          })}
        </div>
      </div>

      <EventAnalysisFilterBar
        basePath={basePath}
        searchParams={filterSearchParams}
        metric={view.metric}
        penaltyMode={view.penaltyMode}
      />

      <p className="text-xs text-[var(--color-muted)]">
        Diese Auswertung ist eine Was-wäre-wenn-Ansicht. Die offiziellen
        Meisterschaftspunkte ändern sich dadurch nicht.
      </p>

      <StandingsTable
        ageClassName={ageClass.name}
        ranked={display}
        highlights={highlights}
        showTestRun
      />
    </DetailsShell>
  );
}

function DetailsShell({
  eventId,
  eventNumber,
  eventName,
  eventDate,
  children,
}: {
  eventId: number;
  eventNumber: number;
  eventName: string;
  eventDate: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/events/${eventId}`}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Zurück zum Rennen
        </Link>
      </div>
      <div>
        <div className="text-sm text-[var(--color-muted)]">
          R{eventNumber} · {formatDateDe(eventDate)}
        </div>
        <h1 className="text-2xl font-semibold">{eventName}</h1>
      </div>
      {children}
    </div>
  );
}
