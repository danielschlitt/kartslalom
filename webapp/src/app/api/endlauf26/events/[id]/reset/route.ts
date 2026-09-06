import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { getEndlaufEvent, resetEndlaufEvent } from "@/lib/dal/endlauf26";

/**
 * Start an Endlauf from scratch: deletes all official results and photos,
 * clears all live times and resets the live state. The field (drivers,
 * Nachrücker, Abmeldungen) and the start orders are kept.
 *
 * Body must contain `{ confirm: "<event slug>" }` to avoid accidents.
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
  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== event.slug) {
    return NextResponse.json({ error: "confirmation_mismatch" }, { status: 400 });
  }

  const result = await resetEndlaufEvent(eventId);
  return NextResponse.json({ ok: true, ...result });
}
