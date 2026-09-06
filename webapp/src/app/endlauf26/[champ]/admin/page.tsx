import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AdminLogin } from "@/components/admin-login.client";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { EventStatusBadge } from "@/components/endlauf26/event-status-badge";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getDocuments,
  getEndlaufEvents,
  getEndlaufFieldDrivers,
  getScoredClasses,
} from "@/lib/dal/endlauf26";
import { ENDLAUF26_DOCUMENT_SLOTS } from "@/lib/endlauf26/documents";
import { formatFactor } from "@/lib/endlauf26/format";
import {
  ageClassName,
  championshipFromSlug,
  ENDLAUF26_AGE_CLASSES,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { cn } from "@/lib/utils";
import { DocumentsAdmin } from "./documents-admin.client";
import { FieldAdmin } from "./field-admin.client";
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

  if (!(await isAdminSession())) {
    return (
      <div className="space-y-6">
        <ChampHeader championship={championship} active="admin" title="Admin · Endläufe" />
        <AdminLogin title="Admin · Endläufe" />
      </div>
    );
  }

  const [events, fieldDrivers, documents] = await Promise.all([
    getEndlaufEvents(championship),
    getEndlaufFieldDrivers(championship),
    getDocuments(championship),
  ]);
  const scored = await Promise.all(events.map((e) => getScoredClasses(e.id)));
  const slug = ENDLAUF26_SLUGS[championship];
  const base = `/endlauf26/${slug}`;

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="admin"
        title="Admin · Endläufe"
        subtitle="Ergebnislisten fotografieren und einlesen (Grundlage der Wertung), Fahrerfeld pflegen (Abmeldungen, Nachrücker), Quell-PDFs verwalten, Live-Timing als Werkzeug."
        isLive={events.some((e) => e.status === "live")}
      />

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
                <span
                  className={cn(
                    "text-xs",
                    scored[i].size === ENDLAUF26_AGE_CLASSES.length
                      ? "text-[var(--color-rank-green)]"
                      : "text-[var(--color-muted)]",
                  )}
                >
                  {scored[i].size}/{ENDLAUF26_AGE_CLASSES.length} Ergebnislisten
                  {e.status === "live" && e.liveAgeClass ? ` · live: ${ageClassName(e.liveAgeClass)}` : ""}
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

      <FieldAdmin championship={championship} drivers={fieldDrivers} />

      <DocumentsAdmin
        championshipSlug={slug}
        slots={ENDLAUF26_DOCUMENT_SLOTS[championship]}
        documents={documents}
      />

      <EndlaufRecomputeButton championshipSlug={slug} />
    </div>
  );
}
