import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveDataDir(scriptFile: string): string {
  const scriptDir = dirname(scriptFile);
  const candidates = [
    join(dirname(dirname(scriptDir)), "data"), // repo root when run from webapp/
    join(dirname(scriptDir), "data"), // /app/data in the production container
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "race-events.txt"))) return dir;
  }

  throw new Error(`DATA_DIR not found (tried: ${candidates.join(", ")})`);
}

export function readDataFile(dataDir: string, name: string): string[] {
  return readFileSync(join(dataDir, name), "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface ParsedDriver {
  ageClass: string;
  firstName: string;
  lastName: string;
  teamName: string;
  positions: number[];
}

const AGE_CLASS_RE = /^Altersklasse\s+[IVX]+$/;

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const nameParts = fullName.split(/\s+/);
  const lastName = nameParts.shift() ?? fullName;
  const firstName = nameParts.join(" ") || lastName;
  return { firstName, lastName };
}

function parseTeamAndPositions(teamRaw: string): {
  teamName: string;
  positions: number[];
} | null {
  const teamMatch = /^([^()]*?)\s*(?:\(([^)]*)\))?\s*$/.exec(teamRaw);
  if (!teamMatch) return null;
  const teamName = teamMatch[1].trim();
  const positionsRaw = (teamMatch[2] ?? "").trim();
  if (!teamName) return null;

  let positions: number[] = [];
  if (positionsRaw.length > 0) {
    positions = positionsRaw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  }
  while (positions.length < 6) positions.push(0);
  positions = positions.slice(0, 6);

  return { teamName, positions };
}

/** Correct parser: fields are separated by `" - "` (space-hyphen-space). */
export function parseDriverLineCorrect(rawLine: string): ParsedDriver | null {
  const parts = rawLine.split(" - ");
  if (parts.length < 3) return null;

  const ageClass = parts[0].trim();
  if (!AGE_CLASS_RE.test(ageClass)) return null;

  const fullName = parts[1].trim();
  const teamRaw = parts.slice(2).join(" - ").trim();
  if (!fullName || !teamRaw) return null;

  const parsed = parseTeamAndPositions(teamRaw);
  if (!parsed) return null;

  const { firstName, lastName } = splitFullName(fullName);
  return {
    ageClass,
    firstName,
    lastName,
    teamName: parsed.teamName,
    positions: parsed.positions,
  };
}

/**
 * Legacy parser that split on every `-`, which broke compound driver names like
 * `Peruga-Kaminska Emil` or `Jäger Jack-Leon`.
 */
export function parseDriverLineLegacy(rawLine: string): ParsedDriver | null {
  const parts = rawLine.split("-");
  if (parts.length < 4) return null;

  const ageClass = parts[0].trim();
  if (!AGE_CLASS_RE.test(ageClass)) return null;

  const fullName = parts[1].trim();
  const teamRaw = parts.slice(2).join("-").trim();
  if (!fullName || !teamRaw) return null;

  const parsed = parseTeamAndPositions(teamRaw);
  if (!parsed) return null;

  const { firstName, lastName } = splitFullName(fullName);
  return {
    ageClass,
    firstName,
    lastName,
    teamName: parsed.teamName,
    positions: parsed.positions,
  };
}

export function parseDrivers(dataDir: string): ParsedDriver[] {
  const lines = readDataFile(dataDir, "race-drivers.txt");
  const out: ParsedDriver[] = [];
  for (const line of lines) {
    const parsed = parseDriverLineCorrect(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseTeams(dataDir: string): string[] {
  return readDataFile(dataDir, "race-teams.txt");
}

export function normalizeTeamName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Lines where the legacy parser produced a different team than the correct one. */
export function findLegacyCorruption(dataDir: string): {
  rawLine: string;
  correct: ParsedDriver;
  legacy: ParsedDriver;
}[] {
  const lines = readDataFile(dataDir, "race-drivers.txt");
  const out: {
    rawLine: string;
    correct: ParsedDriver;
    legacy: ParsedDriver;
  }[] = [];

  for (const rawLine of lines) {
    const correct = parseDriverLineCorrect(rawLine);
    const legacy = parseDriverLineLegacy(rawLine);
    if (!correct || !legacy) continue;
    if (
      normalizeTeamName(correct.teamName) !== normalizeTeamName(legacy.teamName)
    ) {
      out.push({ rawLine, correct, legacy });
    }
  }
  return out;
}
