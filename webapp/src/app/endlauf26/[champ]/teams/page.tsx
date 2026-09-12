import Link from "next/link";
import { notFound } from "next/navigation";
import { AiQuotes } from "@/components/endlauf26/ai-quotes.client";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { FastestLapsTable } from "@/components/endlauf26/fastest-laps-table";
import { GermanFlag } from "@/components/endlauf26/german-flag";
import {
  GroupEndlaufPointsTable,
  GroupMovementTable,
  GroupPointsTable,
} from "@/components/endlauf26/group-stats-tables";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getEndlaufChampionship,
  getEndlaufResultsForChampionship,
  getLiveEndlaufEvent,
  toEventInfo,
} from "@/lib/dal/endlauf26";
import { HOME_REGION, HOME_TEAM } from "@/lib/endlauf26/home-team";
import { championshipFromSlug, DKM_NAME, ENDLAUF26_SLUGS } from "@/lib/endlauf26/ranking";
import { computeGroupStats, regionLabel } from "@/lib/endlauf26/team-stats";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Club and region statistics of a championship.
 *
 * Two variants of every points table: with the official scoring (hmj: the
 * worst of 7 results is a Streichresultat) and — `?drops=off` — with every
 * race counted. The movement tables (places gained / lost through the
 * Endläufe) follow the same switch. The Endlauf-points table ("gezählt" vs
 * "alle"), the fastest laps and the social-media quotes always use the
 * official scoring — they would be meaningless or identical otherwise.
 */
