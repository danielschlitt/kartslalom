import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { getEndlaufEvent, syncStandingsStartOrders } from "@/lib/dal/endlauf26";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";
import { standingsOrderApplies } from "@/lib/endlauf26/start-order";

/**
 * Admin: (re)compute the default start order of this Endlauf from the
 * championship standing before it — bottom-up, last starts first. Body:
 * `{ ageClass?: 1–6, force?: boolean }`. Classes with an official result
 * list or a start list photo are left alone; classes with live times only
 * with `force`. Not available for ADAC Endlauf 1 (CSV start positions).
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
  if (!standingsOrderApplies(event.championship, event)) {
    return NextResponse.json({ error: "standings_order_not_applicable" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { ageClass?: unknown; force?: unknown };
  let ageClass: number | undefined;
  if (body.ageClass !== undefined && body.ageClass !== null) {
    ageClass = Number(body.ageClass);
    if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
      return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
    }
  }
  const summary = await syncStandingsStartOrders(event.championship, {
    eventId: event.id,
    ageClass,
    force: body.force === true,
  });
  return NextResponse.json({ ok: true, ...summary });
}
