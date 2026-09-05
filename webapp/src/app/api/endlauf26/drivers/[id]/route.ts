import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import {
  setEndlaufDriverNominated,
  setEndlaufDriverWithdrawn,
  type FieldChangeResult,
} from "@/lib/dal/endlauf26";

const STATUS: Record<Exclude<FieldChangeResult, "ok">, number> = {
  not_found: 404,
  not_in_field: 400,
  already_qualified: 400,
  has_times: 409,
};

/**
 * Manage the Endlauf field of a driver (championship-wide, all events):
 *
 *  { withdrawn: true|false }  — flag a driver of the field as not competing
 *                               (hidden from start lists, scored as no-show)
 *  { nominated: true|false }  — nominate a replacement candidate (creates its
 *                               entries) or revoke the nomination (only while
 *                               no time is stored)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const driverId = Number(id);
  if (!Number.isInteger(driverId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    withdrawn?: unknown;
    nominated?: unknown;
  };

  let result: FieldChangeResult;
  if (typeof body.withdrawn === "boolean") {
    result = await setEndlaufDriverWithdrawn(driverId, body.withdrawn);
  } else if (typeof body.nominated === "boolean") {
    result = await setEndlaufDriverNominated(driverId, body.nominated);
  } else {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (result !== "ok") {
    return NextResponse.json({ error: result }, { status: STATUS[result] });
  }
  return NextResponse.json({ ok: true });
}
