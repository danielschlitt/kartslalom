/**
 * Endläufe 2026 — the final ADAC Hessen-Thüringen field
 * (`data/endlauf26/adac-hth_endlauf2026.csv`). Pure: no DB / React imports.
 *
 * The CSV is the single source of truth for who starts in the three ADAC
 * Endläufe. Semicolon-separated, no header, one driver per line:
 *
 *   1  age class (1–6)
 *   2  starting position of Endlauf 1 within the class
 *   3  name — "Nachname Vorname(n)"
 *   4  position in the regional championship — scored like one race via
 *      the points table (several drivers may share a position/points)
 *   5  club
 *   6  region (Nord / Süd / Ost)
 *   7  empty = qualified via the standings, "Nachrücker" = replacement driver
 */

export const ADAC_FIELD_CSV = "adac-hth_endlauf2026.csv";

export const ADAC_REGIONS = ["Nord", "Süd", "Ost"] as const;
export type AdacRegion = (typeof ADAC_REGIONS)[number];

export interface AdacFieldEntry {
  /** 1-based line number in the CSV (for messages). */
  line: number;
  ageClass: number;
  startPosition: number;
  /** Column 3 verbatim. */
  rawName: string;
  /** Heuristic split of column 3: first token = last name, rest = first name(s). */
  lastName: string;
  firstName: string;
  seasonPosition: number;
  /** Club after `canonicalClubName`. */
  club: string;
  /** Column 5 verbatim. */
  rawClub: string;
  region: AdacRegion;
  nachruecker: boolean;
}

/**
 * Club spellings of the CSV → the names already used in the database (from
 * the regional standings lists). Keeps every club a single team so the
 * team statistics do not split one club into two.
 */
const CLUB_ALIASES: Readonly<Record<string, string>> = {
  "AC Bensheim": "VfM/AC Bensheim",
  "VFM/AC Bensheim": "VfM/AC Bensheim",
  "VFM /AC Wetzlar": "VfM/AC Wetzlar",
  "VFM/AC Wetzlar": "VfM/AC Wetzlar",
  "VFM/MSC Affolterbach": "VfM/MSC Affolterbach",
  "AMSG Schalmstadt Frielendorf": "AMSG Schwalmstadt Frielendorf",
  "MSC Rodenstein": "MSC Rodenstein Fr.- Crumbach",
  "Scuderia Wiebaden": "Scuderia Wiesbaden",
};

export function canonicalClubName(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return CLUB_ALIASES[trimmed] ?? trimmed;
}

export class AdacFieldCsvError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(`${ADAC_FIELD_CSV}:${line}: ${message}`);
    this.name = "AdacFieldCsvError";
  }
}

function parseIntStrict(v: string, what: string, line: number, min: number, max: number): number {
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AdacFieldCsvError(line, `${what} "${v}" must be an integer ${min}–${max}`);
  }
  return n;
}

/** Parse the CSV text. Throws `AdacFieldCsvError` on the first malformed line. */
export function parseAdacFieldCsv(text: string): AdacFieldEntry[] {
  const out: AdacFieldEntry[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const cols = raw.split(";").map((c) => c.trim());
    if (cols.length !== 7) {
      throw new AdacFieldCsvError(line, `expected 7 columns, got ${cols.length}`);
    }
    const [cls, start, name, pos, club, region, flag] = cols;
    if (!name) throw new AdacFieldCsvError(line, "empty name");
    if (!club) throw new AdacFieldCsvError(line, "empty club");
    if (!(ADAC_REGIONS as readonly string[]).includes(region)) {
      throw new AdacFieldCsvError(line, `unknown region "${region}"`);
    }
    if (flag !== "" && flag !== "Nachrücker") {
      throw new AdacFieldCsvError(line, `column 7 must be empty or "Nachrücker", got "${flag}"`);
    }
    const tokens = name.split(/\s+/);
    out.push({
      line,
      ageClass: parseIntStrict(cls, "age class", line, 1, 6),
      startPosition: parseIntStrict(start, "starting position", line, 1, 999),
      rawName: name,
      lastName: tokens[0],
      firstName: tokens.slice(1).join(" "),
      seasonPosition: parseIntStrict(pos, "championship position", line, 1, 999),
      club: canonicalClubName(club),
      rawClub: club,
      region: region as AdacRegion,
      nachruecker: flag === "Nachrücker",
    });
  }

  // Starting positions must be unique and gap-free per class.
  const byClass = new Map<number, AdacFieldEntry[]>();
  for (const e of out) byClass.set(e.ageClass, [...(byClass.get(e.ageClass) ?? []), e]);
  for (const [ageClass, list] of byClass) {
    const seen = new Set<number>();
    for (const e of list) {
      if (seen.has(e.startPosition)) {
        throw new AdacFieldCsvError(
          e.line,
          `starting position ${e.startPosition} appears twice in class ${ageClass}`,
        );
      }
      seen.add(e.startPosition);
    }
    for (let p = 1; p <= list.length; p++) {
      if (!seen.has(p)) {
        throw new AdacFieldCsvError(list[0].line, `class ${ageClass} has no starting position ${p}`);
      }
    }
  }
  // The same name twice in one class would collapse into one driver row.
  for (const [ageClass, list] of byClass) {
    const names = new Map<string, AdacFieldEntry>();
    for (const e of list) {
      const key = `${e.rawName}|${e.club}`;
      const dup = names.get(key);
      if (dup) {
        throw new AdacFieldCsvError(e.line, `duplicate driver "${e.rawName}" in class ${ageClass} (line ${dup.line})`);
      }
      names.set(key, e);
    }
  }
  return out;
}
