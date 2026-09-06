import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { getEndlaufEvent, importEndlaufResults } from "@/lib/dal/endlauf26";
import { parseResultImportItems } from "@/lib/endlauf26/import-results";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * OFFICIAL RESULTS, step 2: write the reviewed rows of a result list.
 *
 * `multipart/form-data`: `ageClass`, `items` (JSON array, see
 * `EndlaufResultImportItem`), optional `image` (the photo — stored as the
 * source of these rows). Rows of drivers already present for this event are
 * replaced, other rows stay (a list may span two photos). Drivers outside the
 * field become Nachrücker automatically.
 *
 * Does not require the event or class to be live; the class counts for the
 * championship as soon as rows exist.
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

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const ageClass = Number(form.get("ageClass"));
  if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }

  let rawItems: unknown;
  try {
    rawItems = JSON.parse(String(form.get("items") ?? ""));
  } catch {
    return NextResponse.json({ error: "invalid_items" }, { status: 400 });
  }
  const parsed = parseResultImportItems(rawItems);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  let image: { mime: string; data: Buffer } | null = null;
  const file = form.get("image");
  if (file instanceof Blob && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "image_too_large" }, { status: 413 });
    }
    image = {
      mime: ALLOWED_TYPES.has(file.type) ? file.type : "image/jpeg",
      data: Buffer.from(await file.arrayBuffer()),
    };
  }

  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const res = await importEndlaufResults(event, ageClass, parsed.items, image);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, ...res.outcome });
}
