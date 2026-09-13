/**
 * Re-derive the default start orders of the Endläufe from the championship
 * standing (`standingsStartOrder`) and write them to `endlauf26_entries`.
 *
 * Runs whenever the standing can have changed (result list imported /
 * deleted, Endlauf reset, field change), from the admin button and from the
 * seed. Per (event, class) it leaves the order alone when
 *  - an official result list exists (the Startplatz is history),
 *  - a start list photo was read for the class (that order wins), or
 *  - live times exist for the class (the class is underway) — unless forced.
 *
 * Not behind `server-only` and parameterised by the drizzle instance so the
 * seed can call it; the DAL wraps it with the app's `db`.
 */

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { endlauf26Drivers, endlauf26Entries, endlauf26StartLists } from "../../db/schema";
import {
  inFieldCondition,
  loadEndlaufChampionship,
  loadEndlaufEvents,
  type Endlauf26Db,
} from "./championship-data";
import type { Endlauf26Championship } from "./ranking";
import { standingsOrderApplies, standingsStartOrder } from "./start-order";

export interface StartOrderSyncOptions {
  /** Only this event (default: every Endlauf from number 2 on). */
  eventId?: number;
  /** Only this age class. */
  ageClass?: number;
  /** Also renumber classes that already have live times. */
  force?: boolean;
}

export type StartOrderSkipReason = "results" | "startlist" | "underway";

export interface StartOrderSyncClass {
  eventId: number;
  eventNumber: number;
  ageClass: number;
  /** Entries whose starting order was changed. */
  changed: number;
  skipped: StartOrderSkipReason | null;
}

export interface StartOrderSyncSummary {
  classes: StartOrderSyncClass[];
}

/** Live entries of the class have a time → the class is underway. */
export const entryHasAnyTime = or(
  isNotNull(endlauf26Entries.testTime),
  isNotNull(endlauf26Entries.run1Time),
  isNotNull(endlauf26Entries.run2Time),
);

export async function syncStandingsStartOrders(
  db: Endlauf26Db,
  championship: Endlauf26Championship,
  opts: StartOrderSyncOptions = {},
): Promise<StartOrderSyncSummary> {
  const events = (await loadEndlaufEvents(db, championship)).filter(
    (ev) =>
      standingsOrderApplies(championship, ev) &&
      (opts.eventId !== undefined ? ev.id === opts.eventId : ev.number >= 2),
  );
  const summary: StartOrderSyncSummary = { classes: [] };
  if (events.length === 0) return summary;
  const eventIds = events.map((e) => e.id);

  const [data, startListRows, underwayRows] = await Promise.all([
    loadEndlaufChampionship(db, championship),
    db
      .selectDistinct({
        eventId: endlauf26StartLists.eventId,
        ageClass: endlauf26StartLists.ageClass,
      })
      .from(endlauf26StartLists)
      .where(inArray(endlauf26StartLists.eventId, eventIds)),
    db
      .selectDistinct({ eventId: endlauf26Entries.eventId, ageClass: endlauf26Entries.ageClass })
      .from(endlauf26Entries)
      .where(and(inArray(endlauf26Entries.eventId, eventIds), entryHasAnyTime)),
  ]);
  const key = (eventId: number, ageClass: number) => `${eventId}:${ageClass}`;
  const withStartList = new Set(startListRows.map((r) => key(r.eventId, r.ageClass)));
  const underway = new Set(underwayRows.map((r) => key(r.eventId, r.ageClass)));
  const classes = [...new Set(data.rows.map((r) => r.ageClass))]
    .filter((c) => opts.ageClass === undefined || c === opts.ageClass)
    .sort((a, b) => a - b);

  for (const ev of events) {
    const order = standingsStartOrder(data.rows, ev.id);
    for (const ageClass of classes) {
      const entry: StartOrderSyncClass = {
        eventId: ev.id,
        eventNumber: ev.number,
        ageClass,
        changed: 0,
        skipped: null,
      };
      summary.classes.push(entry);
      if (data.scored.get(ev.id)?.has(ageClass)) {
        entry.skipped = "results";
        continue;
      }
      if (withStartList.has(key(ev.id, ageClass))) {
        entry.skipped = "startlist";
        continue;
      }
      if (underway.has(key(ev.id, ageClass)) && !opts.force) {
        entry.skipped = "underway";
        continue;
      }

      const entries = await db
        .select({
          id: endlauf26Entries.id,
          driverId: endlauf26Entries.driverId,
          startingOrder: endlauf26Entries.startingOrder,
        })
        .from(endlauf26Entries)
        .innerJoin(endlauf26Drivers, eq(endlauf26Drivers.id, endlauf26Entries.driverId))
        .where(
          and(
            eq(endlauf26Entries.eventId, ev.id),
            eq(endlauf26Entries.ageClass, ageClass),
            inFieldCondition,
            eq(endlauf26Drivers.withdrawn, false),
          ),
        );
      const updates = entries
        .map((e) => ({ id: e.id, next: order.get(e.driverId) ?? null, prev: e.startingOrder }))
        .filter((u) => u.next !== u.prev);
      if (updates.length === 0) continue;
      await db.transaction(async (tx) => {
        for (const u of updates) {
          await tx
            .update(endlauf26Entries)
            .set({ startingOrder: u.next })
            .where(eq(endlauf26Entries.id, u.id));
        }
      });
      entry.changed = updates.length;
    }
  }
  return summary;
}
