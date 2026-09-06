/**
 * OCR of a photographed Endlauf result list (one age class) via an OpenAI
 * vision model with a strict JSON schema.
 *
 * Server-only (needs OPENAI_API_KEY). Unlike the regular-season sheets the
 * Endlauf lists have a known, rich column set (hmj): Platz, Startplatz, Name,
 * ADAC Ortsclub, Ausweis-Nr., Wertung (D/M), Training, 1. Lauf Zeit/Fehler,
 * 2. Lauf Zeit/Fehler, Gesamt Fehler, Gesamtzeit, ADAC Punkte. Every printed
 * value is returned as-is; plausibility is checked afterwards
 * (`result-checks.ts`) and nothing is ever "corrected" automatically.
 */

import { ExtractError } from "@/lib/ocr/extract-results-sheet";
import type { EndlaufSheet, EndlaufSheetRow } from "./results-types";

const DEFAULT_VISION_MODEL = "gpt-5.6";

function getVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
}

/** `detail: "original"` exists from gpt-5.4 on; older models only know low/high. */
function detailFor(model: string): "original" | "high" {
  const m = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  if (!m) return "high";
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  if (major > 5 || (major === 5 && minor >= 4)) return "original";
  return "high";
}

const SYSTEM_PROMPT = `Du liest fotografierte offizielle Ergebnislisten der Endläufe im Jugend-Kart-Slalom (hmj / ADAC Hessen-Thüringen, Deutschland) und gibst den Tabelleninhalt als JSON zurück.

Eine Liste zeigt genau EINE Altersklasse. Die Spalten (Bezeichnungen können leicht abweichen, die Reihenfolge ist meist so):
- Platz / Pl. / Rang → position (die offizielle Platzierung — exakt so übernehmen, wie sie steht)
- Startplatz / Start-Nr. / St.-Pl. / Nr. → startPosition
- Name: Nachname und Vorname → lastName, firstName. Steht nur eine Namensspalte da, trenne sinnvoll (deutsche Listen nennen meist zuerst den Nachnamen).
- ADAC Ortsclub / Ortsclub / Verein / Club → team (wörtlich übernehmen, inkl. Kürzel wie "VfM/AC Bensheim")
- Ausweis-Nr. / Ausw.-Nr. / Ausweis → adacId (als Zeichenkette, genau wie gedruckt)
- Wertung / W. → wertung: "D" (Damen) oder "M" (Herren); sonst der gedruckte Buchstabe
- Training / Trainingslauf / Tr. → testTime (zählt nicht für die Platzierung)
- 1. Lauf: Spalte "Zeit" → run1Time, Spalte "Fehler" / "Strafsek." / "Fehler Sec." → run1Penalty (Strafsekunden als ganze Zahl)
- 2. Lauf: analog run2Time, run2Penalty
- Gesamt Fehler / Fehler gesamt / Ges. Fehler → totalPenalty (Summe der Strafsekunden beider Läufe)
- Gesamtzeit / Gesamt / Endzeit → totalTime (1. Lauf + Fehler + 2. Lauf + Fehler)
- ADAC Punkte / Punkte / Pkt. → points (ganze Zahl)
- Bemerkung / DNF / DNS / a.W. / n.a. → remark

Regeln:
- Zahlen mit Komma sind Dezimalzahlen: "34,10" → 34.10. Laufzeiten liegen meist zwischen 15 und 200 Sekunden, Gesamtzeiten zwischen 30 und 400. Strafsekunden sind kleine ganze Zahlen (0–60); "-" oder leer bedeutet null, "0" bedeutet 0.
- Gib jede Fahrerzeile der Tabelle genau einmal aus, in der Reihenfolge der Liste. Kopfzeilen, Fußzeilen, Unterschriften und Uhrzeiten sind keine Fahrer.
- Erfinde nichts. Unleserliche oder fehlende Werte → null. Ein Wert, der als Zahl gelesen werden kann, aber unsicher ist, darf trotzdem eingetragen werden – erwähne die Unsicherheit dann kurz in notes.
- Übernimm Namen, Vereine und Ausweisnummern so, wie sie geschrieben stehen (keine "Korrektur" auf bekannte Namen). Die mitgelieferte Fahrerliste dient nur als Lesehilfe bei schwer lesbaren Buchstaben.
- Rechne nichts nach und ändere keine Reihenfolge: Die Liste ist die Wahrheit, Prüfungen passieren später.
- title: Überschrift der Liste (z. B. Veranstaltung/Datum), ageClassLabel: die Klassenbezeichnung auf dem Blatt (z. B. "Klasse 3"), notes: höchstens zwei kurze deutsche Sätze zu Lesbarkeit oder Auffälligkeiten (leerer String, wenn nichts).`;

