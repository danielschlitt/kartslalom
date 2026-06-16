import "server-only";

import {
  bestFinishPosition,
  computeChampionship,
  computeChampionshipProgression,
  countPodiumFinishes,
  type ChampionshipRow,
  type DriverChampionshipInput,
  type Series,
} from "@/lib/ranking";
import {
  getChampionshipDrivers,
  seriesRaceNumbers,
} from "@/lib/dal/races";

const POINTS_PER_RACE = 40;

export interface DriverChartLine {
  driverId: number;
  name: string;
  cumulativeRanks: (number | null)[];
}

/**
 * One marker per race for the driver's own per-race finish:
 * - number → finish position
 * - "missed" → race happened but the driver did not start
 * - null → no data (race wasn't run yet / not finalized for the class)
 */
export type FinishMarker = number | "missed" | null;

export interface DriverChartData {
  series: Series;
  seriesLabel: string;
  ageClassName: string;
  raceNumbers: number[];
  driverCount: number;
  driver: DriverChartLine & {
    finishPositions: FinishMarker[];
  };
  /** Up to two drivers in front; index 0 = directly ahead, 1 = two places ahead. */
  ahead: DriverChartLine[];
  /** Up to two drivers behind; index 0 = directly behind, 1 = two places behind. */
  behind: DriverChartLine[];
}

export interface DriverSeriesStats {
  /** Championship rank without Streichergebnisse (every race counts). */
  rank: number | null;
  /** Championship rank as published with Streichergebnisse applied. */
  rankWithDrops: number | null;
  points: number;
  startedRaces: number;
  maxPoints: number;
}

export interface DriverBirthYearStats {
  /** Championship rank within the birth-year cohort, without Streichergebnisse. */
  rank: number | null;
  driverCount: number;
}

export interface DriverDetails {
  driverId: number;
  firstName: string;
  lastName: string;
  adacId: string | null;
  yearOfBirth: number | null;
  teamId: number;
  teamName: string;
  ageClassId: number;
  ageClassName: string;
  ageClassDriverCount: number;
  hts: DriverSeriesStats;
  hmj: DriverSeriesStats;
  birthYear: { hts: DriverBirthYearStats; hmj: DriverBirthYearStats };
  bestFinish: number | null;
  wins: number;
  seconds: number;
  thirds: number;
  chart: {
    hts: DriverChartData;
    hmj: DriverChartData;
    birthYear: DriverChartData | null;
  };
}

const SERIES_LABEL: Record<Series, string> = {
  hts: "Hessen-Thüringen Süd",
  hmj: "HMJ",
};

function driverDisplayName(
  d: Pick<DriverChampionshipInput, "firstName" | "lastName">,
): string {
  return `${d.lastName} ${d.firstName}`;
}

function buildSeriesStats(
  rowNoDrops: ChampionshipRow | undefined,
  rowWithDrops: ChampionshipRow | undefined,
  driver: DriverChampionshipInput,
  series: Series,
): DriverSeriesStats {
  const raceNumbers = seriesRaceNumbers(series);
  const seriesResults = driver.results.filter((r) =>
    raceNumbers.includes(r.raceNumber),
  );
  const startedRaces = seriesResults.filter((r) => r.participated).length;
  // Points, max and the primary rank are reported without Streichergebnisse so
  // every race counts equally. The drops-based rank is exposed separately so
  // the UI can show it alongside in parentheses.
  const points = seriesResults.reduce((s, r) => s + r.pointsAwarded, 0);
  return {
    rank: rowNoDrops?.rank ?? null,
    rankWithDrops: rowWithDrops?.rank ?? null,
    points,
    startedRaces,
    maxPoints: startedRaces * POINTS_PER_RACE,
  };
}

function buildChart(
  driver: DriverChampionshipInput,
  allDrivers: DriverChampionshipInput[],
  series: Series,
  options?: { birthYear?: number },
): DriverChartData {
  const seasonRaceNumbers = seriesRaceNumbers(series);
  const birthYear = options?.birthYear;

  const cohortDrivers = allDrivers.filter((d) => {
    if (d.driverType !== "championship") return false;
    if (birthYear != null) return d.yearOfBirth === birthYear;
    return d.ageClassId === driver.ageClassId;
  });

  // Only include races that have actually been driven for this cohort —
  // unstarted future races shouldn't widen the X-axis or get a 0-point bump.
  const happenedRaceNumbers = seasonRaceNumbers.filter((n) =>
    cohortDrivers.some((d) =>
      d.results.some((r) => r.raceNumber === n && r.finalized),
    ),
  );

  // Neighbors come from the latest championship standings without drops.
  const standingsRows = computeChampionship(cohortDrivers, {
    series,
    seriesRaceNumbers: seasonRaceNumbers,
    applyDrops: false,
    birthYear,
  });

  const driverIndex = standingsRows.findIndex(
    (r) => r.driverId === driver.driverId,
  );
  const aheadRows: ChampionshipRow[] = [];
  const behindRows: ChampionshipRow[] = [];
  if (driverIndex >= 0) {
    for (let i = 1; i <= 2; i++) {
      const a = standingsRows[driverIndex - i];
      if (a) aheadRows.push(a);
      const b = standingsRows[driverIndex + i];
      if (b) behindRows.push(b);
    }
  }

  // Per spec the cumulative line is a pure running sum — each race fully
  // counts, no Streichergebnisse.
  const progression = computeChampionshipProgression(cohortDrivers, {
    series,
    seriesRaceNumbers: happenedRaceNumbers,
    birthYear,
  });

  const ranksFor = (driverId: number): (number | null)[] => {
    const points = progression.get(driverId) ?? [];
    return happenedRaceNumbers.map((n) => {
      const p = points.find((pt) => pt.raceNumber === n);
      return p?.rank ?? null;
    });
  };

  const finishByRaceNumber = new Map<number, number | null>();
  for (const r of driver.results) {
    if (!happenedRaceNumbers.includes(r.raceNumber)) continue;
    if (!r.finalized) continue;
    finishByRaceNumber.set(r.raceNumber, r.finishPosition ?? null);
  }
  // happenedRaceNumbers are finalized for this age class — if the driver has
  // no row for one of them, they missed the race entirely.
  const finishPositions: FinishMarker[] = happenedRaceNumbers.map((n) => {
    if (!finishByRaceNumber.has(n)) return "missed";
    return finishByRaceNumber.get(n) ?? null;
  });

  const driverById = new Map(cohortDrivers.map((d) => [d.driverId, d]));

  const lineFor = (row: ChampionshipRow | null): DriverChartLine | null => {
    if (!row) return null;
    const d = driverById.get(row.driverId);
    if (!d) return null;
    return {
      driverId: d.driverId,
      name: driverDisplayName(d),
      cumulativeRanks: ranksFor(d.driverId),
    };
  };

  const toLines = (rows: ChampionshipRow[]): DriverChartLine[] =>
    rows
      .map((r) => lineFor(r))
      .filter((l): l is DriverChartLine => l !== null);

  return {
    series,
    seriesLabel: SERIES_LABEL[series],
    ageClassName:
      birthYear != null ? `Jahrgang ${birthYear}` : driver.ageClassName,
    raceNumbers: happenedRaceNumbers,
    driverCount: cohortDrivers.length,
    driver: {
      driverId: driver.driverId,
      name: driverDisplayName(driver),
      cumulativeRanks: ranksFor(driver.driverId),
      finishPositions,
    },
    ahead: toLines(aheadRows),
    behind: toLines(behindRows),
  };
}

