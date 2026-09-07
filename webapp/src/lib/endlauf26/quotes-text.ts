/**
 * Social-media quotes about the home club / home region, phrased by an
 * OpenAI chat model from `SubjectFacts`. Server-only (needs OPENAI_API_KEY).
 *
 * As with the driver predictions the model never sees raw standings — only
 * the pre-computed facts — and must not invent or recompute numbers. Every
 * quote is therefore verifiable against the tables on the same page.
 * `factsToQuotes` is the deterministic fallback (no key / API error).
 */
import { createHash } from "node:crypto";
import { getPredictionModel } from "./predict-text";
import type { SubjectFacts } from "./team-stats";

/** Same model as the driver predictions (`OPENAI_PREDICTION_MODEL`). */
export function getQuotesModel(): string {
  return getPredictionModel();
}

const PROMPT_VERSION = "v1";

/** Fingerprint of everything the quotes depend on (facts + model + prompt version). */
export function quotesStateHash(facts: SubjectFacts, model: string): string {
  return createHash("sha1")
    .update(PROMPT_VERSION)
    .update(model)
    .update(JSON.stringify(facts))
    .digest("hex");
}

/* ─────────────────────────── formatting helpers ─────────────────────────── */

export function pct(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} %`;
}

export function num(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(".", ",");
}

function forSubject(f: SubjectFacts): string {
  return f.kind === "team" ? `für ${f.subjectName}` : `für die Region ${f.subjectName}`;
}

function subjectShort(f: SubjectFacts): string {
  return f.kind === "team" ? f.subjectName : `Region ${f.subjectName}`;
}

/* ─────────────────────────── rule-based quotes ─────────────────────────── */

/**
 * Deterministic German quotes from the facts. Used without an API key and as
 * the "Standardformulierung" reference for the model.
 */
export function factsToQuotes(f: SubjectFacts): string[] {
  const out: string[] = [];
  const who = subjectShort(f);
  const fuer = forSubject(f);
  const standAfter =
    f.scoredEvents.length > 0 ? ` (Stand nach ${f.scoredEvents.join(" & ")})` : "";

  // Title
  if (f.classLeaders.subject > 0) {
    if (f.classLeaders.relativeMorePercent !== null && f.classLeaders.relativeMorePercent > 0) {
      out.push(
        `Wer ${fuer} fährt, wird mit ${pct(f.classLeaders.relativeMorePercent)} höherer Wahrscheinlichkeit ${f.titleName} – ${f.classLeaders.subject} von ${f.subjectDrivers} Fahrern führen aktuell ihre Klasse${standAfter}.`,
      );
    } else if (f.classLeaders.relativeMorePercent === null) {
      out.push(
        `Alle aktuellen Klassenführenden kommen ${f.kind === "team" ? "vom" : "aus der Region"} ${f.subjectName}: ${f.classLeaders.subject} von ${f.subjectDrivers} Fahrern stehen auf Platz 1${standAfter}.`,
      );
    } else {
      out.push(
        `${f.classLeaders.subject} Fahrer von ${who} führen aktuell ihre Klasse${standAfter}.`,
      );
    }
  }

  // Podium
  if (f.podium.subject > 0 && f.podium.relativeMorePercent !== null && f.podium.relativeMorePercent > 0) {
    out.push(
      `Wer ${fuer} fährt, steht mit ${pct(f.podium.relativeMorePercent)} höherer Wahrscheinlichkeit auf dem Podium (Platz 1–3 der Klasse): ${f.podium.subject} von ${f.subjectDrivers} Fahrern sind aktuell in den Top 3.`,
    );
  } else if (f.podium.subject > 0) {
    out.push(`${f.podium.subject} von ${f.subjectDrivers} Fahrern von ${who} stehen aktuell auf einem Podiumsplatz ihrer Klasse.`);
  }

  // DKM
  if (f.dkm && f.dkm.subject > 0) {
    if (f.dkm.factor !== null && f.dkm.factor > 1) {
      out.push(
        `Wer ${fuer} fährt, qualifiziert sich ${num(f.dkm.factor)}-mal so häufig für die Deutsche Kartslalom Meisterschaft der dmsj – ${f.dkm.subject} der ${f.dkm.spotsTotal} DKM-Startplätze gehen aktuell an ${who}.`,
      );
    } else {
      out.push(
        `${f.dkm.subject} der ${f.dkm.spotsTotal} Startplätze für die Deutsche Kartslalom Meisterschaft der dmsj gehen aktuell an ${who}.`,
      );
    }
  }

  // Fastest laps
  if (f.fastestLaps.total > 0) {
    out.push(
      `${pct(f.fastestLaps.percent)} der schnellsten Runden je Klasse (${f.fastestLaps.subject} von ${f.fastestLaps.total}) fuhr ${who}.`,
    );
  }
  if (f.fastestLapsWithPenalty.total > 0 && f.fastestLapsWithPenalty.subject !== f.fastestLaps.subject) {
    out.push(
      `Inklusive Strafsekunden: ${pct(f.fastestLapsWithPenalty.percent)} der besten Einzelläufe je Klasse (${f.fastestLapsWithPenalty.subject} von ${f.fastestLapsWithPenalty.total}) kommen von ${who}.`,
    );
  }

  // Movement
  if (f.movement.moversCount > 0) {
    const netTxt =
      f.movement.net > 0
        ? `${f.movement.net} Plätze gutgemacht`
        : f.movement.net < 0
          ? `${-f.movement.net} Plätze verloren`
          : "per Saldo keinen Platz verloren";
    out.push(
      `${who} hat in ${f.scoredEvents.join(" & ")} in der Meisterschaft ${netTxt} (${f.movement.gained} gewonnen, ${f.movement.lost} verloren, ${num(f.movement.netPerDriver)} pro Fahrer) – Platz ${f.movement.rankByNet} von ${f.groupCount} ${f.kind === "team" ? "Vereinen" : "Regionen"}.`,
    );
    if (f.bestClimber && f.bestClimber.delta > 0) {
      out.push(
        `Größter Aufsteiger von ${who}: ${f.bestClimber.name} (Klasse ${f.bestClimber.ageClass}) mit +${f.bestClimber.delta} Plätzen${f.bestClimber.rank ? ` – jetzt Platz ${f.bestClimber.rank}` : ""}.`,
      );
    }
  }

  // Share of field vs share of success
  if (f.endlaufPodiums.total > 0) {
    out.push(
      `${who} stellt ${pct(f.shareOfField)} des Fahrerfelds, aber ${pct(f.endlaufPodiums.percent)} der Endlauf-Podien (${f.endlaufPodiums.subject} von ${f.endlaufPodiums.total}).`,
    );
  }
  if (f.endlaufWins.subject > 0) {
    out.push(`${f.endlaufWins.subject} von ${f.endlaufWins.total} Endlauf-Siegen (${pct(f.endlaufWins.percent)}) gingen an ${who}.`);
  }

  // Penalties
  if (f.penalties.runsSubject > 0 && f.penalties.runsOthers > 0) {
    out.push(
      `Sauber unterwegs: ${pct(f.penalties.cleanRunPercentSubject)} der Wertungsläufe von ${who} waren fehlerfrei (Rest des Feldes: ${pct(f.penalties.cleanRunPercentOthers)}); im Schnitt ${num(f.penalties.avgPenaltyPerRunSubject)} Strafsekunden pro Lauf gegenüber ${num(f.penalties.avgPenaltyPerRunOthers)}.`,
    );
  }

  // Points
  out.push(
    `${who} liegt in der ${f.kind === "team" ? "Vereinswertung" : "Regionenwertung"} auf Platz ${f.rankByPoints} von ${f.groupCount} (Ø ${num(f.avgPointsSubject)} Punkte pro Fahrer, Rest des Feldes Ø ${num(f.avgPointsOthers)}).`,
  );

  return out;
}

/* ─────────────────────────────── OpenAI ─────────────────────────────── */

function systemPrompt(titleName: string): string {
  return `Du schreibst kurze, knackige Social-Media-Zitate (Deutsch) für einen Kartslalom-Verein bzw. eine Region über deren Abschneiden bei den Endläufen der Jugend-Kartslalom-Meisterschaft.

