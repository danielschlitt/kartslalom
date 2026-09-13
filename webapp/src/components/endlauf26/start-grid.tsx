import { ImageIcon } from "lucide-react";
import { HOME_TEAM, HOME_TEAM_BG } from "@/lib/endlauf26/home-team";
import { duplicateStartingOrders } from "@/lib/endlauf26/start-order";
import type { EndlaufStartListMeta, StartGridRow } from "@/lib/endlauf26/startlist-types";
import { cn } from "@/lib/utils";

export interface StartGridData {
  rows: StartGridRow[];
  images: EndlaufStartListMeta[];
  /** German description of where the order comes from. */
  sourceLabel: string;
}

/**
 * The start grid (Startaufstellung) of one age class — shown on the public
 * event page until the official result list of the class is imported.
 * Sorted by starting order; drivers without one follow alphabetically.
 */
export function StartGrid({ data, compact }: { data: StartGridData; compact?: boolean }) {
  const sorted = [...data.rows].sort((a, b) => {
    const ao = a.startingOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.startingOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.lastName.localeCompare(b.lastName, "de");
  });
  const duplicates = duplicateStartingOrders(sorted);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs text-[var(--color-muted)]">
        <span>
          Startaufstellung · {sorted.length} Fahrer · {data.sourceLabel}
        </span>
        {data.images.map((img, i) => (
          <a
            key={img.id}
            href={`/api/endlauf26/startlist-images/${img.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
            title="Foto der ausgehängten Startliste öffnen"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Startliste{data.images.length > 1 ? ` ${i + 1}` : ""} (Foto)
          </a>
        ))}
      </div>
      <div className="overflow-x-auto border-t border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-3 py-2 text-right">Start</th>
              <th className="px-3 py-2 text-left">Fahrer</th>
              {!compact && <th className="px-3 py-2 text-left">Verein</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isHome = r.teamName === HOME_TEAM;
              const dup = r.startingOrder !== null && duplicates.has(r.startingOrder);
              return (
                <tr
                  key={r.driverId}
                  className="border-b border-[var(--color-border)]/50 last:border-0"
                  style={isHome ? { backgroundColor: HOME_TEAM_BG } : undefined}
                >
                  <td className="px-3 py-1.5 text-right">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums",
                        isHome && "bg-[var(--color-rank-blue)] text-white",
                        r.startingOrder === null && "text-[var(--color-muted)]",
                        dup && "ring-1 ring-red-500",
                      )}
                      title={dup ? "Startplatz doppelt vergeben" : undefined}
                    >
                      {r.startingOrder ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-medium">
                    {r.lastName} {r.firstName}
                    {r.nominated && (
                      <span className="ml-2 rounded-sm bg-[var(--color-accent)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase">
                        Nachrücker
                      </span>
                    )}
                    {compact && (
                      <span className="ml-2 text-xs text-[var(--color-muted)]">{r.teamName}</span>
                    )}
                  </td>
                  {!compact && <td className="px-3 py-1.5 text-[var(--color-muted)]">{r.teamName}</td>}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={compact ? 2 : 3} className="px-3 py-3 text-center text-sm text-[var(--color-muted)]">
                  Keine Fahrer im Feld.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
