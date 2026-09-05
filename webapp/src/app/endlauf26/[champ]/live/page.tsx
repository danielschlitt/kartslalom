import Link from "next/link";
import { notFound } from "next/navigation";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { LiveView } from "@/components/endlauf26/live-view";
import { getLiveEndlaufEvent } from "@/lib/dal/endlauf26";
import { championshipFromSlug, ENDLAUF26_SLUGS } from "@/lib/endlauf26/ranking";

export const dynamic = "force-dynamic";

export default async function EndlaufLivePage({
  params,
}: {
  params: Promise<{ champ: string }>;
}) {
  const { champ } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();
  const event = await getLiveEndlaufEvent(championship);

  if (!event) {
    return (
      <div className="space-y-6">
        <ChampHeader championship={championship} active="live" />
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-muted)]">
          Derzeit läuft kein Endlauf live.
        </p>
        <p className="text-center text-sm">
          <Link
            href={`/endlauf26/${ENDLAUF26_SLUGS[championship]}`}
            className="text-[var(--color-accent)] hover:underline"
          >
            ← Zur Wertung
          </Link>
        </p>
        <script
          dangerouslySetInnerHTML={{ __html: `setTimeout(() => location.reload(), 15000);` }}
        />
      </div>
    );
  }

  return <LiveView event={event} />;
}
