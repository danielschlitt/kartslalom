import Link from "next/link";
import { notFound } from "next/navigation";
import { Settings, Zap } from "lucide-react";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { ClassResults } from "@/components/endlauf26/class-results.client";
import { EventStatusBadge } from "@/components/endlauf26/event-status-badge";
import type { StartGridData } from "@/components/endlauf26/start-grid";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getEndlaufEntriesForEvent,
  getEndlaufEventBySlug,
  getEndlaufEvents,
  getEndlaufResults,
  getResultImages,
  getStartLists,
} from "@/lib/dal/endlauf26";
import { formatFactor } from "@/lib/endlauf26/format";
import {
  ageClassName,
  championshipFromSlug,
  ENDLAUF26_AGE_CLASSES,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { startOrderBaseLabel } from "@/lib/endlauf26/start-order";
import { formatDateDe } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Public results of one Endlauf: the imported official result list per age
 * class (source of truth) with the alternative scorings on top. Classes
 * without a result list show their start grid instead. Live timing lives on
 * its own page and is only linked while the event is live.
 */
export default async function EndlaufEventPage({
  params,
}: {
  params: Promise<{ champ: string; slug: string }>;
}) {
  const { champ, slug } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();
  const event = await getEndlaufEventBySlug(championship, slug);
  if (!event) notFound();

  const [results, images, entries, startLists, events, isAdmin] = await Promise.all([
    getEndlaufResults(event.id),
    getResultImages(event.id),
    getEndlaufEntriesForEvent(event.id),
    getStartLists(event.id),
    getEndlaufEvents(championship),
    isAdminSession(),
  ]);
  const scoredClasses = new Set(results.map((r) => r.ageClass));
  const base = `/endlauf26/${ENDLAUF26_SLUGS[championship]}`;
  const adminHref = `${base}/admin/events/${event.slug}`;
  const baseLabel = startOrderBaseLabel(championship, event, events);

  const startGridFor = (ageClass: number): StartGridData => {
    const classImages = startLists.filter((s) => s.ageClass === ageClass);
    return {
      rows: entries
        .filter((e) => e.ageClass === ageClass)
        .map((e) => ({
          driverId: e.driverId,
          firstName: e.firstName,
          lastName: e.lastName,
          teamName: e.teamName,
          startingOrder: e.startingOrder,
          nominated: e.nominated,
        })),
      images: classImages,
      sourceLabel: classImages.length > 0 ? "laut ausgehängter Startliste" : baseLabel,
    };
  };

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="events"
        title={`Endlauf ${event.number}: ${event.name}`}
        subtitle={[
          event.eventDate ? formatDateDe(event.eventDate) : null,
          event.factor !== 1 ? `Punkte ${formatFactor(event.factor)}` : null,
          `${scoredClasses.size}/${ENDLAUF26_AGE_CLASSES.length} Klassen gewertet`,
        ]
          .filter(Boolean)
          .join(" · ")}
        isLive={event.status === "live"}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <EventStatusBadge status={event.status} />
        {event.status === "live" && (
          <Link
            href={`${base}/live`}
            className="inline-flex items-center gap-1 text-[var(--color-live)] hover:underline"
          >
            <Zap className="h-3.5 w-3.5 animate-pulse" /> Live-Timing →
          </Link>
        )}
        {isAdmin && (
          <Link
            href={adminHref}
            className="inline-flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <Settings className="h-3.5 w-3.5" /> Ergebnislisten / Startlisten einlesen
          </Link>
        )}
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        Platz und Punkte stammen aus der fotografierten offiziellen Ergebnisliste je Klasse. Die
        Ansichten „Nur schnellste Runde“ (ohne und mit Fehlern), „Ohne Fehler“ und „Nur Fehler“ sind Was-wäre-wenn-Wertungen
        und ändern nichts an der offiziellen Reihenfolge. Klassen ohne Ergebnisliste zeigen ihre
        Startaufstellung ({baseLabel}; vor Ort ausgehängte Startlisten gehen vor).
      </p>

      {ENDLAUF26_AGE_CLASSES.map((c) => (
        <ClassResults
          key={c}
          ageClassName={ageClassName(c)}
          rows={results.filter((r) => r.ageClass === c)}
          images={images.filter((im) => im.ageClass === c)}
          factor={event.factor}
          driverBasePath={`${base}/driver`}
          isAdmin={isAdmin}
          adminHref={adminHref}
          startGrid={startGridFor(c)}
        />
      ))}
    </div>
  );
}
