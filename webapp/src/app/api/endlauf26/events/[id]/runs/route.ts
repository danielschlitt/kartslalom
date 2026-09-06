import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { db } from "@/db/drizzle";
import { endlauf26Entries } from "@/db/schema";
import { getEndlaufEvent, recomputeLivePositions } from "@/lib/dal/endlauf26";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";

/**
 * LIVE TIMING: clear every run of every entry of one class. Body: `{ ageClass }`.
 * Requires a live event. Live positions are recomputed afterwards. Official
 * results are not affected.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const ageClass = Number(body?.ageClass);
  if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }

  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.status !== "live") {
    return NextResponse.json({ error: "event_not_live" }, { status: 409 });
  }

  const cleared = await db
    .update(endlauf26Entries)
    .set({
      testTime: null,
      testPenalty: 0,
      run1Time: null,
      run1Penalty: 0,
      run2Time: null,
      run2Penalty: 0,
      updatedAt: new Date(),
    })
    .where(and(eq(endlauf26Entries.eventId, eventId), eq(endlauf26Entries.ageClass, ageClass)))
    .returning({ id: endlauf26Entries.id });

  await recomputeLivePositions(eventId, ageClass);
  return NextResponse.json({ ok: true, cleared: cleared.length });
}
