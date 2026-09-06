import Link from "next/link";
import { Zap } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { LiveBoard } from "@/components/endlauf26/live-board";
import { getEndlaufEntriesForEvent, type EndlaufEvent } from "@/lib/dal/endlauf26";
import {
  ageClassName,
  ENDLAUF26_LABELS,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { isAdminSession } from "@/lib/admin-auth";
import { formatDateDe } from "@/lib/utils";

/** Server component: the live timing view for a live Endlauf event (auto-reloads). */
export async function LiveView({ event }: { event: EndlaufEvent }) {
  const base = `/endlauf26/${ENDLAUF26_SLUGS[event.championship]}`;

  if (event.liveAgeClass === null) {
    const isAdmin = await isAdminSession();
    return (
      <div className="space-y-4">
        <LiveHeader event={event} />
        <p className="rounded-lg border border-[var(--color-live)]/40 bg-[var(--color-live)]/10 p-6 text-center text-sm text-[var(--color-muted)]">
          Der Endlauf ist live, aber es ist noch keine Klasse aktiviert.
          {isAdmin && (
            <>
              {" "}
              Bitte im{" "}
              <Link
                href={`${base}/admin/events/${event.slug}`}
                className="text-[var(--color-accent)] hover:underline"
              >
                Admin
              </Link>{" "}
              eine Klasse aktivieren.
            </>
          )}
        </p>
        <AutoRefresh intervalMs={5000} />
      </div>
    );
  }

  const entries = await getEndlaufEntriesForEvent(event.id, event.liveAgeClass);

  return (
    <div className="space-y-4">
      <LiveHeader event={event} ageClass={event.liveAgeClass} />
      <p className="text-xs text-[var(--color-muted)]">
        Inoffizielles Live-Timing (Lauf 1 + Lauf 2 inkl. Strafsekunden, von Hand mitgeschrieben).
        Maßgeblich ist allein die offizielle Ergebnisliste — sie wird nach dem Lauf eingelesen und
        bestimmt Platz und Punkte.
      </p>
      <LiveBoard
        ageClassName={ageClassName(event.liveAgeClass)}
        entries={entries}
        liveEntryId={event.liveEntryId}
      />
      <AutoRefresh intervalMs={5000} />
    </div>
  );
}

function LiveHeader({ event, ageClass }: { event: EndlaufEvent; ageClass?: number }) {
  const base = `/endlauf26/${ENDLAUF26_SLUGS[event.championship]}`;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-live)]/15 px-2 py-0.5 font-semibold text-[var(--color-live)]">
            <Zap className="h-3.5 w-3.5 animate-pulse" />
            LIVE
          </span>
          <span>{ENDLAUF26_LABELS[event.championship].short}</span>
          <span>·</span>
          <span>Endlauf {event.number}</span>
          {event.eventDate && (
            <>
              <span>·</span>
              <span>{formatDateDe(event.eventDate)}</span>
            </>
          )}
        </div>
        <h1 className="text-2xl font-semibold">
          {event.name}
          {ageClass ? ` · ${ageClassName(ageClass)}` : ""}
        </h1>
      </div>
      <div className="flex gap-3 text-sm">
        <Link href={`${base}/events/${event.slug}`} className="text-[var(--color-accent)] hover:underline">
          Alle Klassen →
        </Link>
        <Link href={base} className="text-[var(--color-accent)] hover:underline">
          Wertung →
        </Link>
      </div>
    </header>
  );
}
