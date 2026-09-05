import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { db } from "@/db/drizzle";
import { eventAgeClassFinalizations, raceEntries, runs } from "@/db/schema";

/**
 * Delete every run of every entry of one age class of an event (e.g. after a
 * false start of the timing or to redo a class from scratch).
 *
 * Body: `{ ageClassId }`. Refused while the class is finalized — re-open it
 * first via `DELETE /api/admin/events/[id]/finalize-age-class`.
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
  const ageClassId = Number(body?.ageClassId);
  if (!Number.isInteger(ageClassId)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }

  const [finalized] = await db
    .select({ id: eventAgeClassFinalizations.id })
    .from(eventAgeClassFinalizations)
    .where(
      and(
        eq(eventAgeClassFinalizations.raceEventId, eventId),
        eq(eventAgeClassFinalizations.ageClassId, ageClassId),
      ),
    )
    .limit(1);
  if (finalized) {
    return NextResponse.json({ error: "age_class_finalized" }, { status: 409 });
  }

  const entries = await db
    .select({ id: raceEntries.id })
    .from(raceEntries)
    .where(
      and(eq(raceEntries.raceEventId, eventId), eq(raceEntries.ageClassId, ageClassId)),
    );
  if (entries.length === 0) return NextResponse.json({ ok: true, cleared: 0 });

  const deleted = await db
    .delete(runs)
    .where(
      inArray(
        runs.raceEntryId,
        entries.map((e) => e.id),
      ),
    )
    .returning({ id: runs.id });
  return NextResponse.json({ ok: true, cleared: deleted.length });
}
