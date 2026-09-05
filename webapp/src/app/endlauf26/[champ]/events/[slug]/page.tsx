import Link from "next/link";
import { notFound } from "next/navigation";
import { Settings } from "lucide-react";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { EventStatusBadge } from "@/components/endlauf26/event-status-badge";
import { LiveBoard } from "@/components/endlauf26/live-board";
import {
  getEndlaufEntriesForEvent,
  getEndlaufEventBySlug,
  getFinalizedClasses,
} from "@/lib/dal/endlauf26";
import { formatFactor } from "@/lib/endlauf26/format";
import {
  ageClassName,
  championshipFromSlug,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { formatDateDe } from "@/lib/utils";

export const dynamic = "force-dynamic";

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

  const [entries, finalized] = await Promise.all([
    getEndlaufEntriesForEvent(event.id),
    getFinalizedClasses(event.id),
  ]);
  const classes = [...new Set(entries.map((e) => e.ageClass))].sort((a, b) => a - b);
  const base = `/endlauf26/${ENDLAUF26_SLUGS[championship]}`;

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="events"
        title={`Endlauf ${event.number}: ${event.name}`}
        subtitle={[
          event.eventDate ? formatDateDe(event.eventDate) : null,
          event.factor !== 1 ? `Punkte ${formatFactor(event.factor)}` : null,
          `${finalized.size}/${classes.length} Klassen gewertet`,
        ]
          .filter(Boolean)
          .join(" · ")}
        isLive={event.status === "live"}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <EventStatusBadge status={event.status} />
        {event.status === "live" && (
          <Link href={`${base}/live`} className="text-[var(--color-live)] hover:underline">
            Live-Ansicht →
          </Link>
        )}
        <Link
          href={`${base}/admin/events/${event.slug}`}
          className="inline-flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <Settings className="h-3.5 w-3.5" /> Zeiten erfassen
        </Link>
      </div>

      {classes.map((c) => (
        <LiveBoard
          key={c}
          ageClassName={ageClassName(c)}
          entries={entries.filter((e) => e.ageClass === c)}
          liveEntryId={event.liveAgeClass === c ? event.liveEntryId : null}
          finalized={finalized.has(c)}
          showPoints
        />
      ))}
    </div>
  );
}
