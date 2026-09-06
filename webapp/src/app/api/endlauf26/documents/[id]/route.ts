import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { deleteDocument, getDocument } from "@/lib/dal/endlauf26";

export const runtime = "nodejs";

/** Public: open a stored source PDF inline. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const doc = await getDocument(docId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const safeName = doc.filename.replace(/[^\w.\-]+/g, "_");
  return new NextResponse(new Uint8Array(doc.data), {
    headers: {
      "content-type": doc.mime,
      "content-length": String(doc.size),
      // The slot can be replaced by a new upload under the same id.
      "cache-control": "no-store",
      "content-disposition": `inline; filename="${safeName}"`,
    },
  });
}

/** Admin: remove a source PDF. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const ok = await deleteDocument(docId);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
