import { GermanFlag } from "@/components/endlauf26/german-flag";
import { Movement } from "@/components/endlauf26/movement";
import { formatPoints } from "@/lib/endlauf26/format";
import { ageClassName, type Endlauf26Championship, type EndlaufEventInfo } from "@/lib/endlauf26/ranking";
import type { GroupStatRow } from "@/lib/endlauf26/team-stats";
import { HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import { cn } from "@/lib/utils";

function Card({
  title,
  count,
  countLabel,
  children,
}: {
  title: string;
  count: number;
  countLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <h3 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {title}
        </h3>
        <span className="text-xs text-[var(--color-muted)]">
          {count} {countLabel}
        </span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Row({
  s,
  i,
  isHome,
  children,
}: {
  s: GroupStatRow;
  i: number;
  isHome: boolean;
  children: React.ReactNode;
}) {
  return (
    <tr
      className="border-b border-[var(--color-border)]/50 last:border-0"
      style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
    >
      <td className="px-3 py-2 tabular-nums">{i + 1}.</td>
      <td className={cn("px-3 py-2 font-medium whitespace-nowrap", isHome && "text-white")}>{s.name}</td>
      {children}
    </tr>
  );
}

const num = "px-2 py-2 text-right tabular-nums";
const muted = `${num} text-[var(--color-muted)]`;

/**
 * Points table of clubs or regions: total or average points plus the
 * headline counters (leaders, podiums, DKM spots, Endlauf wins/podiums,
 * fastest laps) and the drivers per class.
 */
export function GroupPointsTable({
  championship,
  title,
  rows,
  mode,
  classes,
  highlightName,
  countLabel,
}: {
  championship: Endlauf26Championship;
  title: string;
  rows: GroupStatRow[];
  mode: "total" | "avg";
  classes: number[];
  highlightName: string;
  countLabel: string;
}) {
  const showDkm = championship === "hmj";
  return (
    <Card title={title} count={rows.length} countLabel={countLabel}>
      <table className="w-full text-sm">
        <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">{countLabel === "Vereine" ? "Verein" : "Region"}</th>
            <th className="px-3 py-2 text-right">{mode === "total" ? "Punkte" : "Ø"}</th>
            <th className={num}>Fahrer</th>
            <th className={num} title="Fahrer auf Platz 1 ihrer Klasse">
              Führende
            </th>
            <th className={num} title="Fahrer auf Platz 1–3 ihrer Klasse (Meisterschaftsstand)">
              Top 3
            </th>
            {showDkm && (
              <th className={num} title="Fahrer auf einem Startplatz für die Deutsche Kartslalom Meisterschaft der dmsj">
                <GermanFlag className="mr-1" />
                DKM
              </th>
            )}
            <th className={num} title="Endlauf-Siege">
              Siege
            </th>
            <th className={num} title="Endlauf-Podien (Platz 1–3 im Endlauf)">
              Podien
            </th>
            <th className={num} title="Schnellste Einzelrunde je Klasse und Endlauf (ohne Strafsekunden / mit Strafsekunden)">
              Schn. Rd.
            </th>
            <th className={num} title="Punkte aus den Endläufen (inkl. Faktor)">
              Endlauf-Pkt.
            </th>
            {classes.map((c) => (
              <th key={c} className={num} title={ageClassName(c)}>
                K{c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const isHome = s.name === highlightName;
            return (
              <Row key={s.id} s={s} i={i} isHome={isHome}>
                <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                  {formatPoints(mode === "total" ? s.totalPoints : s.avgPoints)}
                </td>
                <td className={num}>{s.driverCount}</td>
                <td className={num}>{s.classLeaders || "—"}</td>
                <td className={num}>{s.podiumPlaces || "—"}</td>
                {showDkm && <td className={num}>{s.dkmQualifiers || "—"}</td>}
                <td className={num}>{s.endlaufWins || "—"}</td>
                <td className={num}>{s.endlaufPodiums || "—"}</td>
                <td className={num} title="ohne / mit Strafsekunden">
                  {s.fastestLaps || s.fastestLapsWithPenalty
                    ? `${s.fastestLaps} / ${s.fastestLapsWithPenalty}`
                    : "—"}
                </td>
                <td className={muted}>{s.endlaufPoints ? formatPoints(s.endlaufPoints) : "—"}</td>
                {classes.map((c) => (
                  <td key={c} className={muted}>
                    {s.perClass[c] ?? "—"}
                  </td>
                ))}
              </Row>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Places gained / lost in the championship through the Endläufe, per club or
 * region: per Endlauf and in total, plus the net movement per driver.
 */
export function GroupMovementTable({
  title,
  rows,
  events,
  highlightName,
  countLabel,
}: {
  title: string;
  rows: GroupStatRow[];
  events: EndlaufEventInfo[];
  highlightName: string;
  countLabel: string;
}) {
  const sorted = [...rows].sort(
    (a, b) =>
      b.netMovement - a.netMovement ||
      b.netPerDriver - a.netPerDriver ||
      a.name.localeCompare(b.name, "de"),
  );
  const sortedEvents = [...events].sort((a, b) => a.number - b.number);
  return (
    <Card title={title} count={rows.length} countLabel={countLabel}>
      <table className="w-full text-sm">
        <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
          <tr className="border-b border-[var(--color-border)]">
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">{countLabel === "Vereine" ? "Verein" : "Region"}</th>
            <th className="px-3 py-2 text-right" title="Gewonnene minus verlorene Plätze über alle Endläufe">
              Saldo
            </th>
            <th className={num} title="Saldo geteilt durch Fahrer mit gewertetem Endlauf">
              pro Fahrer
            </th>
            <th className={num} title="Summe der gewonnenen Plätze">
              ▲ gewonnen
            </th>
            <th className={num} title="Summe der verlorenen Plätze">
              ▼ verloren
            </th>
            <th className={num} title="Fahrer mit mindestens einem gewerteten Endlauf">
              Fahrer
            </th>
            {sortedEvents.map((e) => (
              <th
                key={e.eventId}
                className={cn(num, "whitespace-nowrap border-l border-[var(--color-border)]")}
                title={`Saldo (gewonnen / verloren) durch ${e.name}`}
              >
                {e.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => {
            const isHome = s.name === highlightName;
            return (
              <Row key={s.id} s={s} i={i} isHome={isHome}>
                <td className="px-3 py-2 text-right text-base">
                  {s.moversCount ? <Movement delta={s.netMovement} /> : <span className="text-[var(--color-muted)]">—</span>}
                </td>
                <td className={cn(num, "font-semibold")}>
                  {s.moversCount ? formatSigned(s.netPerDriver) : "—"}
                </td>
                <td className={cn(num, "text-[var(--color-rank-green)]")}>
                  {s.gainedTotal ? `+${s.gainedTotal}` : "—"}
                </td>
                <td className={cn(num, "text-[var(--color-live)]")}>
                  {s.lostTotal ? `−${s.lostTotal}` : "—"}
                </td>
                <td className={muted}>{s.moversCount || "—"}</td>
                {sortedEvents.map((e) => {
                  const m = s.movement.find((x) => x.eventId === e.eventId);
                  return (
                    <td
                      key={e.eventId}
                      className={cn(num, "whitespace-nowrap border-l border-[var(--color-border)]")}
                    >
                      {m && m.drivers > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Movement delta={m.net} />
                          <span className="text-xs text-[var(--color-muted)]">
                            (+{m.gained} / −{m.lost})
                          </span>
                        </span>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                  );
                })}
              </Row>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function formatSigned(n: number): string {
  const s = formatPoints(Math.abs(n));
  if (n > 0) return `+${s}`;
  if (n < 0) return `−${s}`;
  return "0";
}
