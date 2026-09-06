import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { getClassPool, getEndlaufEvent, getKnownClubs } from "@/lib/dal/endlauf26";
import { extractEndlaufResults } from "@/lib/endlauf26/extract-results";
import { ageClassName, ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";
import type { EndlaufOcrResponse } from "@/lib/endlauf26/results-types";
import { ExtractError } from "@/lib/ocr/extract-results-sheet";
import { matchRows } from "@/lib/ocr/match-entries";
import { formatDateDe } from "@/lib/utils";

export const runtime = "nodejs";

/** Client-side resizing keeps photos well below this; guards against raw uploads. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * OFFICIAL RESULTS, step 1: OCR a photographed result list of one age class.
 * `multipart/form-data` with `image` and `ageClass` (1–6). Proposes a driver
 * of the class pool (field + Nachrücker candidates) for every row and
 * returns the known clubs for the Ortsclub check. Nothing is written.
 *
 * No live state is required — lists can be imported whenever they exist.
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_api_key", message: "OPENAI_API_KEY ist nicht gesetzt." },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const ageClass = Number(form?.get("ageClass"));
  if (!(ENDLAUF26_AGE_CLASSES as readonly number[]).includes(ageClass)) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }
  const image = form?.get("image");
  if (!(image instanceof Blob) || image.size === 0) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }

  const event = await getEndlaufEvent(eventId);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [pool, knownClubs] = await Promise.all([
    getClassPool(event.championship, ageClass, eventId),
    getKnownClubs(event.championship),
  ]);

  const mime = ALLOWED_TYPES.has(image.type) ? image.type : "image/jpeg";
  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;

  try {
    const { sheet, model } = await extractEndlaufResults(
      dataUrl,
      {
        eventLabel: `Endlauf ${event.number}: ${event.name}${event.eventDate ? ` · ${formatDateDe(event.eventDate)}` : ""}`,
        ageClassLabel: ageClassName(ageClass),
        // Reading aid: the field first (it is sorted that way), then the pool.
        knownDrivers: pool.map((d) => `${d.lastName} ${d.firstName} (${d.teamName})`),
      },
      apiKey,
    );
    const matches = matchRows(
      sheet.rows.map((r) => ({
        lastName: r.lastName,
        firstName: r.firstName,
        team: r.team,
        startNumber: r.startPosition,
        adacId: r.adacId,
      })),
      pool.map((d) => ({
        entryId: d.driverId,
        firstName: d.firstName,
        lastName: d.lastName,
        teamName: d.teamName,
        startingOrder: d.startingOrder,
        adacId: d.adacId,
      })),
    ).map((m) => ({ driverId: m.entryId, score: m.score, kind: m.kind }));

    const body: EndlaufOcrResponse = { ok: true, sheet, matches, knownClubs, model };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ExtractError) {
      console.warn("[endlauf-ocr] extraction failed:", err.code, err.status, err.message);
      const status =
        err.code === "upstream_unreachable" || err.code === "upstream_error" ? 502 : 422;
      return NextResponse.json(
        { error: err.code, status: err.status, detail: err.message.slice(0, 500) },
        { status },
      );
    }
    console.error("[endlauf-ocr] unexpected error:", err);
    return NextResponse.json({ error: "ocr_failed", detail: String(err) }, { status: 500 });
  }
}
