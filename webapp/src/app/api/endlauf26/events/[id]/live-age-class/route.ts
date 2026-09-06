import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { endlauf26Events } from "@/db/schema";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";

/** LIVE TIMING: activate (or clear) the age class currently on track. Clears the active driver. */
export async function PATCH(
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
  const raw = body?.ageClass;
  const ageClass: number | null =
    raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (
    ageClass !== null &&
    !(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)
  ) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }

  const [event] = await db
    .select()
    .from(endlauf26Events)
    .where(eq(endlauf26Events.id, eventId))
    .limit(1);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.status !== "live") {
    return NextResponse.json({ error: "event_not_live" }, { status: 400 });
  }

  await db
    .update(endlauf26Events)
    .set({ liveAgeClass: ageClass, liveEntryId: null })
    .where(eq(endlauf26Events.id, eventId));

  return NextResponse.json({ ok: true });
}