Regeln:
- Verwende ausschließlich die gelieferten Fakten (JSON). Erfinde keine Zahlen, Namen oder Ereignisse. Rechne nichts selbst nach – Prozentwerte, Faktoren und Anteile stehen fertig in den Fakten.
- Prozentwerte mit zwei Nachkommastellen und Komma (z. B. "42,86 %"), Faktoren wie "2,5-mal so häufig".
- Formuliere jedes Zitat so, dass es alleine steht (kein Bezug auf andere Zitate), 1 bis 2 Sätze, maximal ca. 220 Zeichen. Gerne mit Augenzwinkern, aber sachlich richtig; keine Abwertung anderer Vereine oder Regionen.
- Pflicht-Zitate (falls die Fakten es hergeben): (1) Wahrscheinlichkeit, ${titleName} zu werden (classLeaders.relativeMorePercent), (2) Wahrscheinlichkeit, auf dem Podium zu stehen (podium.relativeMorePercent), (3) DKM-Qualifikation (dkm.factor bzw. dkm.subject von dkm.spotsTotal) – nur wenn dkm nicht null, (4) Anteil der schnellsten Runden je Klasse (fastestLaps.percent), (5) gewonnene/verlorene Plätze in den Endläufen (movement.net, movement.gained, movement.lost, movement.netPerDriver) – erwähne Platz movement.rankByNet von groupCount.
- Danach 3 bis 5 weitere Zitate aus dem, was die Fakten sonst hergeben: größter Aufsteiger (bestClimber), Anteil am Fahrerfeld gegen Anteil an Podien/Siegen (shareOfField vs. endlaufPodiums/endlaufWins), fehlerfreie Läufe und Strafsekunden (penalties), Punkte pro Fahrer (avgPointsSubject vs. avgPointsOthers), Führende und DKM-Fahrer mit Namen (leaders, dkmDrivers), schnellste Runden mit Namen (fastestLapList).
- Ist relativeMorePercent null, gibt es im Rest des Feldes niemanden mit diesem Merkmal – formuliere das positiv ("alle …"). Ist ein Wert negativ oder 0, lass das Zitat weg oder finde eine ehrliche, positive Perspektive aus anderen Fakten.
- Nenne den Stand ("nach Langgöns 1" o. ä. aus scoredEvents) mindestens in einem Zitat, wenn openEvents nicht leer ist.
- Antworte NUR mit einem JSON-Objekt der Form {"quotes": ["…", "…"]} – ohne Markdown, ohne Erklärung.`;
}

export class QuotesTextError extends Error {
  constructor(
    public code: "upstream_unreachable" | "upstream_error" | "empty_response" | "bad_json",
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export async function generateQuotes(
  facts: SubjectFacts,
  apiKey: string,
  model: string = getQuotesModel(),
): Promise<string[]> {
  const userText = [
    "Fakten (JSON):",
    JSON.stringify(facts, null, 1),
    "",
    "Zur Orientierung die regelbasierten Standardformulierungen:",
    ...factsToQuotes(facts).map((q) => `- ${q}`),
    "",
    "Schreibe die Zitate.",
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
        max_completion_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(facts.titleName) },
          { role: "user", content: userText },
        ],
      }),
    });
  } catch (err) {
    throw new QuotesTextError("upstream_unreachable", String(err));
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new QuotesTextError("upstream_error", detail.slice(0, 500), res.status);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new QuotesTextError("empty_response", "no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new QuotesTextError("bad_json", text.slice(0, 200));
  }
  const quotes = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { quotes?: unknown }).quotes)
      ? (parsed as { quotes: unknown[] }).quotes
      : null;
  if (!quotes) throw new QuotesTextError("bad_json", text.slice(0, 200));
  const clean = quotes.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim());
  if (clean.length === 0) throw new QuotesTextError("empty_response", "no quotes");
  return clean;
}