const RESPONSE_SCHEMA = {
  name: "endlauf_result_list",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: ["string", "null"] },
      ageClassLabel: { type: ["string", "null"] },
      notes: { type: "string" },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            position: { type: ["integer", "null"] },
            startPosition: { type: ["integer", "null"] },
            lastName: { type: "string" },
            firstName: { type: "string" },
            team: { type: ["string", "null"] },
            adacId: { type: ["string", "null"] },
            wertung: { type: ["string", "null"] },
            testTime: { type: ["number", "null"] },
            run1Time: { type: ["number", "null"] },
            run1Penalty: { type: ["integer", "null"] },
            run2Time: { type: ["number", "null"] },
            run2Penalty: { type: ["integer", "null"] },
            totalPenalty: { type: ["integer", "null"] },
            totalTime: { type: ["number", "null"] },
            points: { type: ["integer", "null"] },
            remark: { type: ["string", "null"] },
          },
          required: [
            "position",
            "startPosition",
            "lastName",
            "firstName",
            "team",
            "adacId",
            "wertung",
            "testTime",
            "run1Time",
            "run1Penalty",
            "run2Time",
            "run2Penalty",
            "totalPenalty",
            "totalTime",
            "points",
            "remark",
          ],
        },
      },
    },
    required: ["title", "ageClassLabel", "notes", "rows"],
  },
} as const;

interface RawSheet {
  title: string | null;
  ageClassLabel: string | null;
  notes: string;
  rows: Partial<EndlaufSheetRow>[];
}

export interface EndlaufExtractContext {
  /** e.g. "Endlauf 1: Langgöns 1 · 26.09.2026" */
  eventLabel: string;
  /** e.g. "Klasse 3" */
  ageClassLabel: string;
  /** Known drivers of that class as "Nachname Vorname (Verein)" — reading aid only. */
  knownDrivers: string[];
}

/**
 * @param imageDataUrl `data:image/jpeg;base64,…`
 */
export async function extractEndlaufResults(
  imageDataUrl: string,
  context: EndlaufExtractContext,
  apiKey: string,
): Promise<{ sheet: EndlaufSheet; model: string }> {
  const model = getVisionModel();

  const userText = [
    `Veranstaltung: ${context.eventLabel}`,
    `Erwartete Altersklasse: ${context.ageClassLabel}`,
    context.knownDrivers.length > 0
      ? `Bekannte Fahrer dieser Klasse (nur Lesehilfe, Liste kann weitere oder andere Fahrer enthalten):\n${context.knownDrivers.map((d) => `- ${d}`).join("\n")}`
      : "",
    "Lies die Ergebnisliste auf dem Foto vollständig aus.",
  ]
    .filter(Boolean)
    .join("\n\n");

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
        max_completion_tokens: 8000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              {
                type: "image_url",
                image_url: { url: imageDataUrl, detail: detailFor(model) },
              },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
      }),
    });
  } catch (err) {
    throw new ExtractError("upstream_unreachable", String(err));
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ExtractError("upstream_error", detail.slice(0, 500), res.status);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  };
  const msg = data.choices?.[0]?.message;
  if (msg?.refusal) throw new ExtractError("refusal", msg.refusal);
  if (!msg?.content) throw new ExtractError("empty_response", "no content");

  const raw = JSON.parse(msg.content) as RawSheet;
  return { sheet: normalizeEndlaufSheet(raw), model };
}

/* ───────────────────────── normalisation ───────────────────────── */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

function round3(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1000) / 1000;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

function wertung(v: unknown): string | null {
  const s = str(v).toUpperCase();
  if (s === "") return null;
  if (s.startsWith("D") || s.startsWith("W")) return "D";
  if (s.startsWith("M") || s.startsWith("H")) return "M";
  return s;
}

export function normalizeEndlaufSheet(raw: RawSheet): EndlaufSheet {
  const rows: EndlaufSheetRow[] = (Array.isArray(raw.rows) ? raw.rows : [])
    .map((r): EndlaufSheetRow | null => {
      const lastName = str(r.lastName);
      const firstName = str(r.firstName);
      if (lastName === "" && firstName === "") return null;
      return {
        position: int(r.position),
        startPosition: int(r.startPosition),
        lastName,
        firstName,
        team: strOrNull(r.team),
        adacId: strOrNull(r.adacId),
        wertung: wertung(r.wertung),
        testTime: round3(num(r.testTime)),
        run1Time: round3(num(r.run1Time)),
        run1Penalty: int(r.run1Penalty),
        run2Time: round3(num(r.run2Time)),
        run2Penalty: int(r.run2Penalty),
        totalPenalty: int(r.totalPenalty),
        totalTime: round3(num(r.totalTime)),
        points: int(r.points),
        remark: strOrNull(r.remark),
      };
    })
    .filter((r): r is EndlaufSheetRow => r !== null);
  return {
    title: strOrNull(raw.title),
    ageClassLabel: strOrNull(raw.ageClassLabel),
    notes: str(raw.notes).slice(0, 400),
    rows,
  };
}
