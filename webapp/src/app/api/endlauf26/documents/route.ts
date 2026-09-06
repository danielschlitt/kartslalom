import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { upsertDocument } from "@/lib/dal/endlauf26";
import { DOCUMENT_MAX_BYTES, documentSlot } from "@/lib/endlauf26/documents";
import { championshipFromSlug } from "@/lib/endlauf26/ranking";

export const runtime = "nodejs";

/**
 * Admin: upload / replace a source PDF (the standings list a championship's
 * driver data comes from). `multipart/form-data`: `championship` (slug),
 * `key` (slot, see ENDLAUF26_DOCUMENT_SLOTS), `file`.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const championship = championshipFromSlug(String(form.get("championship") ?? ""));
  if (!championship) {
    return NextResponse.json({ error: "invalid_championship" }, { status: 400 });
  }
  const key = String(form.get("key") ?? "");
  const slot = documentSlot(championship, key);
  if (!slot) return NextResponse.json({ error: "invalid_key" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return NextResponse.json({ error: "not_a_pdf" }, { status: 400 });

  const id = await upsertDocument({
    championship,
    key,
    filename: file.name.slice(0, 200) || `${key}.pdf`,
    mime: "application/pdf",
    data: Buffer.from(await file.arrayBuffer()),
  });
  return NextResponse.json({ ok: true, id });
}
