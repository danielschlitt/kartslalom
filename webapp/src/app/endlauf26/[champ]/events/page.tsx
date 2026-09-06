import Link from "next/link";
import { notFound } from "next/navigation";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { EventStatusBadge } from "@/components/endlauf26/event-status-badge";
import { getEndlaufEvents, getScoredClasses } from "@/lib/dal/endlauf26";
import { formatFactor } from "@/lib/endlauf26/format";
import { championshipFromSlug, ENDLAUF26_AGE_CLASSES, ENDLAUF26_SLUGS } from "@/lib/endlauf26/ranking";
import { cn, formatDateDe } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EndlaufEventsPage({
  params,
}: {
  params: Promise<{ champ: string }>;
}) {
  const { champ } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();
  const events = await getEndlaufEvents(championship);
  const scored = await Promise.all(events.map((e) => getScoredClasses(e.id)));
  const base = `/endlauf26/${ENDLAUF26_SLUGS[championship]}`;

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="events"
        isLive={events.some((e) => e.status === "live")}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e, i) => (
          <Link
            key={e.id}
            href={`${base}/events/${e.slug}`}
            className={cn(
              "rounded-lg border bg-[var(--color-surface)] p-4 transition-colors hover:bg-[var(--color-surface-2)]",
              e.status === "live" ? "border-[var(--color-live)]/60" : "border-[var(--color-border)]",
            )}
          >
            <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
              <span>
                Endlauf {e.number}
                {e.eventDate ? ` · ${formatDateDe(e.eventDate)}` : ""}
              </span>
              <EventStatusBadge status={e.status} />
            </div>
            <div className="mt-1 text-lg font-semibold">{e.name}</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {e.factor !== 1 && (
                <span className="rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[var(--color-accent)]">
                  Faktor {formatFactor(e.factor)}
                </span>
              )}
              <span className="rounded-sm bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[var(--color-muted)]">
                {scored[i].size}/{ENDLAUF26_AGE_CLASSES.length} Klassen gewertet
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
