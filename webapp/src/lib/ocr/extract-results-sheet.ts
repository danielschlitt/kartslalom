/**
 * OCR of a photographed Kart-Slalom result sheet (one age class) via an
 * OpenAI vision model with a strict JSON schema.
 *
 * Server-only (needs OPENAI_API_KEY). The sheet layouts differ between clubs,
 * so we describe the typical columns and let the model map whatever it sees
 * onto our fixed run model (Training / Lauf 1 / Lauf 2, each with time and
 * Strafsekunden). Afterwards we fill gaps from "Gesamt" columns and flag
 * inconsistencies so the admin sees what to double-check.
 */

import type { OcrRow, OcrRunValue, OcrSheet } from "./types";

const DEFAULT_VISION_MODEL = "gpt-5.6";

export function getVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
}

/**
 * `detail: "original"` (no resizing — best for OCR) exists from gpt-5.4 on;
 * older models only know low/high.
 */
export function detailFor(model: string): "original" | "high" {
  const m = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  if (!m) return "high";
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  if (major > 5 || (major === 5 && minor >= 4)) return "original";
  return "high";
}

const SYSTEM_PROMPT = `Du liest fotografierte Ergebnislisten (Zeittabellen) vom Jugend-Kart-Slalom (ADAC / hmj, Deutschland) und gibst den Tabelleninhalt als JSON zurück.

Eine Liste zeigt genau EINE Altersklasse. Typische Spalten (Namen variieren je Verein):
- Platz / Pl. / Rang → position
- Start-Nr. / St.-Nr. / Nr. → startNumber
- Name (Nachname) und Vorname → lastName, firstName. Steht nur eine Namensspalte da, trenne sinnvoll in Nachname und Vorname (deutsche Listen nennen meist zuerst den Nachnamen).
- Verein / Club / Ortsclub → team (wörtlich übernehmen, inkl. Kürzel wie "VFM/AC Bensheim")
- Verband / Bemerkung / Gast / DNF / a.W. → remark
- Ausw.-Nr., Jahrgang, Lizenz → ignorieren
- Training / Trainingslauf / Testlauf / T-Lauf → testTime / testPenalty
- 1. Lauf / Lauf 1 / WL1 → run1Time (Spalte "Zeit"), run1Penalty (Spalte "Fehler", "Fehler Sec", "Strafsek.", "Sek." oder "Pyl." = Strafsekunden als ganze Zahl), run1Total (falls je Lauf eine Spalte "Zeit + Fehler" / "Gesamt" existiert)
- 2. Lauf / Lauf 2 / WL2 → run2Time, run2Penalty, run2Total analog
- Gesamt / Zeit + Fehl.-Sec / Endzeit → total (Summe über beide Läufe; NICHT in run1Total/run2Total eintragen)
- Pkt. / Punkte → ignorieren

Regeln:
- Zahlen mit Komma sind Dezimalzahlen: "34,10" → 34.10. Laufzeiten liegen meist zwischen 15 und 200 Sekunden. Strafsekunden sind kleine ganze Zahlen (0–60); "-" oder leer bedeutet null, "0" bedeutet 0.
- Gib jede Fahrerzeile der Tabelle genau einmal aus, in der Reihenfolge der Liste. Kopfzeilen, Fußzeilen, Unterschriften und Uhrzeiten sind keine Fahrer.
- Erfinde nichts. Unleserliche oder fehlende Werte → null. Ein Wert, der als Zahl gelesen werden kann, aber unsicher ist, darf trotzdem eingetragen werden – erwähne die Unsicherheit dann kurz in notes.
- Eine Liste ohne Trainingsspalte → hasTestRun = false und alle testTime/testPenalty = null.
- Übernimm Namen so, wie sie geschrieben stehen (keine "Korrektur" auf bekannte Namen). Die mitgelieferte Fahrerliste dient nur als Lesehilfe bei schwer lesbaren Buchstaben.
- title: Überschrift der Liste (z. B. Veranstaltung/Datum), ageClassLabel: die Klassenbezeichnung auf dem Blatt (z. B. "Klasse V"), notes: höchstens zwei kurze deutsche Sätze zu Lesbarkeit oder Auffälligkeiten (leerer String, wenn nichts).`;

