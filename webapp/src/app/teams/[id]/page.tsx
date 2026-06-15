import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { getTeamDetails } from "@/lib/dal/teams";
import { formatDateDe } from "@/lib/utils";

export const dynamic = "force-dynamic";

function formatAvg(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

export default async function TeamDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isFinite(teamId)) notFound();

  const team = await getTeamDetails(teamId);
  if (!team) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/teams"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Alle Vereine
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">{team.teamName}</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Hessen-Thüringen Süd · 8 Rennen · ohne Streichresultate
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fahrer" value={String(team.totalDrivers)} />
        <Stat label="Siege" value={String(team.totalWins)} />
        <Stat label="Punkte" value={String(team.totalPoints)} />
        <Stat
          label="Punkte/Fahrer (Ø)"
          value={formatAvg(team.avgPointsPerDriver)}
        />
        <Stat
          label="Teilnahmen gesamt"
          value={String(team.totalParticipations)}
        />
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-2">
          <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            Pro Altersklasse
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left">Altersklasse</th>
                <th className="px-3 py-2 text-right">Fahrer</th>
                <th className="px-3 py-2 text-right">Siege</th>
                <th className="px-3 py-2 text-right">Punkte</th>
                <th className="px-3 py-2 text-right">Punkte/Fahrer (Ø)</th>
              </tr>
            </thead>
            <tbody>
              {team.byAgeClass.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-[var(--color-muted)]"
                  >
                    Keine Fahrer dieses Vereins in den Wertungsklassen.
                  </td>
                </tr>
              ) : (
                team.byAgeClass.map((row) => (
                  <tr
                    key={row.ageClassId}
                    className="border-b border-[var(--color-border)]/50 last:border-0"
                  >
                    <td className="px-3 py-2 font-medium">{row.ageClassName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.driverCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.wins}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {row.totalPoints}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
                      {formatAvg(row.avgPointsPerDriver)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-2">
          <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            Pro Rennen
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Datum</th>
                <th className="px-3 py-2 text-left">Rennen</th>
                <th className="px-3 py-2 text-right">Teilnehmer</th>
              </tr>
            </thead>
            <tbody>
              {team.perRace.map((row) => (
                <tr
                  key={row.raceEventId}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                >
                  <td className="px-3 py-2 font-medium tabular-nums">
                    R{row.raceNumber}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">
                    {formatDateDe(row.eventDate)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/events/${row.raceEventId}`}
                      className="hover:underline"
                    >
                      {row.eventName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.participantCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-xs tracking-wider text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
