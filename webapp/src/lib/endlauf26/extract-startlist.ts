/**
 * OCR of a photographed Endlauf start list (Startaufstellung of one age
 * class) via an OpenAI vision model with a strict JSON schema.
 *
 * Server-only (needs OPENAI_API_KEY). The start list is the same sheet as
 * the result list — Startplatz, Name, ADAC Ortsclub, Ausweis-Nr., Wertung —
 * just without times. Only the order matters: every row is returned as
 * printed, in the printed order; the Startplatz column is taken when
 * present, otherwise the row order is used later.
 */

import { detailFor, ExtractError, getVisionModel } from "@/lib/ocr/extract-results-sheet";
import type { StartListSheet, StartListSheetRow } from "./startlist-types";

const SYSTEM_PROMPT = `Du liest fotografierte Startlisten (Startaufstellungen) der Endläufe im Jugend-Kart-Slalom (hmj / ADAC Hessen-Thüringen, Deutschland) und gibst den Tabelleninhalt als JSON zurück.

Eine Startliste zeigt genau EINE Altersklasse und entspricht der späteren Ergebnisliste, nur ohne Zeiten: Die Zeilen stehen in Startreihenfolge. Typische Spalten (Bezeichnungen können abweichen, Zeit-/Fehler-/Punktespalten sind leer oder fehlen):
- Startplatz / Start-Nr. / St.-Pl. / Nr. / Pos. → startPosition (ganze Zahl, wie gedruckt; fehlt eine solche Spalte → null)
- Name: Nachname und Vorname → lastName, firstName. Steht nur eine Namensspalte da, trenne sinnvoll (deutsche Listen nennen meist zuerst den Nachnamen).
- ADAC Ortsclub / Ortsclub / Verein / Club → team (wörtlich übernehmen, inkl. Kürzel wie "VfM/AC Bensheim")
- Ausweis-Nr. / Ausw.-Nr. / Ausweis → adacId (als Zeichenkette, genau wie gedruckt)
- Wertung / W. → wertung: "D" (Damen) oder "M" (Herren); sonst der gedruckte Buchstabe
- Bemerkung / Nachrücker / Gast / n. a. → remark
- Platz, Training, Laufzeiten, Fehler, Gesamtzeit, Punkte → ignorieren (auch wenn Werte darin stehen)

Regeln:
- Gib jede Fahrerzeile der Tabelle genau einmal aus, in der Reihenfolge der Liste (von oben nach unten). Kopfzeilen, Fußzeilen, Unterschriften und Uhrzeiten sind keine Fahrer.
- Erfinde nichts. Unleserliche oder fehlende Werte → null. Eine handschriftlich durchgestrichene Zeile bleibt erhalten, vermerke "gestrichen" in remark; handschriftlich ergänzte Zeilen gehören an die Stelle, an der sie stehen.
- Übernimm Namen, Vereine und Ausweisnummern so, wie sie geschrieben stehen (keine "Korrektur" auf bekannte Namen). Die mitgelieferte Fahrerliste dient nur als Lesehilfe bei schwer lesbaren Buchstaben.
- Ändere keine Reihenfolge und rechne nichts um: Die Liste ist die Wahrheit.
- title: Überschrift der Liste (z. B. Veranstaltung/Datum), ageClassLabel: die Klassenbezeichnung auf dem Blatt (z. B. "Klasse 3"), notes: höchstens zwei kurze deutsche Sätze zu Lesbarkeit oder Auffälligkeiten (leerer String, wenn nichts).`;

const RESPONSE_SCHEMA = {
  name: "endlauf_start_list",
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
            startPosition: { type: ["integer", "null"] },
            lastName: { type: "string" },
            firstName: { type: "string" },
            team: { type: ["string", "null"] },
            adacId: { type: ["string", "null"] },
            wertung: { type: ["string", "null"] },
            remark: { type: ["string", "null"] },
          },
          required: ["startPosition", "lastName", "firstName", "team", "adacId", "wertung", "remark"],
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
  rows: Partial<StartListSheetRow>[];
}

export interface StartListExtractContext {
  /** e.g. "Endlauf 2: Reinheim · 20.09.2026" */
  eventLabel: string;
  /** e.g. "Klasse 3" */
  ageClassLabel: string;
  /** Known drivers of that class as "Nachname Vorname (Verein)" — reading aid only. */
  knownDrivers: string[];
}

/**
 * @param imageDataUrl `data:image/jpeg;base64,…`
 */
export async function extractStartList(
  imageDataUrl: string,
  context: StartListExtractContext,
  apiKey: string,
): Promise<{ sheet: StartListSheet; model: string }> {
  const model = getVisionModel();

  const userText = [
    `Veranstaltung: ${context.eventLabel}`,
    `Erwartete Altersklasse: ${context.ageClassLabel}`,
    context.knownDrivers.length > 0
      ? `Bekannte Fahrer dieser Klasse (nur Lesehilfe, Liste kann weitere oder andere Fahrer enthalten):\n${context.knownDrivers.map((d) => `- ${d}`).join("\n")}`
      : "",
    "Lies die Startliste auf dem Foto vollständig aus.",
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
  return { sheet: normalizeStartListSheet(raw), model };
}

/* ───────────────────────── normalisation ───────────────────────── */

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
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

export function normalizeStartListSheet(raw: RawSheet): StartListSheet {
  const rows: StartListSheetRow[] = (Array.isArray(raw.rows) ? raw.rows : [])
    .map((r): StartListSheetRow | null => {
      const lastName = str(r.lastName);
      const firstName = str(r.firstName);
      if (lastName === "" && firstName === "") return null;
      return {
        startPosition: int(r.startPosition),
        lastName,
        firstName,
        team: strOrNull(r.team),
        adacId: strOrNull(r.adacId),
        wertung: wertung(r.wertung),
        remark: strOrNull(r.remark),
      };
    })
    .filter((r): r is StartListSheetRow => r !== null);
  return {
    title: strOrNull(raw.title),
    ageClassLabel: strOrNull(raw.ageClassLabel),
    notes: str(raw.notes).slice(0, 400),
    rows,
  };
}
