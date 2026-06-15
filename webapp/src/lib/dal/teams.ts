import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import {
  ageClasses,
  drivers,
  raceEntries,
  raceEvents,
  teams,
} from "@/db/schema";
import {
  computeChampionship,
  type ChampionshipRow,
  type DriverChampionshipInput,
} from "@/lib/ranking";
import { HTS_RACES, getChampionshipDrivers } from "@/lib/dal/races";

/**
 * Team standings are scored by HTS championship totals **without
 * Streichergebnisse** so the team table reflects every race a driver
 * actually contested.
 */

export interface TeamStandingsRow {
  teamId: number;
  teamName: string;
  driverCount: number;
  wins: number;
  totalPoints: number;
  avgPointsPerDriver: number;
  rank: number;
  /** Rank by average points per championship driver. */
  avgRank: number;
}

export interface TeamAgeClassStats {
  ageClassId: number;
  ageClassName: string;
  driverCount: number;
  wins: number;
  totalPoints: number;
  avgPointsPerDriver: number;
}

export interface TeamRaceParticipation {
  raceEventId: number;
  raceNumber: number;
  eventDate: string;
  eventName: string;
  status: "upcoming" | "live" | "completed";
  participantCount: number;
}

export interface TeamDetails {
  teamId: number;
  teamName: string;
  totalDrivers: number;
  totalWins: number;
  totalPoints: number;
  avgPointsPerDriver: number;
  byAgeClass: TeamAgeClassStats[];
  totalParticipations: number;
  perRace: TeamRaceParticipation[];
}

/* ───────────────────────── helpers ───────────────────────── */

interface TeamLookup {
  driversById: Map<number, { teamId: number; teamName: string }>;
  teamById: Map<number, { id: number; name: string }>;
}

async function loadTeamLookup(): Promise<TeamLookup> {
  const driverRows = await db
    .select({
      driverId: drivers.id,
      teamId: drivers.teamId,
      teamName: teams.name,
    })
    .from(drivers)
    .innerJoin(teams, eq(teams.id, drivers.teamId));

  const teamRows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams);

  return {
    driversById: new Map(
      driverRows.map((r) => [
        r.driverId,
        { teamId: r.teamId, teamName: r.teamName },
      ]),
    ),
    teamById: new Map(teamRows.map((r) => [r.id, r])),
  };
}

/**
 * Count finalized first-place finishes per team, restricted to championship
 * drivers. We take wins from `race_entries.finish_position === 1` so any race
 * (HTS or HMJ) contributes — the goal is club bragging rights, not series
 * accounting.
 */
async function countWinsByTeam(): Promise<Map<number, number>> {
  const rows = await db
    .select({
      teamId: drivers.teamId,
      finishPosition: raceEntries.finishPosition,
      driverType: drivers.driverType,
    })
    .from(raceEntries)
    .innerJoin(drivers, eq(drivers.id, raceEntries.driverId));

  const wins = new Map<number, number>();
  for (const r of rows) {
    if (r.driverType !== "championship") continue;
    if (r.finishPosition !== 1) continue;
    wins.set(r.teamId, (wins.get(r.teamId) ?? 0) + 1);
  }
  return wins;
}

/**
 * Compute every championship driver's HTS total points without drops, then
 * group by team. Vorstarter and Gaststarter never contribute points and are
 * already filtered out by `computeChampionship`.
 */
async function computeHtsPoints(): Promise<{
  byDriver: Map<number, ChampionshipRow>;
  drivers: DriverChampionshipInput[];
}> {
  const driverInputs = await getChampionshipDrivers();
  const rows = computeChampionship(driverInputs, {
    series: "hts",
    seriesRaceNumbers: HTS_RACES,
    applyDrops: false,
  });
  return {
    byDriver: new Map(rows.map((r) => [r.driverId, r])),
    drivers: driverInputs,
  };
}

/* ───────────────────────── /teams ───────────────────────── */

export async function getTeamStandings(): Promise<TeamStandingsRow[]> {
  const [{ byDriver }, lookup, winsByTeam] = await Promise.all([
    computeHtsPoints(),
    loadTeamLookup(),
    countWinsByTeam(),
  ]);

  const driverCountByTeam = new Map<number, number>();
  const pointsByTeam = new Map<number, number>();

  // Iterate over championship rows for points + driver count. Vorstarter and
  // Gaststarter are filtered out by `computeChampionship`, so this naturally
  // excludes them.
  for (const row of byDriver.values()) {
    const team = lookup.driversById.get(row.driverId);
    if (!team) continue;
    driverCountByTeam.set(
      team.teamId,
      (driverCountByTeam.get(team.teamId) ?? 0) + 1,
    );
    pointsByTeam.set(
      team.teamId,
      (pointsByTeam.get(team.teamId) ?? 0) + row.totalPoints,
    );
  }

  const standings: TeamStandingsRow[] = [];
  for (const team of lookup.teamById.values()) {
    const driverCount = driverCountByTeam.get(team.id) ?? 0;
    if (driverCount === 0) continue; // skip teams without championship drivers
    const totalPoints = pointsByTeam.get(team.id) ?? 0;
    standings.push({
      teamId: team.id,
      teamName: team.name,
      driverCount,
      wins: winsByTeam.get(team.id) ?? 0,
      totalPoints,
      avgPointsPerDriver: totalPoints / driverCount,
      rank: 0,
      avgRank: 0,
    });
  }

  assignSharedRanks(
    standings,
    (a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.teamName.localeCompare(b.teamName);
    },
    (row, rank) => {
      row.rank = rank;
    },
    (a, b) =>
      a.totalPoints === b.totalPoints && a.wins === b.wins,
  );

  assignSharedRanks(
    standings,
    (a, b) => {
      if (b.avgPointsPerDriver !== a.avgPointsPerDriver)
        return b.avgPointsPerDriver - a.avgPointsPerDriver;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.teamName.localeCompare(b.teamName);
    },
    (row, rank) => {
      row.avgRank = rank;
    },
    (a, b) =>
      a.avgPointsPerDriver === b.avgPointsPerDriver && a.wins === b.wins,
  );

  standings.sort((a, b) => a.rank - b.rank);
  return standings;
}