function buildBirthYearStats(
  allDrivers: DriverChampionshipInput[],
  driverId: number,
  yearOfBirth: number,
  series: Series,
): DriverBirthYearStats {
  const cohort = allDrivers.filter(
    (d) => d.driverType === "championship" && d.yearOfBirth === yearOfBirth,
  );
  const rows = computeChampionship(cohort, {
    series,
    seriesRaceNumbers: seriesRaceNumbers(series),
    applyDrops: false,
    birthYear: yearOfBirth,
  });
  const row = rows.find((r) => r.driverId === driverId);
  return { rank: row?.rank ?? null, driverCount: cohort.length };
}

export async function getDriverDetails(
  driverId: number,
): Promise<DriverDetails | null> {
  const allDrivers = await getChampionshipDrivers();
  const driver = allDrivers.find((d) => d.driverId === driverId);
  if (!driver) return null;
  if (driver.driverType !== "championship") return null;

  const htsRowsNoDrops = computeChampionship(allDrivers, {
    series: "hts",
    seriesRaceNumbers: seriesRaceNumbers("hts"),
    applyDrops: false,
  });
  const htsRowsWithDrops = computeChampionship(allDrivers, {
    series: "hts",
    seriesRaceNumbers: seriesRaceNumbers("hts"),
    applyDrops: true,
  });
  const hmjRowsNoDrops = computeChampionship(allDrivers, {
    series: "hmj",
    seriesRaceNumbers: seriesRaceNumbers("hmj"),
    applyDrops: false,
  });
  const hmjRowsWithDrops = computeChampionship(allDrivers, {
    series: "hmj",
    seriesRaceNumbers: seriesRaceNumbers("hmj"),
    applyDrops: true,
  });

  const htsRowNoDrops = htsRowsNoDrops.find((r) => r.driverId === driverId);
  const htsRowWithDrops = htsRowsWithDrops.find((r) => r.driverId === driverId);
  const hmjRowNoDrops = hmjRowsNoDrops.find((r) => r.driverId === driverId);
  const hmjRowWithDrops = hmjRowsWithDrops.find((r) => r.driverId === driverId);

  const podium = countPodiumFinishes(driver.results);
  const bestFinish = bestFinishPosition(driver.results);

  const ageClassDriverCount = allDrivers.filter(
    (d) =>
      d.ageClassId === driver.ageClassId && d.driverType === "championship",
  ).length;

  const birthYearStats =
    driver.yearOfBirth != null
      ? {
          hts: buildBirthYearStats(
            allDrivers,
            driverId,
            driver.yearOfBirth,
            "hts",
          ),
          hmj: buildBirthYearStats(
            allDrivers,
            driverId,
            driver.yearOfBirth,
            "hmj",
          ),
        }
      : {
          hts: { rank: null, driverCount: 0 },
          hmj: { rank: null, driverCount: 0 },
        };

  const birthYearChart =
    driver.yearOfBirth != null
      ? buildChart(driver, allDrivers, "hts", {
          birthYear: driver.yearOfBirth,
        })
      : null;

  return {
    driverId: driver.driverId,
    firstName: driver.firstName,
    lastName: driver.lastName,
    adacId: driver.adacId,
    yearOfBirth: driver.yearOfBirth,
    teamId: driver.teamId,
    teamName: driver.teamName,
    ageClassId: driver.ageClassId,
    ageClassName: driver.ageClassName,
    ageClassDriverCount,
    hts: buildSeriesStats(htsRowNoDrops, htsRowWithDrops, driver, "hts"),
    hmj: buildSeriesStats(hmjRowNoDrops, hmjRowWithDrops, driver, "hmj"),
    birthYear: birthYearStats,
    bestFinish,
    wins: podium.wins,
    seconds: podium.seconds,
    thirds: podium.thirds,
    chart: {
      hts: buildChart(driver, allDrivers, "hts"),
      hmj: buildChart(driver, allDrivers, "hmj"),
      birthYear: birthYearChart,
    },
  };
}
