import { NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { raceEntries } from "@/db/schema";
import {
  getAllRaceEvents,
  getEnrichedEntriesForEvent,
  getFinalizedAgeClassIds,
  getPointsScale,
} from "@/lib/dal/races";
import { DEFAULT_VIEW, rankRaceEntries } from "@/lib/ranking";

/**
 * Re-derive `race_entries.finish_position` and `race_entries.points_awarded`
 * for every finalized age class that has run timings, using the official
 * Wertung (best run + Strafsekunden). This brings stored championship points
 * back in line with the timing data after the timing-based finalize logic
 * shipped — useful when classes were finalized via the older manual-position
 * flow and now need to be reconciled.
 *
 * Drop calculations are display-time and read these stored points, so updating
 * them here implicitly refreshes every Streichergebnis on the next page load.
 *
 * Skips:
 *   - events that are not `completed` (live/upcoming results stay provisional)
 *   - age classes that are not finalized
 *   - classes without any recorded run times (manual-positions fallback stays
 *     as-is to avoid wiping legacy backfilled points)
 */
export async function POST() {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const [allEvents, pointsScale] = await Promise.all([
    getAllRaceEvents(),
    getPointsScale(),
  ]);

  let eventsTouched = 0;
  let classesTouched = 0;
  let entriesUpdated = 0;
  const detailsByEvent: {
    eventId: number;
    raceNumber: number;
    classes: { ageClassId: number; entriesUpdated: number }[];
  }[] = [];

  for (const event of allEvents) {
    if (event.status !== "completed") continue;

    const [entries, finalizedAgeClassIds] = await Promise.all([
      getEnrichedEntriesForEvent(event.id),
      getFinalizedAgeClassIds(event.id),
    ]);

    const eventDetails: {
      eventId: number;
      raceNumber: number;
      classes: { ageClassId: number; entriesUpdated: number }[];
    } = { eventId: event.id, raceNumber: event.number, classes: [] };

    for (const ageClassId of finalizedAgeClassIds) {
      const classEntries = entries.filter((e) => e.ageClassId === ageClassId);
      if (classEntries.length === 0) continue;
      const hasTimes = classEntries.some(
        (e) =>
          e.runs.first?.timeSeconds != null ||
          e.runs.second?.timeSeconds != null,
      );
      if (!hasTimes) continue;

      const ranked = rankRaceEntries(classEntries, pointsScale, DEFAULT_VIEW);

      let touched = 0;
      await db.transaction(async (tx) => {
        for (const r of ranked) {
          const stored = r.entry.storedFinishPosition ?? null;
          const storedPoints = r.entry.storedPointsAwarded ?? 0;
          if (
            stored === r.finishPosition &&
            storedPoints === r.pointsAwarded
          ) {
            continue;
          }
          await tx
            .update(raceEntries)
            .set({
              finishPosition: r.finishPosition,
              pointsAwarded: r.pointsAwarded,
            })
            .where(eq(raceEntries.id, r.entry.entryId));
          touched += 1;
        }
      });

      if (touched > 0) {
        classesTouched += 1;
        entriesUpdated += touched;
        eventDetails.classes.push({ ageClassId, entriesUpdated: touched });
      }
    }

    if (eventDetails.classes.length > 0) {
      eventsTouched += 1;
      detailsByEvent.push(eventDetails);
    }
  }

  return NextResponse.json({
    ok: true,
    eventsTouched,
    classesTouched,
    entriesUpdated,
    detailsByEvent,
  });
}
