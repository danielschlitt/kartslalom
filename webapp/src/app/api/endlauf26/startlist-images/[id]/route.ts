import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { deleteStartListImage, getStartList } from "@/lib/dal/endlauf26";

export const runtime = "nodejs";

/** Public: the stored photo of a start list. Immutable per id. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const imageId = Number(id);
  if (!Number.isInteger(imageId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const img = await getStartList(imageId);
  if (!img) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(img.data), {
    headers: {
      "content-type": img.mime,
      "content-length": String(img.size),
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `inline; filename="startliste-${img.eventId}-klasse-${img.ageClass}-${img.id}.jpg"`,
    },
  });
}

/**
 * Admin: delete a single start list photo. The start orders read from it
 * stay; once the last photo of a class is gone the class follows the
 * default order again on the next sync (use DELETE …/events/[id]/startlist
 * to fall back immediately).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const imageId = Number(id);
  if (!Number.isInteger(imageId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const ok = await deleteStartListImage(imageId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
