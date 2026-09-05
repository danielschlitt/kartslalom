import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { raceEntries } from "@/db/schema";

export async function PATCH(
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
  const startingOrderRaw = body?.startingOrder;
  const startingOrder =
    startingOrderRaw === null || startingOrderRaw === ""
      ? null
      : Number(startingOrderRaw);

  if (
    startingOrder !== null &&
    (!Number.isFinite(startingOrder) || startingOrder < 0)
  ) {
    return NextResponse.json({ error: "invalid_value" }, { status: 400 });
  }

  const [updated] = await db
    .update(raceEntries)
    .set({ startingOrder })
    .where(eq(raceEntries.id, entryId))
    .returning();

  if (!updated)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
