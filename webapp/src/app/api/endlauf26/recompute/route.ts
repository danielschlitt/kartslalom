import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { endlauf26Entries, endlauf26Finalizations } from "@/db/schema";
import {
  getEndlaufEvents,
  recomputeLivePositions,
  writeFinalResults,
} from "@/lib/dal/endlauf26";
import { championshipFromSlug, ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";

/**
 * "Streichliste neu berechnen" for the Endläufe.
 *
 * For every finalized (event, class): re-derive finish positions + base
 * points from the stored times. For every non-finalized class with times:
 * recompute the live positions. Championship totals, Streichergebnisse and
 * movement arrows are always derived at read time, so they follow
 * automatically.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const body = await req.json().catch(() => ({}));
  const slug = body?.championship as string | undefined;
  const championship = slug ? championshipFromSlug(slug) : undefined;
  if (slug && !championship) {
    return NextResponse.json({ error: "invalid_championship" }, { status: 400 });
  }

  const events = await getEndlaufEvents(championship ?? undefined);
  let finalizedClasses = 0;
  let liveClasses = 0;
  let entriesUpdated = 0;

  for (const ev of events) {
    const fin = new Set(
      (
        await db
          .select({ ageClass: endlauf26Finalizations.ageClass })
          .from(endlauf26Finalizations)
          .where(eq(endlauf26Finalizations.eventId, ev.id))
      ).map((r) => r.ageClass),
    );
    const classesWithEntries = new Set(
      (
        await db
          .selectDistinct({ ageClass: endlauf26Entries.ageClass })
          .from(endlauf26Entries)
          .where(eq(endlauf26Entries.eventId, ev.id))
      ).map((r) => r.ageClass),
    );
    for (const ageClass of ENDLAUF26_AGE_CLASSES) {
      if (!classesWithEntries.has(ageClass)) continue;
      if (fin.has(ageClass)) {
        entriesUpdated += await writeFinalResults(ev.id, ageClass);
        finalizedClasses += 1;
      } else {
        const positions = await recomputeLivePositions(ev.id, ageClass);
        if (positions.some((p) => p.started)) liveClasses += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    eventsTouched: events.length,
    finalizedClasses,
    liveClasses,
    entriesUpdated,
  });
}
