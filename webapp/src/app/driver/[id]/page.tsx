import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { DriverChampionshipChart } from "@/components/driver-championship-chart";
import { getDriverDetails } from "@/lib/dal/drivers";

export const dynamic = "force-dynamic";

function formatRank(rank: number | null, rankWithDrops: number | null): string {
  if (rank == null && rankWithDrops == null) return "—";
  const main = rank == null ? "—" : `#${rank}`;
  const drops = rankWithDrops == null ? "—" : `#${rankWithDrops}`;
  return `${main} (${drops})`;
}

function formatPoints(points: number, max: number): string {
  if (max === 0) return `${points} / 0`;
  return `${points} / ${max}`;
}

export default async function DriverDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const driverId = Number(id);
  if (!Number.isFinite(driverId)) notFound();

  const driver = await getDriverDetails(driverId);
  if (!driver) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/championship"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Meisterschaft
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">
          {driver.lastName} {driver.firstName}
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          {driver.ageClassName} ·{" "}
          <Link
            href={`/teams/${driver.teamId}`}
            className="hover:text-[var(--color-foreground)] hover:underline"
          >
            {driver.teamName}
          </Link>
        </p>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        Alle Ergebnisse sind ohne Streicher. Einzig Meisterschaftspositionen
        werden zusätzlich mit Streichern angezeigt. (Streicherergebnis in
        Klammern)
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Meisterschaft HTS"
          value={formatRank(driver.hts.rank, driver.hts.rankWithDrops)}
        />
        <Stat
          label="Meisterschaft HMJ"
          value={formatRank(driver.hmj.rank, driver.hmj.rankWithDrops)}
        />
        <Stat
          label="Beste Platzierung"
          value={driver.bestFinish == null ? "—" : `${driver.bestFinish}.`}
        />
        <Stat
          label="Siege / 2. / 3."
          value={`${driver.wins} / ${driver.seconds} / ${driver.thirds}`}
        />
        <Stat
          label="HTS Punkte"
          value={formatPoints(driver.hts.points, driver.hts.maxPoints)}
        />
        <Stat
          label="HMJ Punkte"
          value={formatPoints(driver.hmj.points, driver.hmj.maxPoints)}
        />
        <Stat label="HTS Starts" value={String(driver.hts.startedRaces)} />
        <Stat label="HMJ Starts" value={String(driver.hmj.startedRaces)} />
      </div>

      <Section title="Verlauf Hessen-Thüringen Süd">
        <DriverChampionshipChart data={driver.chart.hts} />
      </Section>

      <Section title="Verlauf HMJ">
        <DriverChampionshipChart data={driver.chart.hmj} />
      </Section>
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
