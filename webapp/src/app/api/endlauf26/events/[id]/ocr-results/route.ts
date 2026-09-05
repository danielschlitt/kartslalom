import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import {
  getEndlaufEntriesForEvent,
  getEndlaufEvent,
  getFinalizedClasses,
} from "@/lib/dal/endlauf26";
import { ageClassName, ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";
import { handleSheetOcr } from "@/lib/ocr/sheet-ocr";
import { formatDateDe } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * Endlauf variant of the result-sheet OCR: `multipart/form-data` with `image`
 * and `ageClass` (1–6). Proposes an entry of that class for every row read
 * from the photo. Nothing is written.
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
  const ageClass = Number(form?.get("ageClass"));
  if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }

  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const finalized = await getFinalizedClasses(eventId);
  if (finalized.has(ageClass)) {
    return NextResponse.json({ error: "age_class_finalized" }, { status: 409 });
  }

  const entries = await getEndlaufEntriesForEvent(eventId, ageClass);

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
      eventLabel: `Endlauf ${event.number}: ${event.name}${event.eventDate ? ` · ${formatDateDe(event.eventDate)}` : ""}`,
      ageClassLabel: ageClassName(ageClass),
    },
  );
}