function assignSharedRanks<T>(
  rows: T[],
  compare: (a: T, b: T) => number,
  setRank: (row: T, rank: number) => void,
  tied: (a: T, b: T) => boolean,
): void {
  rows.sort(compare);

  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && tied(rows[j], rows[i])) j += 1;
    for (let k = i; k < j; k++) setRank(rows[k], i + 1);
    i = j;
  }
}

/* ───────────────────────── /teams/[id] ───────────────────────── */

export async function getTeamDetails(
  teamId: number,
): Promise<TeamDetails | null> {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return null;

  const [{ byDriver, drivers: driverInputs }, lookup, winsByTeam] =
    await Promise.all([
      computeHtsPoints(),
      loadTeamLookup(),
      countWinsByTeam(),
    ]);

  // Championship drivers belonging to this team.
  const teamDrivers = driverInputs.filter((d) => {
    const lookupRow = lookup.driversById.get(d.driverId);
    return (
      lookupRow?.teamId === teamId && d.driverType === "championship"
    );
  });

  const totalDrivers = teamDrivers.length;
  const totalWins = winsByTeam.get(teamId) ?? 0;
  const totalPoints = teamDrivers.reduce(
    (sum, d) => sum + (byDriver.get(d.driverId)?.totalPoints ?? 0),
    0,
  );
  const avgPointsPerDriver = totalDrivers > 0 ? totalPoints / totalDrivers : 0;

  // Per age class breakdown.
  const ageClassRows = await db
    .select()
    .from(ageClasses)
    .orderBy(asc(ageClasses.sortOrder));

  // First-place finishes per (team, ageClass).
  const winsAgeRows = await db
    .select({
      teamId: drivers.teamId,
      ageClassId: raceEntries.ageClassId,
      finishPosition: raceEntries.finishPosition,
      driverType: drivers.driverType,
    })
    .from(raceEntries)
    .innerJoin(drivers, eq(drivers.id, raceEntries.driverId));

  const winsByAgeClass = new Map<number, number>();
  for (const r of winsAgeRows) {
    if (r.teamId !== teamId) continue;
    if (r.driverType !== "championship") continue;
    if (r.finishPosition !== 1) continue;
    winsByAgeClass.set(
      r.ageClassId,
      (winsByAgeClass.get(r.ageClassId) ?? 0) + 1,
    );
  }

  const byAgeClass: TeamAgeClassStats[] = ageClassRows
    .map((ac) => {
      const driversInClass = teamDrivers.filter((d) => d.ageClassId === ac.id);
      const driverCount = driversInClass.length;
      const points = driversInClass.reduce(
        (sum, d) => sum + (byDriver.get(d.driverId)?.totalPoints ?? 0),
        0,
      );
      return {
        ageClassId: ac.id,
        ageClassName: ac.name,
        driverCount,
        wins: winsByAgeClass.get(ac.id) ?? 0,
        totalPoints: points,
        avgPointsPerDriver: driverCount > 0 ? points / driverCount : 0,
      };
    })
    .filter((r) => r.driverCount > 0);

  // Per-race participation: count of championship-driver entries from this
  // team where the driver actually attended (finish_position recorded or
  // points awarded).
  const eventRows = await db
    .select({
      raceEventId: raceEvents.id,
      raceNumber: raceEvents.number,
      eventDate: raceEvents.eventDate,
      name: raceEvents.name,
      status: raceEvents.status,
    })
    .from(raceEvents)
    .orderBy(asc(raceEvents.number));

  const participationRows = await db
    .select({
      raceEventId: raceEntries.raceEventId,
      finishPosition: raceEntries.finishPosition,
      pointsAwarded: raceEntries.pointsAwarded,
      driverType: drivers.driverType,
      teamId: drivers.teamId,
    })
    .from(raceEntries)
    .innerJoin(drivers, eq(drivers.id, raceEntries.driverId));

  const participationByEvent = new Map<number, number>();
  for (const r of participationRows) {
    if (r.teamId !== teamId) continue;
    if (r.driverType !== "championship") continue;
    const attended =
      r.finishPosition !== null || (r.pointsAwarded ?? 0) > 0;
    if (!attended) continue;
    participationByEvent.set(
      r.raceEventId,
      (participationByEvent.get(r.raceEventId) ?? 0) + 1,
    );
  }

  const perRace: TeamRaceParticipation[] = eventRows.map((e) => ({
    raceEventId: e.raceEventId,
    raceNumber: e.raceNumber,
    eventDate: e.eventDate,
    eventName: e.name,
    status: e.status,
    participantCount: participationByEvent.get(e.raceEventId) ?? 0,
  }));

  const totalParticipations = perRace.reduce(
    (sum, r) => sum + r.participantCount,
    0,
  );

  return {
    teamId,
    teamName: team.name,
    totalDrivers,
    totalWins,
    totalPoints,
    avgPointsPerDriver,
    byAgeClass,
    totalParticipations,
    perRace,
  };
}
