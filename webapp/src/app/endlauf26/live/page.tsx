import Link from "next/link";
import { LiveView } from "@/components/endlauf26/live-view";
import { getLiveEndlaufEvent } from "@/lib/dal/endlauf26";
import { ENDLAUF26_LABELS, ENDLAUF26_SLUGS } from "@/lib/endlauf26/ranking";

export const dynamic = "force-dynamic";

/** "Endlauf Live Timing" — whichever championship is live right now. */
export default async function EndlaufLiveAnyPage() {
  const event = await getLiveEndlaufEvent();
  if (event) return <LiveView event={event} />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Endlauf Live Timing</h1>
      <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-muted)]">
        Derzeit läuft kein Endlauf live.
      </p>
      <p className="flex justify-center gap-4 text-sm">
        <Link href={`/endlauf26/${ENDLAUF26_SLUGS.hmj}`} className="text-[var(--color-accent)] hover:underline">
          {ENDLAUF26_LABELS.hmj.short} →
        </Link>
        <Link href={`/endlauf26/${ENDLAUF26_SLUGS.adac_hth}`} className="text-[var(--color-accent)] hover:underline">
          {ENDLAUF26_LABELS.adac_hth.short} →
        </Link>
      </p>
      <script
        dangerouslySetInnerHTML={{ __html: `setTimeout(() => location.reload(), 15000);` }}
      />
    </div>
  );
}
