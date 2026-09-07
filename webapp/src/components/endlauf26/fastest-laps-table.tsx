import { formatSeconds } from "@/lib/endlauf26/format";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import { ageClassName, type Endlauf26Championship, type Endlauf26Row, type EndlaufEventInfo } from "@/lib/endlauf26/ranking";
import { computeFastestLaps, regionLabel, type StatResult } from "@/lib/endlauf26/team-stats";
import { cn } from "@/lib/utils";

/**
 * Fastest single run per Endlauf and age class — once without penalty
 * seconds (pure lap time) and once with. Source of the "schnellste Runden"
 * counters in the club / region tables.
 */
export function FastestLapsTable({
  championship,
  rows,
  events,
  results,
  driverHref,
}: {
  championship: Endlauf26Championship;
  rows: Endlauf26Row[];
  events: EndlaufEventInfo[];
  results: StatResult[];
  driverHref: (driverId: number) => string;
}) {
  const laps = computeFastestLaps(results);
  if (laps.raw.length === 0) return null;
  const rowById = new Map(rows.map((r) => [r.driverId, r]));
  const eventName = new Map(events.map((e) => [e.eventId, e.name]));
  const penByKey = new Map(laps.withPenalty.map((l) => [`${l.eventId}:${l.ageClass}`, l]));

  const renderDrivers = (ids: number[]) => (
    <>
      {ids.map((id, i) => {
        const r = rowById.get(id);
        if (!r) return <span key={id}>?</span>;
        const isHome = r.teamName === HOME_TEAM;
        return (
          <span key={id}>
            {i > 0 && ", "}
            <a href={driverHref(id)} className={cn("hover:underline", isHome && "font-semibold")}>
              {r.firstName} {r.lastName}
            </a>{" "}
            <span className="text-xs text-[var(--color-muted)]">
              ({r.teamName}
              {(championship === "hmj" ? r.verband : r.region) ? ` · ${championship === "hmj" ? r.verband : r.region}` : ""})
            </span>
          </span>
        );
      })}
    </>
  );

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          Schnellste Runden je Klasse
        </h3>
        <span className="text-xs text-[var(--color-muted)]">
          {laps.raw.length} Klassen · Verein · {regionLabel(championship)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-3 py-2 text-left">Endlauf</th>
              <th className="px-3 py-2 text-left">Klasse</th>
              <th className="px-3 py-2 text-left">Schnellste Runde (ohne Fehler)</th>
              <th className="px-3 py-2 text-right">Zeit</th>
              <th className="px-3 py-2 text-left border-l border-[var(--color-border)]">
                Bester Einzellauf (mit Fehlern)
              </th>
              <th className="px-3 py-2 text-right">Zeit</th>
            </tr>
          </thead>
          <tbody>
            {laps.raw.map((l) => {
              const pen = penByKey.get(`${l.eventId}:${l.ageClass}`);
              const isHome = l.driverIds.some((id) => rowById.get(id)?.teamName === HOME_TEAM);
              return (
                <tr
                  key={`${l.eventId}:${l.ageClass}`}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                  style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td className="px-3 py-2 whitespace-nowrap">{eventName.get(l.eventId)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{ageClassName(l.ageClass)}</td>
                  <td className="px-3 py-2">{renderDrivers(l.driverIds)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatSeconds(l.value)}</td>
                  <td className="px-3 py-2 border-l border-[var(--color-border)]">
                    {pen ? renderDrivers(pen.driverIds) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {pen ? formatSeconds(pen.value) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
