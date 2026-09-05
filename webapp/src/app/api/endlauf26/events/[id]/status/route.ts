import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { endlauf26Events } from "@/db/schema";

const STATUSES = new Set(["upcoming", "live", "completed"]);

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
  const status = body?.status as string;
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const [event] = await db
    .select()
    .from(endlauf26Events)
    .where(eq(endlauf26Events.id, eventId))
    .limit(1);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.transaction(async (tx) => {
    if (status === "live") {
      // Only one Endlauf may be live at a time (per championship).
      await tx
        .update(endlauf26Events)
        .set({ status: "completed", liveAgeClass: null, liveEntryId: null })
        .where(
          and(
            eq(endlauf26Events.championship, event.championship),
            eq(endlauf26Events.status, "live"),
            ne(endlauf26Events.id, eventId),
          ),
        );
    }
    await tx
      .update(endlauf26Events)
      .set({
        status: status as "upcoming" | "live" | "completed",
        ...(status !== "live" ? { liveAgeClass: null, liveEntryId: null } : {}),
      })
      .where(eq(endlauf26Events.id, eventId));
  });

  return NextResponse.json({ ok: true });
}
