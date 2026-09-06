import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { endlauf26Entries } from "@/db/schema";
import { getEndlaufEvents, recomputeLivePositions } from "@/lib/dal/endlauf26";
import { championshipFromSlug, ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";

/**
 * "Live-Positionen neu berechnen".
 *
 * Re-derives the stored live positions of every class with live times. The
 * championship table itself needs no recomputation: it is computed at read
 * time from the imported official result lists.
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
  let liveClasses = 0;
  let entriesUpdated = 0;

  for (const ev of events) {
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
      const positions = await recomputeLivePositions(ev.id, ageClass);
      entriesUpdated += positions.length;
      if (positions.some((p) => p.started)) liveClasses += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    eventsTouched: events.length,
    liveClasses,
    entriesUpdated,
  });
}
