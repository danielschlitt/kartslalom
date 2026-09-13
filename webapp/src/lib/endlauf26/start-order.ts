/**
 * Start order (Startaufstellung) of an Endlauf — pure helpers, no DB / React.
 *
 * Default rule for every class: the championship standing *before* the
 * event, bottom-up — the driver ranked last starts first, the leader starts
 * last. For Endlauf 1 that is the standing after the regular season; for
 * Endlauf n it is the standing after Endlauf n−1 (the current championship
 * table once the previous Endlauf is scored). The one exception is ADAC
 * Endlauf 1, whose start positions come from the official start list CSV.
 *
 * A photographed start list (`endlauf26_start_lists`) overrides the default
 * for its class; official results freeze it (the printed Startplatz is kept
 * in `endlauf26_results`).
 */

import type { Endlauf26Championship, Endlauf26Row, EndlaufEventInfo } from "./ranking";
import type { StartOrderSource } from "./startlist-types";

/**
 * Bottom-up start order of one event from championship rows (any classes —
 * numbering restarts per class). Withdrawn drivers are skipped. The rank
 * before the event comes from `row.movement`; unranked drivers (excluded
 * in that snapshot, e.g. ADAC drivers who missed an Endlauf) count as the
 * worst and start first. Ties keep the reverse table order.
 *
 * Returns driverId → starting order (1 = first on track).
 */
export function standingsStartOrder(
  rows: readonly Endlauf26Row[],
  eventId: number,
): Map<number, number> {
  const rankBefore = (r: Endlauf26Row): number | null =>
    r.movement.find((m) => m.eventId === eventId)?.before ?? null;

  const byClass = new Map<number, Endlauf26Row[]>();
  for (const r of rows) {
    if (r.withdrawn) continue;
    byClass.set(r.ageClass, [...(byClass.get(r.ageClass) ?? []), r]);
  }

  const out = new Map<number, number>();
  for (const list of byClass.values()) {
    // Table order: ranked by rank ascending (unranked last). Reverse it.
    const ordered = list
      .map((r, idx) => ({ r, idx, rank: rankBefore(r) }))
      .sort((a, b) => {
        const ar = a.rank ?? Number.MAX_SAFE_INTEGER;
        const br = b.rank ?? Number.MAX_SAFE_INTEGER;
        if (ar !== br) return br - ar; // worse rank first
        return b.idx - a.idx; // reverse of the table order
      });
    ordered.forEach(({ r }, i) => out.set(r.driverId, i + 1));
  }
  return out;
}

/** Whether the standings-based default applies to this event at all. */
export function standingsOrderApplies(
  championship: Endlauf26Championship,
  event: Pick<EndlaufEventInfo, "number">,
): boolean {
  // ADAC Endlauf 1 takes its start positions from the official start list CSV.
  return !(championship === "adac_hth" && event.number === 1);
}

/** German description of the default order of an event, for admin and public pages. */
export function startOrderBaseLabel(
  championship: Endlauf26Championship,
  event: Pick<EndlaufEventInfo, "number">,
  events: readonly Pick<EndlaufEventInfo, "number" | "name">[],
): string {
  if (!standingsOrderApplies(championship, event)) {
    return "Startplätze laut offizieller Startliste (CSV)";
  }
  if (event.number <= 1) {
    return championship === "hmj"
      ? "Meisterschaftsstand nach den 5 Läufen, von hinten (Letzter startet zuerst)"
      : "Regionalmeisterschaft, von hinten (Letzter startet zuerst)";
  }
  const prev = events.find((e) => e.number === event.number - 1);
  return `Meisterschaftsstand nach Endlauf ${event.number - 1}${prev ? `: ${prev.name}` : ""}, von hinten (Letzter startet zuerst)`;
}

export function resolveStartOrderSource(input: {
  championship: Endlauf26Championship;
  eventNumber: number;
  hasResults: boolean;
  hasStartList: boolean;
}): StartOrderSource {
  if (input.hasResults) return "results";
  if (input.hasStartList) return "startlist";
  if (!standingsOrderApplies(input.championship, { number: input.eventNumber })) return "csv";
  return "standings";
}

export const START_ORDER_SOURCE_LABEL: Record<StartOrderSource, string> = {
  results: "Ergebnisliste liegt vor",
  startlist: "Startliste (Foto)",
  csv: "Startliste (CSV)",
  standings: "Meisterschaftsstand",
};

/** Starting orders that occur more than once in a class (for warnings). */
export function duplicateStartingOrders(
  entries: readonly { startingOrder: number | null }[],
): Set<number> {
  const seen = new Map<number, number>();
  for (const e of entries) {
    if (e.startingOrder === null) continue;
    seen.set(e.startingOrder, (seen.get(e.startingOrder) ?? 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([o]) => o));
}
