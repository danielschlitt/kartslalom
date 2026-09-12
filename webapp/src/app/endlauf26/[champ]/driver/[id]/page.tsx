import Link from "next/link";
import { notFound } from "next/navigation";
import { AiPrediction } from "@/components/endlauf26/ai-prediction.client";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { EndlaufChampionshipTable } from "@/components/endlauf26/championship-table";
import { GermanFlag } from "@/components/endlauf26/german-flag";
import { Movement } from "@/components/endlauf26/movement";
import {
  getEndlaufChampionship,
  getEndlaufDriver,
  toEventInfo,
} from "@/lib/dal/endlauf26";
import { formatPoints } from "@/lib/endlauf26/format";
import {
  ageClassName,
  championshipFromSlug,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";

export const dynamic = "force-dynamic";

export default async function EndlaufDriverPage({
  params,
}: {
  params: Promise<{ champ: string; id: string }>;
}) {
  const { champ, id } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();
  const driverId = Number(id);
  const driver = await getEndlaufDriver(driverId);
  if (!driver || driver.d.championship !== championship) notFound();

  const data = await getEndlaufChampionship(championship);
  const row = data.rows.find((r) => r.driverId === driverId);
  if (!row) notFound();
  const classRows = data.rows.filter((r) => r.ageClass === row.ageClass);
  const base = `/endlauf26/${ENDLAUF26_SLUGS[championship]}`;

  return (
    <div className="space-y-6">
      <ChampHeader
        championship={championship}
        active="standings"
        title={`${driver.d.lastName} ${driver.d.firstName}`}
        subtitle={[
          driver.teamName,
          ageClassName(driver.d.ageClass),
          driver.d.verband ? `Verband ${driver.d.verband}` : null,
          driver.d.region ? `Region ${driver.d.region}` : null,
          driver.d.adacId ? `Ausweis ${driver.d.adacId}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Platz"
          value={
            row.withdrawn ? "abgemeldet" : row.excluded ? "n. g." : row.rank ? `${row.rank}.` : "—"
          }
          hint={
            row.dkmVia === championship ? (
              <span className="inline-flex items-center gap-1">
                <GermanFlag /> {championship === "hmj" ? "DKM-Platz" : "DKM-Platz über die ADAC-Endläufe"}
              </span>
            ) : row.dkmVia === "hmj" ? (
              <span className="inline-flex items-center gap-1">
                <GermanFlag /> bereits über die hmj für die DKM qualifiziert
              </span>
            ) : undefined
          }
        />
        <Stat label="Punkte" value={formatPoints(row.totalPoints)} />
        <Stat label="Vor Endlauf" value={row.rankBefore ? `${row.rankBefore}.` : "—"} />
        <Stat
          label="Saison"
          value={
            driver.d.seasonPosition
              ? `${driver.d.seasonPosition}. · ${formatPoints(Number(driver.d.seasonPoints))} Pkt.`
              : "—"
          }
        />
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-4 py-2 text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          Ergebnisse
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-3 py-2 text-left">Lauf</th>
              <th className="px-3 py-2 text-right">Platz</th>
              <th className="px-3 py-2 text-right">Punkte</th>
              <th className="px-3 py-2 text-right">Faktor</th>
              <th className="px-3 py-2 text-right">Gewertet</th>
              <th className="px-3 py-2 text-right">Veränderung</th>
            </tr>
          </thead>
          <tbody>
            {row.cells.map((c) => {
              const mv = row.movement.find((m) => m.eventId === c.eventId);
              return (
                <tr key={c.key} className="border-b border-[var(--color-border)]/50 last:border-0">
                  <td className="px-3 py-2">{c.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.available ? (c.position ?? "—") : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.available ? formatPoints(c.points) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
                    {c.factor !== 1 ? `×${c.factor}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!c.available ? (
                      <span className="text-[var(--color-muted)]">offen</span>
                    ) : c.dropped ? (
                      <span className="text-[var(--color-muted)] line-through">Streichresultat</span>
                    ) : (
                      "✓"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {mv ? <Movement delta={mv.delta} /> : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AiPrediction driverId={driverId} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {ageClassName(row.ageClass)}
        </h2>
        <EndlaufChampionshipTable
          championship={championship}
          ageClassName={ageClassName(row.ageClass)}
          rows={classRows}
          events={data.events.map(toEventInfo)}
          driverHref={(d) => `${base}/driver/${d}`}
        />
      </section>

      <p className="text-sm">
        <Link href={base} className="text-[var(--color-accent)] hover:underline">
          ← Zur Wertung
        </Link>
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-[var(--color-muted)]">{hint}</div>}
    </div>
  );
}