const RESPONSE_SCHEMA = {
  name: "kart_slalom_result_sheet",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: ["string", "null"] },
      ageClassLabel: { type: ["string", "null"] },
      hasTestRun: { type: "boolean" },
      notes: { type: "string" },
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            position: { type: ["integer", "null"] },
            startNumber: { type: ["integer", "null"] },
            lastName: { type: "string" },
            firstName: { type: "string" },
            team: { type: ["string", "null"] },
            remark: { type: ["string", "null"] },
            testTime: { type: ["number", "null"] },
            testPenalty: { type: ["integer", "null"] },
            run1Time: { type: ["number", "null"] },
            run1Penalty: { type: ["integer", "null"] },
            run1Total: { type: ["number", "null"] },
            run2Time: { type: ["number", "null"] },
            run2Penalty: { type: ["integer", "null"] },
            run2Total: { type: ["number", "null"] },
            total: { type: ["number", "null"] },
          },
          required: [
            "position",
            "startNumber",
            "lastName",
            "firstName",
            "team",
            "remark",
            "testTime",
            "testPenalty",
            "run1Time",
            "run1Penalty",
            "run1Total",
            "run2Time",
            "run2Penalty",
            "run2Total",
            "total",
          ],
        },
      },
    },
    required: ["title", "ageClassLabel", "hasTestRun", "notes", "rows"],
  },
} as const;

interface RawRow {
  position: number | null;
  startNumber: number | null;
  lastName: string;
  firstName: string;
  team: string | null;
  remark: string | null;
  testTime: number | null;
  testPenalty: number | null;
  run1Time: number | null;
  run1Penalty: number | null;
  run1Total: number | null;
  run2Time: number | null;
  run2Penalty: number | null;
  run2Total: number | null;
  total: number | null;
}

interface RawSheet {
  title: string | null;
  ageClassLabel: string | null;
  hasTestRun: boolean;
  notes: string;
  rows: RawRow[];
}

export interface ExtractContext {
  /** e.g. "#1 MSC Horlofftal · 26.04.2026" */
  eventLabel: string;
  /** e.g. "Altersklasse V" */
  ageClassLabel: string;
  /** Known drivers of that class as "Nachname Vorname (Verein)" — reading aid only. */
  knownDrivers: string[];
}

export type ExtractErrorCode =
  | "upstream_error"
  | "upstream_unreachable"
  | "empty_response"
  | "refusal";

export class ExtractError extends Error {
  code: ExtractErrorCode;
  status: number | undefined;

  constructor(code: ExtractErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
    this.status = status;
  }
}

/**
 * @param imageDataUrl `data:image/jpeg;base64,…`
 */
