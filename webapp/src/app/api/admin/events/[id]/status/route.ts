import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { raceEvents } from "@/db/schema";

const VALID_STATUS = ["upcoming", "live", "completed"] as const;

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
  const status = body?.status;
  if (!VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const [updated] = await db
    .update(raceEvents)
    .set({ status })
    .where(eq(raceEvents.id, eventId))
    .returning();

  if (!updated)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, event: updated });
}
