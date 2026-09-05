import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  endlauf26Entries,
  endlauf26Events,
  endlauf26Finalizations,
} from "@/db/schema";
import { recomputeLivePositions } from "@/lib/dal/endlauf26";

type RunType = "test" | "first" | "second";
const RUN_TYPES = new Set<RunType>(["test", "first", "second"]);

/**
 * Save a run time / penalty for an entry.
 *
 * Guard rails: the event must be live, the entry's class must be the active
 * class, the entry must be the active driver, and the class must not be
 * finalized. Live positions are recomputed afterwards.
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
  const body = await req.json().catch(() => ({}));
  const runType = body?.runType as RunType;
  if (!RUN_TYPES.has(runType)) {
    return NextResponse.json({ error: "invalid_run_type" }, { status: 400 });
  }

  let timeSeconds: number | null = null;
  if (body.timeSeconds !== null && body.timeSeconds !== undefined && body.timeSeconds !== "") {
    const t = Number(String(body.timeSeconds).replace(",", "."));
    if (!Number.isFinite(t) || t < 0 || t > 3600) {
      return NextResponse.json({ error: "invalid_time" }, { status: 400 });
    }
    timeSeconds = Math.round(t * 1000) / 1000;
  }
  let penaltySeconds = 0;
  if (body.penaltySeconds !== null && body.penaltySeconds !== undefined && body.penaltySeconds !== "") {
    const p = Number(body.penaltySeconds);
    if (!Number.isInteger(p) || p < 0 || p > 1000) {
      return NextResponse.json({ error: "invalid_penalty" }, { status: 400 });
    }
    penaltySeconds = p;
  }

  const [entry] = await db
    .select()
    .from(endlauf26Entries)
    .where(eq(endlauf26Entries.id, entryId))
    .limit(1);
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [event] = await db
    .select()
    .from(endlauf26Events)
    .where(eq(endlauf26Events.id, entry.eventId))
    .limit(1);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [fin] = await db
    .select()
    .from(endlauf26Finalizations)
    .where(
      and(
        eq(endlauf26Finalizations.eventId, entry.eventId),
        eq(endlauf26Finalizations.ageClass, entry.ageClass),
      ),
    )
    .limit(1);
  if (fin) {
    return NextResponse.json({ error: "age_class_finalized" }, { status: 409 });
  }

  if (event.status !== "live") {
    return NextResponse.json({ error: "event_not_live" }, { status: 409 });
  }
  if (event.liveAgeClass !== entry.ageClass) {
    return NextResponse.json({ error: "age_class_not_active" }, { status: 409 });
  }
  if (event.liveEntryId !== entry.id) {
    return NextResponse.json({ error: "driver_not_active" }, { status: 409 });
  }

  const timeStr = timeSeconds === null ? null : timeSeconds.toFixed(3);
  const patch =
    runType === "test"
      ? { testTime: timeStr, testPenalty: penaltySeconds }
      : runType === "first"
        ? { run1Time: timeStr, run1Penalty: penaltySeconds }
        : { run2Time: timeStr, run2Penalty: penaltySeconds };

  await db
    .update(endlauf26Entries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(endlauf26Entries.id, entryId));

  const positions = await recomputeLivePositions(entry.eventId, entry.ageClass);
  const mine = positions.find((p) => p.entryId === entryId) ?? null;

  return NextResponse.json({ ok: true, positions: mine });
}

/**
 * Clear all three runs of an entry (Training, Lauf 1, Lauf 2). Requires a
 * live event and a class that is not finalized; unlike POST it does not need
 * the entry to be the active driver. Live positions are recomputed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isFinite(entryId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const [entry] = await db
    .select()
    .from(endlauf26Entries)
    .where(eq(endlauf26Entries.id, entryId))
    .limit(1);
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [event] = await db
    .select()
    .from(endlauf26Events)
    .where(eq(endlauf26Events.id, entry.eventId))
    .limit(1);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [fin] = await db
    .select()
    .from(endlauf26Finalizations)
    .where(
      and(
        eq(endlauf26Finalizations.eventId, entry.eventId),
        eq(endlauf26Finalizations.ageClass, entry.ageClass),
      ),
    )
    .limit(1);
  if (fin) return NextResponse.json({ error: "age_class_finalized" }, { status: 409 });
  if (event.status !== "live") {
    return NextResponse.json({ error: "event_not_live" }, { status: 409 });
  }

  await db
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
    .where(eq(endlauf26Entries.id, entryId));

  await recomputeLivePositions(entry.eventId, entry.ageClass);
  return NextResponse.json({ ok: true });
}
