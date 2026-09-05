import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { eventAgeClassFinalizations, raceEntries, runs } from "@/db/schema";

const VALID_RUN_TYPES = ["test", "first", "second"] as const;
type RunType = (typeof VALID_RUN_TYPES)[number];

/**
 * Upsert (or clear) a single run for a race entry.
 * Body: { runType: 'test'|'first'|'second', timeSeconds: number|null, penaltySeconds: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isFinite(entryId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const entry = await db
    .select()
    .from(raceEntries)
    .where(eq(raceEntries.id, entryId))
    .limit(1);
  if (entry.length === 0)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Once the age class is finalized, run times become read-only so the
  // official championship result cannot drift from later edits.
  const [finalized] = await db
    .select({ id: eventAgeClassFinalizations.id })
    .from(eventAgeClassFinalizations)
    .where(
      and(
        eq(eventAgeClassFinalizations.raceEventId, entry[0].raceEventId),
        eq(eventAgeClassFinalizations.ageClassId, entry[0].ageClassId),
      ),
    )
    .limit(1);
  if (finalized) {
    return NextResponse.json(
      { error: "age_class_finalized" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const runType = body?.runType as RunType;
  if (!VALID_RUN_TYPES.includes(runType)) {
    return NextResponse.json({ error: "invalid_run_type" }, { status: 400 });
  }

  const timeRaw = body?.timeSeconds;
  const timeSeconds =
    timeRaw === null || timeRaw === undefined || timeRaw === ""
      ? null
      : Number(timeRaw);
  if (timeSeconds !== null && !Number.isFinite(timeSeconds)) {
    return NextResponse.json({ error: "invalid_time" }, { status: 400 });
  }

  const penaltySecondsRaw = body?.penaltySeconds ?? 0;
  const penaltySeconds = Number(penaltySecondsRaw);
  if (!Number.isFinite(penaltySeconds) || penaltySeconds < 0) {
    return NextResponse.json({ error: "invalid_penalty" }, { status: 400 });
  }

  // Empty values mean "clear the run"
  if (timeSeconds === null && penaltySeconds === 0) {
    await db
      .delete(runs)
      .where(and(eq(runs.raceEntryId, entryId), eq(runs.runType, runType)));
    return NextResponse.json({ ok: true, cleared: true });
  }

  await db
    .insert(runs)
    .values({
      raceEntryId: entryId,
      runType,
      timeSeconds: timeSeconds === null ? null : String(timeSeconds),
      penaltySeconds,
    })
    .onConflictDoUpdate({
      target: [runs.raceEntryId, runs.runType],
      set: {
        timeSeconds: timeSeconds === null ? null : String(timeSeconds),
        penaltySeconds,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