export default async function EndlaufTeamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ champ: string }>;
  searchParams: Promise<{ drops?: string }>;
}) {
  const { champ } = await params;
  const sp = await searchParams;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();
  const slug = ENDLAUF26_SLUGS[championship];
  const base = `/endlauf26/${slug}`;
  const hasDrops = championship === "hmj";
  const applyDrops = !hasDrops || sp.drops !== "off";

  const [data, officialData, results, liveEvent, isAdmin] = await Promise.all([
    getEndlaufChampionship(championship, { applyDrops }),
    // The Endlauf-points table compares "gezählt" vs "alle" itself and must
    // not follow the toggle — with drops off both columns would be identical.
    applyDrops ? null : getEndlaufChampionship(championship, { applyDrops: true }),
    getEndlaufResultsForChampionship(championship),
    getLiveEndlaufEvent(championship),
    isAdminSession(),
  ]);
  const events = data.events.map(toEventInfo);
  const classes = [...new Set(data.rows.map((r) => r.ageClass))].sort((a, b) => a - b);

  const teams = computeGroupStats(championship, "team", data.rows, events, results);
  const teamsByAvg = [...teams].sort((a, b) => b.avgPoints - a.avgPoints || a.name.localeCompare(b.name, "de"));
  const regions = computeGroupStats(championship, "region", data.rows, events, results);
  const regionsByAvg = [...regions].sort((a, b) => b.avgPoints - a.avgPoints || a.name.localeCompare(b.name, "de"));
  // Always the official scoring (Streichresultat applied), whatever the toggle says.
  const teamsOfficial = officialData
    ? computeGroupStats(championship, "team", officialData.rows, events, results)
    : teams;
  const regionsOfficial = officialData
    ? computeGroupStats(championship, "region", officialData.rows, events, results)
    : regions;
  const regionWord = regionLabel(championship);
  const regionCountLabel = championship === "hmj" ? "Verbände" : "Regionen";

  const scoredEvents = data.events.filter((e) => (data.scored.get(e.id)?.size ?? 0) > 0);
  const variantLabel = applyDrops
    ? hasDrops
      ? "nur gezählte Ergebnisse (Streichresultat an)"
      : "alle Endläufe (kein Streichresultat)"
    : "alle Läufe und Endläufe (Streichresultat aus)";

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="teams"
        title="Vereine & Regionen"
        subtitle={`Vereins- und ${regionWord}swertung, gewonnene und verlorene Plätze, schnellste Runden und Zitate · ${variantLabel}`}
        isLive={!!liveEvent}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
        <div className="flex flex-wrap gap-1.5">
          {hasDrops ? (
            <>
              <VariantChip href={`${base}/teams`} active={applyDrops} label="Nur gezählte Ergebnisse" hint="Streichresultat an — wie in der offiziellen Wertung" />
              <VariantChip href={`${base}/teams?drops=off`} active={!applyDrops} label="Alle Läufe" hint="Streichresultat aus — jedes Ergebnis zählt" />
            </>
          ) : (
            <span>Alle drei Endläufe zählen — es gibt kein Streichresultat, daher nur eine Variante.</span>
          )}
        </div>
        <span>
          Stand:{" "}
          {scoredEvents.length
            ? `nach ${scoredEvents.map((e) => e.name).join(" & ")}`
            : "vor dem ersten Endlauf"}
          {" · "}
          <Link href={base} className="hover:text-[var(--color-foreground)] hover:underline">
            zur Wertung →
          </Link>
        </span>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        Punkte = Summe der Meisterschaftspunkte aller Fahrer (inkl. Endlauf-Faktoren
        {hasDrops && applyDrops ? " und Streichresultaten" : ""}). Führende / Top 3 /{" "}
        <GermanFlag className="mx-0.5" /> DKM = Fahrer, die in der aktuellen Wertung auf Platz 1 / 1–3 / einem
        Startplatz für die {DKM_NAME}
        {championship === "hmj"
          ? ""
          : " (der ADAC-Platz je Klasse geht an den bestplatzierten Fahrer, der nicht schon über die hmj qualifiziert ist)"}{" "}
        ihrer Klasse stehen. Siege /
        Podien = Ergebnisse in den Endläufen. Schn. Rd. = schnellste Einzelrunde je Klasse und Endlauf (ohne /
        mit Strafsekunden).
        {hasDrops &&
          " Endlauf-Punkte = nur die Punkte aus Langgöns 1 & 2 (×1,25) pro Fahrer – „gezählt“ ohne Streichresultate, „alle“ mit jedem Endlauf-Ergebnis; diese Tabelle zeigt immer die offizielle Wertung, unabhängig vom Schalter oben."}{" "}
        Saldo = Veränderung der Meisterschaftsplätze durch die Endläufe, summiert über alle
        Fahrer; pro Fahrer = Saldo geteilt durch die Fahrer mit gewertetem Endlauf.
      </p>

      <Section title="Vereine">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <GroupPointsTable
            championship={championship}
            title="Gesamtpunkte"
            rows={teams}
            mode="total"
            classes={classes}
            highlightName={HOME_TEAM}
            countLabel="Vereine"
          />
          <GroupPointsTable
            championship={championship}
            title="Punkte pro Fahrer (Ø)"
            rows={teamsByAvg}
            mode="avg"
            classes={classes}
            highlightName={HOME_TEAM}
            countLabel="Vereine"
          />
        </div>
        {hasDrops && (
          <GroupEndlaufPointsTable
            title="Endlauf-Punkte pro Fahrer (Ø) – nur Langgöns"
            rows={teamsOfficial}
            highlightName={HOME_TEAM}
            countLabel="Vereine"
          />
        )}
        <GroupMovementTable
          title="Plätze gewonnen / verloren in den Endläufen"
          rows={teams}
          events={events}
          highlightName={HOME_TEAM}
          countLabel="Vereine"
        />
      </Section>

      <Section title={regionCountLabel}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <GroupPointsTable
            championship={championship}
            title="Gesamtpunkte"
            rows={regions}
            mode="total"
            classes={classes}
            highlightName={HOME_REGION}
            countLabel={regionCountLabel}
          />
          <GroupPointsTable
            championship={championship}
            title="Punkte pro Fahrer (Ø)"
            rows={regionsByAvg}
            mode="avg"
            classes={classes}
            highlightName={HOME_REGION}
            countLabel={regionCountLabel}
          />
        </div>
        {hasDrops && (
          <GroupEndlaufPointsTable
            title="Endlauf-Punkte pro Fahrer (Ø) – nur Langgöns"
            rows={regionsOfficial}
            highlightName={HOME_REGION}
            countLabel={regionCountLabel}
          />
        )}
        <GroupMovementTable
          title="Plätze gewonnen / verloren in den Endläufen"
          rows={regions}
          events={events}
          highlightName={HOME_REGION}
          countLabel={regionCountLabel}
        />
      </Section>

      <FastestLapsTable
        championship={championship}
        rows={data.rows}
        events={events}
        results={results}
        driverHref={(id) => `${base}/driver/${id}`}
      />

      <Section title="Zitate für Social Media">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <AiQuotes champSlug={slug} subject="team" title={HOME_TEAM} isAdmin={isAdmin} />
          <AiQuotes
            champSlug={slug}
            subject="region"
            title={`${regionWord} ${HOME_REGION}`}
            isAdmin={isAdmin}
          />
        </div>
      </Section>

      {data.rows.length === 0 && (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-muted)]">
          Noch keine Daten importiert. <code>make seed-endlauf26</code> ausführen.
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function VariantChip({
  href,
  active,
  label,
  hint,
}: {
  href: string;
  active: boolean;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      title={hint}
      className={cn(
        "rounded-md border px-2 py-1",
        active
          ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-foreground)]"
          : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
      )}
    >
      {label}
    </Link>
  );
}
