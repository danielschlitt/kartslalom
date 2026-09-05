import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { db } from "@/db/drizzle";
import { endlauf26Entries } from "@/db/schema";
import {
  getEndlaufEvent,
  getFinalizedClasses,
  recomputeLivePositions,
} from "@/lib/dal/endlauf26";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";
import { parseImportItems } from "@/lib/ocr/import-runs";

/**
 * Bulk save of run times for one Endlauf class after reviewing an OCR'd
 * result sheet.
 *
 * Body: `{ ageClass, items: [{ entryId, runs: { test?, first?, second? } }] }`.
 * Unlike the per-driver route this does not require the "active driver" lock
 * (the sheet is written after the fact), but the event must be live and the
 * class must not be finalized. Live positions are recomputed afterwards.
 */
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
  const ageClass = Number(body?.ageClass);
  if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }
  const parsed = parseImportItems(body?.items);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.items.length === 0) return NextResponse.json({ ok: true, written: 0 });

  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (event.status !== "live") {
    return NextResponse.json({ error: "event_not_live" }, { status: 409 });
  }
  const finalized = await getFinalizedClasses(eventId);
  if (finalized.has(ageClass)) {
    return NextResponse.json({ error: "age_class_finalized" }, { status: 409 });
  }

  const entryIds = parsed.items.map((i) => i.entryId);
  const valid = await db
    .select({ id: endlauf26Entries.id })
    .from(endlauf26Entries)
    .where(
      and(
        inArray(endlauf26Entries.id, entryIds),
        eq(endlauf26Entries.eventId, eventId),
        eq(endlauf26Entries.ageClass, ageClass),
      ),
    );
  if (valid.length !== entryIds.length) {
    return NextResponse.json({ error: "invalid_entry" }, { status: 400 });
  }

  let written = 0;
  await db.transaction(async (tx) => {
    for (const item of parsed.items) {
      const patch: Partial<typeof endlauf26Entries.$inferInsert> = {};
      const fmt = (t: number | null) => (t === null ? null : t.toFixed(3));
      if (item.runs.test) {
        patch.testTime = fmt(item.runs.test.timeSeconds);
        patch.testPenalty = item.runs.test.penaltySeconds;
      }
      if (item.runs.first) {
        patch.run1Time = fmt(item.runs.first.timeSeconds);
        patch.run1Penalty = item.runs.first.penaltySeconds;
      }
      if (item.runs.second) {
        patch.run2Time = fmt(item.runs.second.timeSeconds);
        patch.run2Penalty = item.runs.second.penaltySeconds;
      }
      if (Object.keys(patch).length === 0) continue;
      await tx
        .update(endlauf26Entries)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(endlauf26Entries.id, item.entryId));
      written++;
    }
  });

  await recomputeLivePositions(eventId, ageClass);
  return NextResponse.json({ ok: true, written });
}
