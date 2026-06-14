import Link from "next/link";
import { Zap } from "lucide-react";
import { StandingsTable } from "@/components/standings-table";
import {
  getEnrichedEntriesForEvent,
  getLiveEvent,
} from "@/lib/dal/races";
import { computeHighlights, rankLiveStandings } from "@/lib/ranking";
import { formatDateDe } from "@/lib/utils";
import { db } from "@/db/drizzle";
import { ageClasses } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const liveEvent = await getLiveEvent();

  if (!liveEvent) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Live</h1>
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-muted)]">
          Derzeit läuft kein Rennen live.
        </p>
        <p className="text-center text-sm">
          <Link href="/" className="text-[var(--color-accent)] hover:underline">
            ← Zur Übersicht
          </Link>
        </p>
      </div>
    );
  }

  if (!liveEvent.liveAgeClassId) {
    return (
      <div className="space-y-4">
        <LiveHeader event={liveEvent} />
        <p className="rounded-lg border border-[var(--color-live)]/40 bg-[var(--color-live)]/10 p-6 text-center text-sm text-[var(--color-muted)]">
          Das Rennen ist live, aber es ist noch keine Altersklasse als aktiv
          ausgewählt. Bitte im{" "}
          <Link
            href={`/admin/events/${liveEvent.id}`}
            className="text-[var(--color-accent)] hover:underline"
          >
            Admin
          </Link>{" "}
          eine Altersklasse festlegen.
        </p>
      </div>
    );
  }

  const [entries, ageClass] = await Promise.all([
    getEnrichedEntriesForEvent(liveEvent.id),
    db
      .select({ name: ageClasses.name })
      .from(ageClasses)
      .where(eq(ageClasses.id, liveEvent.liveAgeClassId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const classEntries = entries.filter(
    (e) => e.ageClassId === liveEvent.liveAgeClassId,
  );
  const ranked = rankLiveStandings(classEntries);
  const highlights = computeHighlights(classEntries);

  return (
    <div className="space-y-6">
      <LiveHeader event={liveEvent} ageClassName={ageClass?.name} />

      <p className="text-xs text-[var(--color-muted)]">
        Live-Zwischenstand nach Zeiten — zählt nicht für die Meisterschaft. Die
        Endwertung wird im Admin nach Abschluss der Altersklasse manuell
        eingetragen.
      </p>

      <StandingsTable
        ageClassName={ageClass?.name ?? "Altersklasse"}
        ranked={ranked}
        highlights={highlights}
        showTestRun
        showPoints={false}
      />

      <script
        dangerouslySetInnerHTML={{
          __html: `setTimeout(() => location.reload(), 5000);`,
        }}
      />
    </div>
  );
}

function LiveHeader({
  event,
  ageClassName,
}: {
  event: {
    id: number;
    number: number;
    name: string;
    eventDate: string;
    hostTeamName: string | null;
  };
  ageClassName?: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-live)]/15 px-2 py-0.5 font-semibold text-[var(--color-live)]">
            <Zap className="h-3.5 w-3.5 animate-pulse" />
            LIVE
          </span>
          <span>R{event.number}</span>
          <span>·</span>
          <span>{formatDateDe(event.eventDate)}</span>
        </div>
        <h1 className="text-2xl font-semibold">{event.name}</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Ausrichter: {event.hostTeamName}
          {ageClassName ? ` · ${ageClassName}` : ""}
        </p>
      </div>
      <Link
        href={`/events/${event.id}`}
        className="text-sm text-[var(--color-accent)] hover:underline"
      >
        Rennübersicht →
      </Link>
    </header>
  );
}
