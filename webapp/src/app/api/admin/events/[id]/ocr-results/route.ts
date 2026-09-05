import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { db } from "@/db/drizzle";
import { ageClasses, eventAgeClassFinalizations } from "@/db/schema";
import { getEnrichedEntriesForEvent, getRaceEvent } from "@/lib/dal/races";
import { handleSheetOcr } from "@/lib/ocr/sheet-ocr";
import { formatDateDe } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * OCR a photographed result sheet of one age class and propose which entry of
 * the class each row belongs to.
 *
 * `multipart/form-data`: `image` (jpeg/png/webp), `ageClassId`.
 * Response: `OcrResultsResponse` (see `@/lib/ocr/types`). Nothing is written.
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

  const form = await req.formData().catch(() => null);
  const ageClassId = Number(form?.get("ageClassId"));
  if (!Number.isInteger(ageClassId)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }

  const event = await getRaceEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

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

  const [ageClass] = await db
    .select({ name: ageClasses.name })
    .from(ageClasses)
    .where(eq(ageClasses.id, ageClassId))
    .limit(1);

  const entries = (await getEnrichedEntriesForEvent(eventId)).filter(
    (e) => e.ageClassId === ageClassId,
  );

  return handleSheetOcr(
    form,
    entries.map((e) => ({
      entryId: e.entryId,
      firstName: e.firstName,
      lastName: e.lastName,
      teamName: e.teamName,
      startingOrder: e.startingOrder,
    })),
    {
      eventLabel: `${event.name} · ${formatDateDe(event.eventDate)}`,
      ageClassLabel: ageClass?.name ?? `Altersklasse ${ageClassId}`,
    },
  );
}
