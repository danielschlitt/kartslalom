import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { endlauf26Entries } from "@/db/schema";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isFinite(entryId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const raw = body?.startingOrder;
  const startingOrder: number | null =
    raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (startingOrder !== null && (!Number.isInteger(startingOrder) || startingOrder < 1)) {
    return NextResponse.json({ error: "invalid_starting_order" }, { status: 400 });
  }
  const res = await db
    .update(endlauf26Entries)
    .set({ startingOrder })
    .where(eq(endlauf26Entries.id, entryId))
    .returning({ id: endlauf26Entries.id });
  if (res.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
