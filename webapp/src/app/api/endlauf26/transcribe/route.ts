import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { parseDictation } from "@/lib/endlauf26/dictation";
import { extractLapTime } from "@/lib/endlauf26/extract-lap-time";

export const runtime = "nodejs";

/**
 * Whisper's `prompt` is NOT an instruction — it is treated as preceding
 * transcript text and only steers spelling/vocabulary. Whenever Whisper hears
 * silence or noise it tends to echo the prompt back verbatim (that was the
 * "Beispiele 2,5. Beispiele 2,5." loop). Therefore the prompt must contain
 * domain vocabulary only and NO numbers: an echoed prompt then can never be
 * mistaken for a real lap time by the extraction stage.
 */
const WHISPER_STYLE_PROMPT =
  "Kartslalom Zeitnahme: Laufzeit in Sekunden mit Komma, dazu Strafsekunden, Fehler, Pylonen, Tore oder eine Korrektur.";

/** Uploads smaller than this cannot contain a spoken lap time. */
const MIN_AUDIO_BYTES = 1500;

/**
 * Dictate a lap time: accepts `multipart/form-data` with an `audio` file,
 * transcribes it with OpenAI Whisper, then asks a chat model to extract the
 * final time + penalty seconds as JSON (handles corrections like "Korrektur,
 * die Zeit ist …"). Falls back to the regex parser if the extraction call fails.
 *
 * Requires `OPENAI_API_KEY` (optionally `OPENAI_TRANSCRIBE_MODEL`, default
 * `whisper-1`, and `OPENAI_EXTRACT_MODEL`, default `gpt-4o-mini`).
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) return unauthorizedResponse();
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
  if (audio.size < MIN_AUDIO_BYTES) {
    return NextResponse.json({ error: "no_speech", reason: "audio_too_short" }, { status: 422 });
  }

  const model = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
  const isWhisper1 = model === "whisper-1";
  const upstream = new FormData();
  const fileName =
    (audio as File).name && (audio as File).name !== "blob"
      ? (audio as File).name
      : guessFileName(audio.type);
  upstream.append("file", audio, fileName);
  upstream.append("model", model);
  upstream.append("language", "de");
  upstream.append("temperature", "0");
  upstream.append("prompt", WHISPER_STYLE_PROMPT);
  // verbose_json gives per-segment no_speech_prob so we can reject silence.
  if (isWhisper1) upstream.append("response_format", "verbose_json");

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

  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    segments?: { no_speech_prob?: number; text?: string }[];
  };
  const text = (data.text ?? "").trim();

  const silence = detectSilence(text, data.segments);
  if (silence) {
    return NextResponse.json({ error: "no_speech", reason: silence, text }, { status: 422 });
  }

  // Stage 2: structured extraction (handles corrections, free-form phrasing).
  try {
    const extracted = await extractLapTime(text, apiKey);
    return NextResponse.json({
      ok: true,
      text,
      timeSeconds: extracted.timeSeconds,
      penaltySeconds: extracted.penaltySeconds,
      note: extracted.note,
      source: "llm",
    });
  } catch (err) {
    console.warn("[transcribe] extraction failed, falling back to regex parser:", err);
    const parsed = parseDictation(text);
    return NextResponse.json({
      ok: true,
      text,
      normalized: parsed.normalized,
      timeSeconds: parsed.timeSeconds,
      penaltySeconds: parsed.penaltySeconds,
      note: "",
      source: "regex",
    });
  }
}

/**
 * Returns a reason string when the transcript is most likely a Whisper
 * hallucination on silence/noise, else null.
 */
function detectSilence(
  text: string,
  segments: { no_speech_prob?: number; text?: string }[] | undefined,
): string | null {
  if (!text) return "empty_transcript";

  // 1. Whisper's own confidence that a segment contains no speech.
  if (segments && segments.length > 0) {
    const probs = segments
      .map((s) => s.no_speech_prob)
      .filter((p): p is number => typeof p === "number");
    if (probs.length > 0) {
      const avg = probs.reduce((a, b) => a + b, 0) / probs.length;
      if (avg > 0.6) return "no_speech_prob";
    }
  }

  // 2. Echo of our style prompt (Whisper repeats prompt text on silence):
  //    the whole transcript is a fragment of the prompt, or the prompt (with
  //    or without the leading label) is repeated.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const normPrompt = norm(WHISPER_STYLE_PROMPT);
  const normText = norm(text);
  if (normText.length >= 8 && normPrompt.includes(normText)) return "prompt_echo";
  const promptCore = norm(WHISPER_STYLE_PROMPT.replace(/^[^:]*:/, ""));
  if (promptCore.length > 12 && normText.split(promptCore).length - 1 >= 2) return "prompt_echo";

  // 3. Degenerate repetition ("Beispiele 2,5. Beispiele 2,5. …").
  const sentences = text.split(/[.!?]+/).map(norm).filter(Boolean);
  if (sentences.length >= 3) {
    const unique = new Set(sentences).size;
    if (unique / sentences.length <= 0.4) return "repetition";
  }

  return null;
}

function guessFileName(mime: string): string {
  if (mime.includes("webm")) return "audio.webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "audio.mp4";
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "audio.mp3";
  return "audio.webm";
}
