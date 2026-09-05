import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/admin-login.client";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getEnrichedEntriesForEvent,
  getFinalizedAgeClassIds,
  getRaceEvent,
} from "@/lib/dal/races";
import { AdminEventClient } from "./admin-event.client";

export const dynamic = "force-dynamic";

export default async function AdminEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminSession())) return <AdminLogin title="Admin · Zeiten erfassen" />;

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  const event = await getRaceEvent(eventId);
  if (!event) notFound();

  const [entries, finalizedAgeClassIds] = await Promise.all([
    getEnrichedEntriesForEvent(eventId),
    getFinalizedAgeClassIds(eventId),
  ]);

  // Group + sort by age class
  const byClass = new Map<
    number,
    {
      ageClassId: number;
      sortOrder: number;
      name: string;
      entries: typeof entries;
    }
  >();
  for (const e of entries) {
    let g = byClass.get(e.ageClassId);
    if (!g) {
      g = {
        ageClassId: e.ageClassId,
        sortOrder: e.ageClassSortOrder,
        name: e.ageClassName,
        entries: [],
      };
      byClass.set(e.ageClassId, g);
    }
    g.entries.push(e);
  }
  const groups = [...byClass.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  return (
    <AdminEventClient
      event={{
        id: event.id,
        name: event.name,
        number: event.number,
        eventDate: event.eventDate,
        status: event.status,
        liveAgeClassId: event.liveAgeClassId,
      }}
      groups={groups.map((g) => ({
        ageClassId: g.ageClassId,
        name: g.name,
        isFinalized: finalizedAgeClassIds.has(g.ageClassId),
        entries: g.entries.map((e) => ({
          entryId: e.entryId,
          firstName: e.firstName,
          lastName: e.lastName,
          teamName: e.teamName,
          startingOrder: e.startingOrder,
          driverType: e.driverType,
          storedFinishPosition: e.storedFinishPosition ?? null,
          runs: {
            test: e.runs.test,
            first: e.runs.first,
            second: e.runs.second,
          },
        })),
      }))}
    />
  );
}
