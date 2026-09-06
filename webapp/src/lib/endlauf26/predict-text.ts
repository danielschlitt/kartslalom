/**
 * Turn `PredictionFacts` into a short German paragraph using an OpenAI chat
 * model. Server-only (needs OPENAI_API_KEY).
 *
 * The model never sees the raw standings — only the pre-computed facts —
 * and is instructed to use nothing else. This keeps every number verifiable.
 */
import { createHash } from "node:crypto";
import { factsToPlainText, REALISTIC_SLACK, type PredictionFacts } from "./prediction";

const DEFAULT_MODEL = "gpt-5.6";

export function getPredictionModel(): string {
  return process.env.OPENAI_PREDICTION_MODEL?.trim() || DEFAULT_MODEL;
}

/** Fingerprint of everything the text depends on (facts + model + prompt version). */
export function predictionStateHash(facts: PredictionFacts, model: string): string {
  return createHash("sha1")
    .update(PROMPT_VERSION)
    .update(model)
    .update(JSON.stringify(facts))
    .digest("hex");
}

const PROMPT_VERSION = "v1";

const SYSTEM_PROMPT = `Du bist Streckensprecher beim Jugend-Kart-Slalom und erklärst Eltern und Fahrern in 2 bis 4 kurzen Sätzen auf Deutsch, was in der Meisterschaftswertung für einen Fahrer noch möglich ist.

Regeln:
- Verwende ausschließlich die gelieferten Fakten (JSON). Erfinde keine Zahlen, Namen oder Bedingungen. Rechne nichts selbst nach.
- Nenne Konkurrenten immer mit vollem Namen und ihrem aktuellen Platz, z. B. "Max Mustermann (2.)".
- Priorität: Meistertitel, dann Podium (Top 3). Ist das rechnerisch möglich (theoreticalBestRank ≤ 3), beschreibe die Bedingung anhand von rivalsAhead: eigener Sieg im verbleibenden Endlauf und der jeweilige Gegner erreicht dort nur Platz overtakeIfRivalAtOrWorse oder schlechter. Beispiel: "Kann noch Meister werden, wenn er Langgöns 2 gewinnt und Max Mustermann (1.) dort nicht besser als Dritter wird." Formuliere die Schwelle immer eindeutig ("Platz 3 oder schlechter", "nicht besser als Dritter"), nie mit "höchstens".
- Für den Titel müssen alle Gegner vor dem Fahrer überholt werden; für das Podium reicht es, so viele zu überholen, dass Platz 3 erreicht ist. Nenne dabei die Namen der entscheidenden Gegner. Gibt es mehrere verbleibende Endläufe, gilt die Schwelle für jeden davon.
- Ist overtakeIfRivalAtOrWorse gleich 1, reicht der eigene Sieg unabhängig vom Gegner. Ist es größer als classSize, ist der Gegner nur bei Nichtantritt zu überholen — nenne das als "praktisch uneinholbar". Ist es null, ist der Gegner nicht mehr einzuholen.
- Für Fahrer im Mittelfeld oder hinten: keine Titel- oder Podiumsfantasien. Nenne realistisch erreichbare Plätze (realisticBestRank) — dabei wird kein Gegner schlechter als ${REALISTIC_SLACK} Plätze unter seinem aktuellen Wertungsplatz erwartet (Feld realistic bei rivalsAhead). theoreticalBestRank darf als "rechnerisch" erwähnt werden, wenn er deutlich besser ist.
- Erwähne in einem Satz die Gefahr von hinten (threatsBehind / realisticWorstRank), falls vorhanden.
- hmj (dropRule=true): Das schlechteste Ergebnis ist ein Streichresultat — das ist in den Fakten bereits eingerechnet, nicht erklären, höchstens erwähnen.
- Ist der Fahrer abgemeldet (withdrawn), nicht gewertet (rank=null) oder sind keine Endläufe mehr offen (remainingEvents leer), sage das in einem Satz.
- Kein Markdown, keine Aufzählung, keine Überschrift. Nur Fließtext. Verwende das grammatische Geschlecht neutral oder anhand des Vornamens.`;

export class PredictTextError extends Error {
  constructor(
    public code: "upstream_unreachable" | "upstream_error" | "empty_response",
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export async function generatePredictionText(
  facts: PredictionFacts,
  apiKey: string,
  model: string = getPredictionModel(),
): Promise<string> {
  const userText = [
    "Fakten (JSON):",
    JSON.stringify(facts, null, 1),
    "",
    `Zur Orientierung, die Standardformulierung ohne KI: "${factsToPlainText(facts)}"`,
    "Formuliere die Einschätzung.",
  ].join("\n");

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: 1200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
      }),
    });
  } catch (err) {
    throw new PredictTextError("upstream_unreachable", String(err));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PredictTextError("upstream_error", detail.slice(0, 500), res.status);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new PredictTextError("empty_response", "no content");
  return text;
}
