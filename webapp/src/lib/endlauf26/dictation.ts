/**
 * Turn a transcribed German utterance into a lap time + optional penalty.
 *
 *   "42,35"                          → time 42.35
 *   "zweiundvierzig Komma drei fünf" → time 42.35
 *   "42,35 zwei Strafsekunden"       → time 42.35, penalty 2
 *   "41 Komma 8 keine Fehler"        → time 41.8, penalty 0
 *   "43,1 plus 4"                    → time 43.1, penalty 4
 *
 * Pure function — no React/DB imports.
 */

export interface DictationResult {
  timeSeconds: number | null;
  penaltySeconds: number | null;
  /** Normalised text the numbers were extracted from (for debugging/UI). */
  normalized: string;
}

const UNITS: Record<string, number> = {
  null: 0,
  ein: 1,
  eins: 1,
  eine: 1,
  einen: 1,
  zwei: 2,
  zwo: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fünfzehn: 15,
  fuenfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
};

const TENS: Record<string, number> = {
  zwanzig: 20,
  dreißig: 30,
  dreissig: 30,
  vierzig: 40,
  fünfzig: 50,
  fuenfzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  neunzig: 90,
};

/** Convert one German number word (0–999, e.g. "zweiundvierzig", "hundertfünf") to digits. */
function wordToNumber(word: string): number | null {
  const w = word.toLowerCase();
  if (w in UNITS) return UNITS[w];
  if (w in TENS) return TENS[w];

  let rest = w;
  let hundreds = 0;
  const hm = /^(ein|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)?hundert(.*)$/.exec(rest);
  if (hm) {
    hundreds = (hm[1] ? UNITS[hm[1]] : 1) * 100;
    rest = hm[2];
    if (rest === "") return hundreds;
  }
  if (rest in UNITS) return hundreds + UNITS[rest];
  if (rest in TENS) return hundreds + TENS[rest];
  const m = /^(ein|eins|zwei|zwo|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)und(zwanzig|dreißig|dreissig|vierzig|fünfzig|fuenfzig|sechzig|siebzig|achtzig|neunzig)$/.exec(rest);
  if (m) return hundreds + UNITS[m[1]] + TENS[m[2]];
  return null;
}

const PENALTY_WORDS =
  /(straf|fehler|pylon|pylone|pylonen|tor|tore|plus|zusatz|sekunden strafe|strafsek)/;
const ZERO_PENALTY = /(keine|ohne|null)\s+(fehler|straf\w*|pylon\w*)/;

/**
 * Normalise: lower-case, number words → digits, "komma"/"punkt" → ".",
 * "42,35" → "42.35", collapse whitespace.
 */
export function normalizeDictation(text: string): string {
  let s = text.toLowerCase().replace(/[!?;:]/g, " ");
  // decimal comma between digits
  s = s.replace(/(\d)\s*,\s*(\d)/g, "$1.$2");
  s = s.replace(/,/g, " ");
  // spoken decimal separator → marker token
  s = s.replace(/\b(komma|punkt)\b/g, " § ");
  const tokens = s
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const clean = tok.replace(/[.]+$/g, "");
      const n = wordToNumber(clean);
      return n === null ? tok : String(n);
    });

  // Join "42 § 3 5" → "42.35" and "42 § 35" → "42.35". After the marker we
  // take one number; if it was spoken digit by digit (single digits) we keep
  // absorbing single digits.
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (
      tok === "§" &&
      out.length > 0 &&
      /^\d+$/.test(out[out.length - 1]) &&
      i + 1 < tokens.length &&
      /^\d+$/.test(tokens[i + 1])
    ) {
      let frac = tokens[i + 1];
      let j = i + 2;
      if (frac.length === 1) {
        while (j < tokens.length && /^\d$/.test(tokens[j])) {
          frac += tokens[j];
          j += 1;
        }
      }
      out[out.length - 1] = `${out[out.length - 1]}.${frac}`;
      i = j - 1;
      continue;
    }
    if (tok === "§") continue;
    out.push(tok);
  }
  return out.join(" ").trim();
}

export function parseDictation(text: string): DictationResult {
  const normalized = normalizeDictation(text);
  const tokens = normalized.split(" ");

  let timeSeconds: number | null = null;
  let penaltySeconds: number | null = null;

  const zeroPenalty = ZERO_PENALTY.test(normalized);

  // Numbers with context
  const numbers: { value: number; isDecimal: boolean; idx: number }[] = [];
  tokens.forEach((tok, idx) => {
    const m = /^(\d+(?:\.\d+)?)(s|sek|sec)?$/.exec(tok);
    if (!m) return;
    numbers.push({ value: Number(m[1]), isDecimal: m[1].includes("."), idx });
  });

  // Penalty: a number adjacent (±2 tokens) to a penalty keyword.
  for (const n of numbers) {
    if (n.isDecimal) continue;
    const ctx = tokens.slice(Math.max(0, n.idx - 2), n.idx + 3).join(" ");
    if (PENALTY_WORDS.test(ctx) && !ZERO_PENALTY.test(ctx)) {
      penaltySeconds = n.value;
      break;
    }
  }

  // Time: first decimal number; else first number that isn't the penalty.
  const usedIdx = numbers.find((n) => n.value === penaltySeconds && !n.isDecimal)?.idx;
  const decimal = numbers.find((n) => n.isDecimal);
  if (decimal) {
    timeSeconds = decimal.value;
  } else {
    const first = numbers.find((n) => n.idx !== usedIdx);
    if (first) timeSeconds = first.value;
  }

  // Two plain integers without keyword: "42 2" → time 42, penalty 2.
  if (penaltySeconds === null && !zeroPenalty) {
    const rest = numbers.filter(
      (n) => n.value !== timeSeconds || n.isDecimal !== (decimal !== undefined),
    );
    const candidate = rest.find((n) => !n.isDecimal && n.idx !== decimal?.idx);
    if (candidate && timeSeconds !== null && candidate.idx !== numbers.find((n) => n.value === timeSeconds)?.idx) {
      penaltySeconds = candidate.value;
    }
  }

  if (zeroPenalty) penaltySeconds = 0;

  // Sanity: lap times are between 10 s and 10 min.
  if (timeSeconds !== null && (timeSeconds < 10 || timeSeconds > 600)) {
    timeSeconds = null;
  }
  if (penaltySeconds !== null && (penaltySeconds < 0 || penaltySeconds > 200)) {
    penaltySeconds = null;
  }

  return { timeSeconds, penaltySeconds, normalized };
}
