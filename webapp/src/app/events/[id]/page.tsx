import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, Settings, Zap } from "lucide-react";

import {
  getEnrichedEntriesForEvent,
  getFinalizedAgeClassIds,
  getPointsScale,
  getRaceEvent,
} from "@/lib/dal/races";
import {
  computeHighlights,
  rankRaceEntries,
  type RankedEntry,
} from "@/lib/ranking";
import { StandingsTable } from "@/components/standings-table";
import { isAdminSession } from "@/lib/admin-auth";
import { cn, formatDateDe } from "@/lib/utils";
import type { EnrichedEntry } from "@/lib/dal/races";

export const dynamic = "force-dynamic";

export default async function RaceEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  const event = await getRaceEvent(eventId);
  if (!event) notFound();

  const [entries, pointsScale, finalizedAgeClassIds, isAdmin] = await Promise.all([
    getEnrichedEntriesForEvent(eventId),
    getPointsScale(),
    getFinalizedAgeClassIds(eventId),
    isAdminSession(),
  ]);

  // Group entries by age class
  const byClass = new Map<
    number,
    {
      ageClassId: number;
      sortOrder: number;
      name: string;
      entries: EnrichedEntry[];
    }
  >();
  for (const e of entries) {
    let g = byClass.get(e.ageClassId);
    if (!g) {
      g = {
        ageClassId: e.ageClassId,
        sortOrder: e.ageClassSortOrder,
        name: e.ageClassName,
        entries: [],
      };
      byClass.set(e.ageClassId, g);
    }
    g.entries.push(e);
  }
  const groups = [...byClass.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const isLiveEvent = event.status === "live";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span>R{event.number}</span>
            <span>·</span>
            <span>{formatDateDe(event.eventDate)}</span>
            <span>·</span>
            <span>{event.kartType === "electric" ? "Elektro" : "Benzin"}</span>
            {event.isHmj && (
              <>
                <span>·</span>
                <span className="rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[var(--color-accent)]">
                  HMJ
                </span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-semibold">{event.name}</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Ausrichter: {event.hostTeamName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={event.status} />
          {isLiveEvent && event.liveAgeClassId && (
            <Link
              href="/live"
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-live)]/40 bg-[var(--color-live)]/10 px-3 py-1.5 text-sm text-[var(--color-live)] hover:bg-[var(--color-live)]/15"
            >
              <Zap className="h-4 w-4 animate-pulse" />
              Live-Zeiten
            </Link>
          )}
          {isAdmin && (
            <Link
              href={`/admin/events/${event.id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-foreground)]"
            >
              <Settings className="h-4 w-4" />
              Zeiten erfassen
            </Link>
          )}
        </div>
      </header>

      <Legend />

      <div className="space-y-6">
        {groups.length === 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-muted)]">
            Für dieses Rennen sind noch keine Fahrer eingetragen.
          </p>
        ) : (
          groups.map((g) => {
            const isFinalized = finalizedAgeClassIds.has(g.ageClassId);
            const isCurrentlyLive =
              isLiveEvent && event.liveAgeClassId === g.ageClassId;

            const analysisLink = (
              <AnalysisLink eventId={event.id} ageClass={g} />
            );

            if (isCurrentlyLive) {
              return (
                <div key={g.ageClassId} className="space-y-2">
                  {analysisLink}
                  <PendingClassCard
                    ageClassName={g.name}
                    message="Diese Altersklasse läuft gerade live."
                    action={
                      <Link
                        href="/live"
                        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-live)] hover:underline"
                      >
                        <Zap className="h-4 w-4" />
                        Live-Zeiten anzeigen →
                      </Link>
                    }
                  />
                </div>
              );
            }

            if (!isFinalized) {
              return (
                <div key={g.ageClassId} className="space-y-2">
                  {analysisLink}
                  <PendingClassCard
                    ageClassName={g.name}
                    message="Noch keine Endwertung — Ergebnisse werden nach Abschluss der Altersklasse veröffentlicht."
                  />
                </div>
              );
            }

            const ranked = rankRaceEntries(g.entries, pointsScale);
            const highlights = computeHighlights(g.entries);

            const display: RankedEntry<EnrichedEntry>[] = ranked
              .map((r) => ({
                ...r,
                finishPosition:
                  r.entry.storedFinishPosition ?? r.finishPosition,
                pointsAwarded: r.entry.storedPointsAwarded ?? r.pointsAwarded,
              }))
              .sort((a, b) => {
                const ap = a.finishPosition ?? Number.MAX_SAFE_INTEGER;
                const bp = b.finishPosition ?? Number.MAX_SAFE_INTEGER;
                return ap - bp;
              });

            return (
              <div key={g.ageClassId} className="space-y-2">
                {analysisLink}
                <StandingsTable
                  ageClassName={g.name}
                  ranked={display}
                  highlights={highlights}
                  showTestRun
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AnalysisLink({
  eventId,
  ageClass,
}: {
  eventId: number;
  ageClass: { ageClassId: number; name: string };
}) {
  return (
    <Link
      href={`/events/${eventId}/details?ageClassId=${ageClass.ageClassId}`}
      className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
    >
      <BarChart3 className="h-3.5 w-3.5" />
      Analysiere {ageClass.name}
    </Link>
  );
}

function PendingClassCard({
  ageClassName,
  message,
  action,
}: {
  ageClassName: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName}
        </h3>
      </div>
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-[var(--color-muted)]">
        <p>{message}</p>
        {action}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "upcoming" | "live" | "completed" }) {
  const cls =
    status === "live"
      ? "bg-[var(--color-live)]/15 text-[var(--color-live)] border-[var(--color-live)]/40"
      : status === "completed"
        ? "bg-[var(--color-rank-grey)]/20 text-[var(--color-muted)] border-[var(--color-border)]"
        : "bg-[var(--color-pending)]/15 text-[var(--color-pending)] border-[var(--color-pending)]/40";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-semibold",
        cls,
      )}
    >
      {status === "live" && (
        <Zap className="h-3.5 w-3.5 animate-pulse" />
      )}
      {status === "live" ? "LIVE" : status === "completed" ? "Beendet" : "Geplant"}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-muted)]">
      <LegendDot
        color="bg-[var(--color-fastest-run)] text-[var(--color-fastest-run-fg)]"
      >
        Schnellste Zeit im Wertungslauf
      </LegendDot>
      <LegendDot
        color="bg-[var(--color-fastest-overall)] text-[var(--color-fastest-overall-fg)]"
      >
        Schnellste Zeit beider Wertungsläufe
      </LegendDot>
      <span>· Vorstarter / Gaststarter erhalten keine Meisterschaftspunkte</span>
    </div>
  );
}

function LegendDot({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-sm", color)} />
      {children}
    </span>
  );
}
