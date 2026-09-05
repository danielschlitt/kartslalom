/**
 * Shared request handler for the "OCR a result sheet" endpoints of the regular
 * season and the Endläufe. The routes only load the candidates (entries of the
 * chosen class) and delegate here.
 */

import { NextResponse } from "next/server";
import { ExtractError, extractResultsSheet, type ExtractContext } from "./extract-results-sheet";
import { matchRows, type MatchCandidate } from "./match-entries";
import type { OcrResultsResponse } from "./types";

/** Client-side resizing keeps photos well below this; guards against raw uploads. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function handleSheetOcr(
  form: FormData | null,
  candidates: MatchCandidate[],
  context: Omit<ExtractContext, "knownDrivers">,
): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_api_key", message: "OPENAI_API_KEY ist nicht gesetzt." },
      { status: 503 },
    );
  }

  const image = form?.get("image");
  if (!(image instanceof Blob) || image.size === 0) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  const mime = ALLOWED_TYPES.has(image.type) ? image.type : "image/jpeg";
  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;

  try {
    const { sheet, model } = await extractResultsSheet(
      dataUrl,
      {
        ...context,
        knownDrivers: candidates.map((c) => `${c.lastName} ${c.firstName} (${c.teamName})`),
      },
      apiKey,
    );
    const matches = matchRows(
      sheet.rows.map((r) => ({
        lastName: r.lastName,
        firstName: r.firstName,
        team: r.team,
        startNumber: r.startNumber,
      })),
      candidates,
    );
    const body: OcrResultsResponse = { ok: true, sheet, matches, model };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof ExtractError) {
      console.warn("[sheet-ocr] extraction failed:", err.code, err.status, err.message);
      const status =
        err.code === "upstream_unreachable" || err.code === "upstream_error" ? 502 : 422;
      return NextResponse.json(
        { error: err.code, status: err.status, detail: err.message.slice(0, 500) },
        { status },
      );
    }
    console.error("[sheet-ocr] unexpected error:", err);
    return NextResponse.json({ error: "ocr_failed", detail: String(err) }, { status: 500 });
  }
}
