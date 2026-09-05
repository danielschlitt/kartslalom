import { NextRequest, NextResponse } from "next/server";
import { parseDictation } from "@/lib/endlauf26/dictation";

export const runtime = "nodejs";

/**
 * Dictate a lap time: accepts `multipart/form-data` with an `audio` file,
 * transcribes it with OpenAI Whisper and extracts time + penalty seconds.
 *
 * Requires `OPENAI_API_KEY` (optionally `OPENAI_TRANSCRIBE_MODEL`, default
 * `whisper-1`).
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_api_key", message: "OPENAI_API_KEY ist nicht gesetzt." },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "missing_audio" }, { status: 400 });
  }

  const model = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
  const upstream = new FormData();
  const fileName =
    (audio as File).name && (audio as File).name !== "blob"
      ? (audio as File).name
      : guessFileName(audio.type);
  upstream.append("file", audio, fileName);
  upstream.append("model", model);
  upstream.append("language", "de");
  upstream.append("temperature", "0");
  upstream.append(
    "prompt",
    "Kartslalom Zeitansage. Zeit in Sekunden mit Komma, danach Strafsekunden. Beispiele: 42,35. 41,80 zwei Strafsekunden. 55,2 keine Fehler.",
  );
  if (model === "whisper-1") upstream.append("response_format", "json");

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "upstream_unreachable", message: String(err) },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "upstream_error", status: res.status, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  const data = (await res.json().catch(() => ({}))) as { text?: string };
  const text = (data.text ?? "").trim();
  const parsed = parseDictation(text);

  return NextResponse.json({
    ok: true,
    text,
    normalized: parsed.normalized,
    timeSeconds: parsed.timeSeconds,
    penaltySeconds: parsed.penaltySeconds,
  });
}

function guessFileName(mime: string): string {
  if (mime.includes("webm")) return "audio.webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "audio.mp4";
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "audio.mp3";
  return "audio.webm";
}
