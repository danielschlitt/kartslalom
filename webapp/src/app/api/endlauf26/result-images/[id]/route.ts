import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { deleteResultImage, getResultImage } from "@/lib/dal/endlauf26";

export const runtime = "nodejs";

/** Public: the stored photo of a result list. Immutable per id. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const imageId = Number(id);
  if (!Number.isInteger(imageId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const img = await getResultImage(imageId);
  if (!img) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(img.data), {
    headers: {
      "content-type": img.mime,
      "content-length": String(img.size),
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `inline; filename="ergebnisliste-${img.eventId}-klasse-${img.ageClass}-${img.id}.jpg"`,
    },
  });
}

/** Admin: delete a single photo. Result rows read from it stay (their image link is cleared). */
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
  const ok = await deleteResultImage(imageId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