export async function extractResultsSheet(
  imageDataUrl: string,
  context: ExtractContext,
  apiKey: string,
): Promise<{ sheet: OcrSheet; model: string }> {
  const model = getVisionModel();

  const userText = [
    `Veranstaltung: ${context.eventLabel}`,
    `Erwartete Altersklasse: ${context.ageClassLabel}`,
    context.knownDrivers.length > 0
      ? `Bekannte Fahrer dieser Klasse (nur Lesehilfe, Liste kann weitere oder andere Fahrer enthalten):\n${context.knownDrivers.map((d) => `- ${d}`).join("\n")}`
      : "",
    "Lies die Tabelle auf dem Foto vollständig aus.",
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
        max_completion_tokens: 6000,
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
  return { sheet: normalizeSheet(raw), model };
}

/* ───────────────────────── post-processing ───────────────────────── */

const MIN_TIME = 5;
const MAX_TIME = 900;
const MAX_PENALTY = 200;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** 34.1 → "34,10" for German warning texts. */
function de(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

/**
 * Turn a (time, penalty, total) triple as read from the sheet into our run
 * value, deriving whichever of the three is missing and recording conflicts.
 */
function buildRun(
  label: string,
  timeRaw: unknown,
  penaltyRaw: unknown,
  totalRaw: unknown,
  warnings: string[],
): { run: OcrRunValue | null; total: number | null } {
  let time = num(timeRaw);
  let penalty = num(penaltyRaw);
  const total = num(totalRaw);

  if (penalty !== null) penalty = Math.round(penalty);

  if (time === null && total !== null) {
    // Only a combined column on the sheet.
    if (penalty !== null) time = round3(total - penalty);
    else {
      time = total;
      penalty = 0;
    }
  } else if (time !== null && penalty === null && total !== null) {
    const diff = round3(total - time);
    if (diff >= 0 && Math.abs(diff - Math.round(diff)) < 0.011) penalty = Math.round(diff);
    else warnings.push(`${label}: Zeit + Fehler ≠ Gesamt (${de(total)}).`);
  } else if (time !== null && penalty !== null && total !== null) {
    if (Math.abs(time + penalty - total) > 0.011) {
      warnings.push(`${label}: ${de(time)} + ${penalty} ≠ ${de(total)} laut Blatt.`);
    }
  }

  if (time !== null && (time < MIN_TIME || time > MAX_TIME)) {
    warnings.push(`${label}: unplausible Zeit ${de(time)}.`);
    time = null;
  }
  if (penalty !== null && (penalty < 0 || penalty > MAX_PENALTY)) {
    warnings.push(`${label}: unplausible Strafsekunden ${penalty}.`);
    penalty = null;
  }

  if (time === null && penalty === null) return { run: null, total };
  return {
    run: { timeSeconds: time === null ? null : round3(time), penaltySeconds: penalty },
    total: total ?? (time !== null ? round3(time + (penalty ?? 0)) : null),
  };
}

function normalizeRow(r: RawRow): OcrRow | null {
  const lastName = str(r.lastName);
  const firstName = str(r.firstName);
  if (lastName === "" && firstName === "") return null;

  const warnings: string[] = [];
  const test = buildRun("Training", r.testTime, r.testPenalty, null, warnings);
  const first = buildRun("Lauf 1", r.run1Time, r.run1Penalty, r.run1Total, warnings);
  const second = buildRun("Lauf 2", r.run2Time, r.run2Penalty, r.run2Total, warnings);

  const total = num(r.total);
  if (total !== null && first.total !== null && second.total !== null) {
    const sum = round3(first.total + second.total);
    if (Math.abs(sum - total) > 0.011) {
      // One of the three numbers was misread. We cannot tell which, but the
      // two alternatives (assuming "Gesamt" is right) make the fix a one-look job.
      const alt1 = round3(total - second.total - (first.run?.penaltySeconds ?? 0));
      const alt2 = round3(total - first.total - (second.run?.penaltySeconds ?? 0));
      warnings.push(
        `Gesamt ${de(total)} ≠ Lauf 1 + Lauf 2 (${de(sum)}). Falls Gesamt stimmt: Lauf 1 = ${de(alt1)} oder Lauf 2 = ${de(alt2)}.`,
      );
    }
  }

  const pos = num(r.position);
  const startNumber = num(r.startNumber);
  return {
    position: pos === null ? null : Math.round(pos),
    startNumber: startNumber === null ? null : Math.round(startNumber),
    lastName,
    firstName,
    team: strOrNull(r.team),
    remark: strOrNull(r.remark),
    runs: { test: test.run, first: first.run, second: second.run },
    total,
    warnings,
  };
}

export function normalizeSheet(raw: RawSheet): OcrSheet {
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .map(normalizeRow)
    .filter((r): r is OcrRow => r !== null);
  const anyTest = rows.some((r) => r.runs.test !== null);
  return {
    title: strOrNull(raw.title),
    ageClassLabel: strOrNull(raw.ageClassLabel),
    hasTestRun: Boolean(raw.hasTestRun) || anyTest,
    notes: str(raw.notes).slice(0, 400),
    rows,
  };
}
