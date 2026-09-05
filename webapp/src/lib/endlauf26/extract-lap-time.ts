/**
 * Second stage of the dictation pipeline: turn a free-form German transcript
 * ("zweiundvierzig Komma fünf, zwei Strafsekunden … Korrektur, die Zeit ist
 * einundvierzig Komma acht") into a structured lap time using an OpenAI chat
 * model with a strict JSON schema.
 *
 * Server-only (needs OPENAI_API_KEY). Throws on transport/model errors so the
 * caller can fall back to the regex parser in `dictation.ts`.
 */

export interface ExtractedLapTime {
  timeSeconds: number | null;
  penaltySeconds: number | null;
  /** Short explanation from the model (e.g. "Korrektur übernommen"). */
  note: string;
}

const DEFAULT_EXTRACT_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `Du extrahierst Kartslalom-Zeitansagen aus deutschen Sprachtranskripten.

Ein Zeitnehmer diktiert die Laufzeit eines Fahrers und optional Strafsekunden. Deine Aufgabe: die ENDGÜLTIGE Zeit und die ENDGÜLTIGEN Strafsekunden als JSON zurückgeben.

Regeln:
- timeSeconds: Laufzeit in Sekunden als Dezimalzahl (z. B. "zweiundvierzig Komma drei fünf" → 42.35, "42,8" → 42.8, "eine Minute zwölf Komma vier" → 72.4). Plausible Laufzeiten liegen zwischen 10 und 600 Sekunden. Wenn keine Zeit genannt wird: null.
- penaltySeconds: Strafsekunden als ganze Zahl. Formulierungen wie "zwei Strafsekunden", "plus zwei", "zwei Fehler", "zwei Pylonen", "zwei Tore" bedeuten penaltySeconds = 2. "keine Fehler", "ohne Strafe", "null Strafsekunden", "sauber" bedeuten 0. Wenn nichts zu Strafen gesagt wird: null.
- Korrekturen: Wenn der Sprecher sich korrigiert ("Korrektur", "nein", "stattdessen", "Moment", "ich meine", "die Zeit ist doch …"), gilt ausschließlich der ZULETZT genannte Wert für die jeweilige Größe. Eine Korrektur der Zeit ändert die Strafsekunden nicht und umgekehrt.
- Wenn nur eine Dezimalzahl und eine kleine ganze Zahl genannt werden ("42,35 2"), ist die Dezimalzahl die Zeit und die ganze Zahl die Strafsekunden.
- Ignoriere Füllwörter, Namen, Startnummern und alles, was keine Zeit oder Strafe ist.
- Erfinde nichts. Wenn das Transkript keine erkennbare Zeitansage enthält (z. B. Stille, Rauschen, wiederholte Phrasen), gib timeSeconds = null und penaltySeconds = null zurück.
- note: maximal ein kurzer deutscher Satz, z. B. "Korrektur der Zeit übernommen." oder "Keine Zeit erkannt.".`;

const RESPONSE_SCHEMA = {
  name: "lap_time",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      timeSeconds: { type: ["number", "null"] },
      penaltySeconds: { type: ["integer", "null"] },
      note: { type: "string" },
    },
    required: ["timeSeconds", "penaltySeconds", "note"],
  },
} as const;

export function getExtractModel(): string {
  return process.env.OPENAI_EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
}

export async function extractLapTime(
  transcript: string,
  apiKey: string,
): Promise<ExtractedLapTime> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: getExtractModel(),
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Transkript: "${transcript}"` },
      ],
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`extract_upstream_error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("extract_empty_response");
  }

  const parsed = JSON.parse(content) as Partial<ExtractedLapTime>;
  return sanitize(parsed);
}

function sanitize(raw: Partial<ExtractedLapTime>): ExtractedLapTime {
  let timeSeconds =
    typeof raw.timeSeconds === "number" && Number.isFinite(raw.timeSeconds)
      ? Math.round(raw.timeSeconds * 1000) / 1000
      : null;
  let penaltySeconds =
    typeof raw.penaltySeconds === "number" && Number.isFinite(raw.penaltySeconds)
      ? Math.round(raw.penaltySeconds)
      : null;

  // Same plausibility bounds as the regex parser.
  if (timeSeconds !== null && (timeSeconds < 10 || timeSeconds > 600)) timeSeconds = null;
  if (penaltySeconds !== null && (penaltySeconds < 0 || penaltySeconds > 200)) penaltySeconds = null;

  return {
    timeSeconds,
    penaltySeconds,
    note: typeof raw.note === "string" ? raw.note.slice(0, 200) : "",
  };
}
