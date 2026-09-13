import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { deleteClassResults, getEndlaufEvent } from "@/lib/dal/endlauf26";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";

/**
 * OFFICIAL RESULTS: remove the imported result list of one class (rows and
 * photos). Body: `{ ageClass }`. The class then no longer counts for the
 * championship until a new list is imported.
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
  const ageClass = Number(body?.ageClass);
  if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }
  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const deleted = await deleteClassResults(event, ageClass);
  return NextResponse.json({ ok: true, ...deleted });
}
