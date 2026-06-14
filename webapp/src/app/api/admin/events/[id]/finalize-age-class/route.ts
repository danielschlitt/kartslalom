import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  eventAgeClassFinalizations,
  raceEntries,
  raceEvents,
} from "@/db/schema";
import {
  getEnrichedEntriesForEvent,
  getPointsScale,
} from "@/lib/dal/races";
import { rankRaceEntries } from "@/lib/ranking";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const ageClassId = Number(body?.ageClassId);
  if (!Number.isFinite(ageClassId)) {
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

  if (event.status === "live" && event.liveAgeClassId === ageClassId) {
    return NextResponse.json(
      { error: "age_class_still_live" },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(eventAgeClassFinalizations)
    .where(
      and(
        eq(eventAgeClassFinalizations.raceEventId, eventId),
        eq(eventAgeClassFinalizations.ageClassId, ageClassId),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: "already_finalized" }, { status: 409 });
  }

  const [entries, pointsScale] = await Promise.all([
    getEnrichedEntriesForEvent(eventId),
    getPointsScale(),
  ]);
  const classEntries = entries.filter((e) => e.ageClassId === ageClassId);
  if (classEntries.length === 0) {
    return NextResponse.json({ error: "no_entries" }, { status: 400 });
  }

  const ranked = rankRaceEntries(classEntries, pointsScale);

  await db.transaction(async (tx) => {
    for (const r of ranked) {
      await tx
        .update(raceEntries)
        .set({
          finishPosition: r.finishPosition,
          pointsAwarded: r.pointsAwarded,
        })
        .where(eq(raceEntries.id, r.entry.entryId));
    }

    await tx.insert(eventAgeClassFinalizations).values({
      raceEventId: eventId,
      ageClassId,
    });
  });

  return NextResponse.json({
    ok: true,
    entriesUpdated: ranked.length,
  });
}
