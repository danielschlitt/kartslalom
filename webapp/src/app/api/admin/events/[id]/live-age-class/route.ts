import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { ageClasses, raceEvents } from "@/db/schema";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const ageClassId =
    body?.ageClassId === null || body?.ageClassId === undefined
      ? null
      : Number(body.ageClassId);

  if (ageClassId !== null && !Number.isFinite(ageClassId)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }

  const [event] = await db
    .select()
    .from(raceEvents)
    .where(eq(raceEvents.id, eventId))
    .limit(1);
  if (!event) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (event.status !== "live") {
    return NextResponse.json({ error: "event_not_live" }, { status: 400 });
  }

  if (ageClassId !== null) {
    const [cls] = await db
      .select()
      .from(ageClasses)
      .where(eq(ageClasses.id, ageClassId))
      .limit(1);
    if (!cls) {
      return NextResponse.json({ error: "age_class_not_found" }, { status: 404 });
    }
  }

  const [updated] = await db
    .update(raceEvents)
    .set({ liveAgeClassId: ageClassId })
    .where(eq(raceEvents.id, eventId))
    .returning();

  return NextResponse.json({ ok: true, event: updated });
}
