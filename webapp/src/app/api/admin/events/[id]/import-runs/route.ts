import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { db } from "@/db/drizzle";
import { eventAgeClassFinalizations, raceEntries, runs } from "@/db/schema";
import { parseImportItems } from "@/lib/ocr/import-runs";

/**
 * Bulk upsert of run times for several entries of one age class — used after
 * reviewing an OCR'd result sheet.
 *
 * Body: `{ ageClassId, items: [{ entryId, runs: { test?, first?, second? } }] }`
 * where each run is `{ timeSeconds: number|null, penaltySeconds: number }` or
 * `null` to clear. Run keys that are absent are left untouched. Same semantics
 * as `POST /api/admin/entries/[id]/runs`, executed in one transaction.
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
  const ageClassId = Number(body?.ageClassId);
  if (!Number.isInteger(ageClassId)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }
  const parsed = parseImportItems(body?.items);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.items.length === 0) return NextResponse.json({ ok: true, written: 0, cleared: 0 });

  const [finalized] = await db
    .select({ id: eventAgeClassFinalizations.id })
    .from(eventAgeClassFinalizations)
    .where(
      and(
        eq(eventAgeClassFinalizations.raceEventId, eventId),
        eq(eventAgeClassFinalizations.ageClassId, ageClassId),
      ),
    )
    .limit(1);
  if (finalized) {
    return NextResponse.json({ error: "age_class_finalized" }, { status: 409 });
  }

  // Every entry must belong to this event and class.
  const entryIds = parsed.items.map((i) => i.entryId);
  const valid = await db
    .select({ id: raceEntries.id })
    .from(raceEntries)
    .where(
      and(
        inArray(raceEntries.id, entryIds),
        eq(raceEntries.raceEventId, eventId),
        eq(raceEntries.ageClassId, ageClassId),
      ),
    );
  if (valid.length !== entryIds.length) {
    return NextResponse.json({ error: "invalid_entry" }, { status: 400 });
  }

  let written = 0;
  let cleared = 0;
  await db.transaction(async (tx) => {
    for (const item of parsed.items) {
      for (const [runType, value] of Object.entries(item.runs) as [
        "test" | "first" | "second",
        { timeSeconds: number | null; penaltySeconds: number },
      ][]) {
        if (value.timeSeconds === null && value.penaltySeconds === 0) {
          await tx
            .delete(runs)
            .where(and(eq(runs.raceEntryId, item.entryId), eq(runs.runType, runType)));
          cleared++;
          continue;
        }
        const timeStr = value.timeSeconds === null ? null : String(value.timeSeconds);
        await tx
          .insert(runs)
          .values({
            raceEntryId: item.entryId,
            runType,
            timeSeconds: timeStr,
            penaltySeconds: value.penaltySeconds,
          })
          .onConflictDoUpdate({
            target: [runs.raceEntryId, runs.runType],
            set: { timeSeconds: timeStr, penaltySeconds: value.penaltySeconds, updatedAt: new Date() },
          });
        written++;
      }
    }
  });

  return NextResponse.json({ ok: true, written, cleared });
}
