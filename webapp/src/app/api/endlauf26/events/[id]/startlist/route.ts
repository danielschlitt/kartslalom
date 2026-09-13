import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { deleteStartLists, getEndlaufEvent, importStartList } from "@/lib/dal/endlauf26";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";
import type { StartListImportItem } from "@/lib/endlauf26/startlist-types";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseItems(raw: unknown):
  | { ok: true; items: StartListImportItem[] }
  | { ok: false; error: "invalid_items" | "invalid_driver" | "duplicate_driver" | "invalid_position" } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "invalid_items" };
  const items: StartListImportItem[] = [];
  const seen = new Set<number>();
  for (const it of raw as Record<string, unknown>[]) {
    const driverId = Number(it?.driverId);
    if (!Number.isInteger(driverId)) return { ok: false, error: "invalid_driver" };
    if (seen.has(driverId)) return { ok: false, error: "duplicate_driver" };
    seen.add(driverId);
    const startPosition = Number(it?.startPosition);
    if (!Number.isInteger(startPosition) || startPosition < 1 || startPosition > 999) {
      return { ok: false, error: "invalid_position" };
    }
    items.push({ driverId, startPosition });
  }
  return { ok: true, items };
}

/**
 * START LIST, step 2: apply the reviewed rows of a start list photo.
 *
 * `multipart/form-data`: `ageClass`, `items` (JSON array of
 * `{ driverId, startPosition }`), `image` (the photo, required — it is the
 * document that fixes the order), optional `model`. The listed drivers get
 * their Startplatz as live start order; other drivers of the class keep
 * theirs (a list may span two photos). Drivers outside the field become
 * Nachrücker automatically. From now on the standings-based default order
 * is no longer applied to this class — delete the photos to go back to it.
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
  const parsed = parseItems(rawItems);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const file = form.get("image");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  const image = {
    mime: ALLOWED_TYPES.has(file.type) ? file.type : "image/jpeg",
    data: Buffer.from(await file.arrayBuffer()),
  };
  const modelRaw = form.get("model");
  const model = typeof modelRaw === "string" && modelRaw.trim() !== "" ? modelRaw.trim().slice(0, 80) : null;

  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const res = await importStartList(event, ageClass, parsed.items, image, model);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, ...res.outcome });
}

/**
 * START LIST: delete the start list photos of one class and fall back to the
 * default order (recomputed from the standing where that rule applies).
 * Body: `{ ageClass }`.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const ageClass = Number(body?.ageClass);
  if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }
  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const deleted = await deleteStartLists(event, ageClass);
  return NextResponse.json({ ok: true, ...deleted });
}
