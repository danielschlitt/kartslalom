import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { EventStatusBadge } from "@/components/endlauf26/event-status-badge";
import { getEndlaufEvents, getFinalizedClasses } from "@/lib/dal/endlauf26";
import { formatFactor } from "@/lib/endlauf26/format";
import {
  ageClassName,
  championshipFromSlug,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { cn } from "@/lib/utils";
import { EndlaufRecomputeButton } from "./recompute-button.client";

export const dynamic = "force-dynamic";

export default async function EndlaufAdminIndexPage({
  params,
}: {
  params: Promise<{ champ: string }>;
}) {
  const { champ } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();
  const events = await getEndlaufEvents(championship);
  const finalized = await Promise.all(events.map((e) => getFinalizedClasses(e.id)));
  const slug = ENDLAUF26_SLUGS[championship];
  const base = `/endlauf26/${slug}`;

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="admin"
        title="Admin · Endläufe"
        subtitle="Status setzen, Klasse und Fahrer aktivieren, Zeiten diktieren oder eintragen, Klassen abschließen."
        isLive={events.some((e) => e.status === "live")}
      />

      <EndlaufRecomputeButton championshipSlug={slug} />

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          Endläufe
        </h2>
        <div className="space-y-2">
          {events.map((e, i) => (
            <Link
              key={e.id}
              href={`${base}/admin/events/${e.slug}`}
              className={cn(
                "flex items-center justify-between rounded-lg border bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-2)]",
                e.status === "live" ? "border-[var(--color-live)]/60" : "border-[var(--color-border)]",
              )}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-[var(--color-muted)]">E{e.number}</span>
                <span className="font-semibold">{e.name}</span>
                {e.factor !== 1 && (
                  <span className="text-xs text-[var(--color-accent)]">{formatFactor(e.factor)}</span>
                )}
                <span className="text-xs text-[var(--color-muted)]">
                  {finalized[i].size} Klassen abgeschlossen
                  {e.status === "live" && e.liveAgeClass ? ` · aktiv: ${ageClassName(e.liveAgeClass)}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <EventStatusBadge status={e.status} />
                <ArrowRight className="h-4 w-4 text-[var(--color-muted)]" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
