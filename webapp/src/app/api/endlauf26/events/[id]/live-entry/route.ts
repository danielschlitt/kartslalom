import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { endlauf26Entries, endlauf26Events } from "@/db/schema";

/** Activate (or clear) the driver currently on track. Only this entry accepts times. */
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
  const raw = body?.entryId;
  const entryId: number | null =
    raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (entryId !== null && !Number.isInteger(entryId)) {
    return NextResponse.json({ error: "invalid_entry" }, { status: 400 });
  }

  const [event] = await db
    .select()
    .from(endlauf26Events)
    .where(eq(endlauf26Events.id, eventId))
    .limit(1);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.status !== "live" || event.liveAgeClass === null) {
    return NextResponse.json({ error: "no_live_age_class" }, { status: 400 });
  }

  if (entryId !== null) {
    const [entry] = await db
      .select()
      .from(endlauf26Entries)
      .where(eq(endlauf26Entries.id, entryId))
      .limit(1);
    if (!entry || entry.eventId !== eventId) {
      return NextResponse.json({ error: "invalid_entry" }, { status: 400 });
    }
    if (entry.ageClass !== event.liveAgeClass) {
      return NextResponse.json({ error: "entry_not_in_live_class" }, { status: 400 });
    }
  }

  await db
    .update(endlauf26Events)
    .set({ liveEntryId: entryId })
    .where(eq(endlauf26Events.id, eventId));

  return NextResponse.json({ ok: true });
}
