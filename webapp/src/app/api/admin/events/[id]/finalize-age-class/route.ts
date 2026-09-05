import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
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
import {
  DEFAULT_VIEW,
  assignPointsFromManualPositions,
  rankRaceEntries,
  type ManualResult,
  type RankableEntry,
} from "@/lib/ranking";

interface ResultInput {
  entryId: number;
  finishPosition: number | null;
}

function parseResults(value: unknown): ResultInput[] | null {
  if (!Array.isArray(value)) return null;
  const out: ResultInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const entryId = Number(r.entryId);
    if (!Number.isInteger(entryId)) return null;
    const posRaw = r.finishPosition;
    let finishPosition: number | null;
    if (posRaw === null || posRaw === undefined || posRaw === "") {
      finishPosition = null;
    } else {
      const num = Number(posRaw);
      if (!Number.isInteger(num) || num < 1) return null;
      finishPosition = num;
    }
    out.push({ entryId, finishPosition });
  }
  return out;
}

export async function POST(
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

  // If timings exist for this class, derive official positions/points from
  // the runs (best run + penalties). Otherwise fall back to the manual
  // positions form for legacy backfills (e.g. races 1–5 without run data).
  const hasScoringTimes = classEntries.some(
    (e) =>
      e.runs.first?.timeSeconds != null || e.runs.second?.timeSeconds != null,
  );

  let assigned: ManualResult[];

  if (hasScoringTimes) {
    const ranked = rankRaceEntries(classEntries, pointsScale, DEFAULT_VIEW);
    assigned = ranked.map((r) => ({
      entryId: r.entry.entryId,
      finishPosition: r.finishPosition,
      pointsAwarded: r.pointsAwarded,
    }));
  } else {
    const results = parseResults(body?.results);
    if (!results) {
      return NextResponse.json({ error: "invalid_results" }, { status: 400 });
    }

    const classEntryIds = new Set(classEntries.map((e) => e.entryId));
    for (const r of results) {
      if (!classEntryIds.has(r.entryId)) {
        return NextResponse.json({ error: "invalid_entry" }, { status: 400 });
      }
    }

    const seen = new Set<number>();
    for (const r of results) {
      if (r.finishPosition === null) continue;
      if (seen.has(r.finishPosition)) {
        return NextResponse.json(
          { error: "duplicate_position" },
          { status: 400 },
        );
      }
      seen.add(r.finishPosition);
    }

    const positionsByEntryId = new Map<number, number | null>(
      results.map((r) => [r.entryId, r.finishPosition] as const),
    );
    assigned = assignPointsFromManualPositions<RankableEntry>(
      classEntries,
      positionsByEntryId,
      pointsScale,
    );
  }

  await db.transaction(async (tx) => {
    for (const r of assigned) {
      await tx
        .update(raceEntries)
        .set({
          finishPosition: r.finishPosition,
          pointsAwarded: r.pointsAwarded,
        })
        .where(eq(raceEntries.id, r.entryId));
    }

    await tx.insert(eventAgeClassFinalizations).values({
      raceEventId: eventId,
      ageClassId,
    });
  });

  return NextResponse.json({
    ok: true,
    entriesUpdated: assigned.length,
    source: hasScoringTimes ? "times" : "manual",
  });
}

/**
 * Re-open a finalized age class so times can be corrected (e.g. after a
 * judge's decision). Stored positions/points are kept until the class is
 * finalized again, which recomputes them from the corrected times.
 * Body: `{ ageClassId }`.
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

  const deleted = await db
    .delete(eventAgeClassFinalizations)
    .where(
      and(
        eq(eventAgeClassFinalizations.raceEventId, eventId),
        eq(eventAgeClassFinalizations.ageClassId, ageClassId),
      ),
    )
    .returning({ id: eventAgeClassFinalizations.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "not_finalized" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
