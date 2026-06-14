import { notFound } from "next/navigation";
import { getEnrichedEntriesForEvent, getRaceEvent } from "@/lib/dal/races";
import { AdminEventClient } from "./admin-event.client";

export const dynamic = "force-dynamic";

export default async function AdminEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) notFound();

  const event = await getRaceEvent(eventId);
  if (!event) notFound();

  const entries = await getEnrichedEntriesForEvent(eventId);

  // Group + sort by age class
  const byClass = new Map<
    number,
    {
      sortOrder: number;
      name: string;
      entries: typeof entries;
    }
  >();
  for (const e of entries) {
    let g = byClass.get(e.ageClassId);
    if (!g) {
      g = { sortOrder: e.ageClassSortOrder, name: e.ageClassName, entries: [] };
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
      }}
      groups={groups.map((g) => ({
        name: g.name,
        entries: g.entries.map((e) => ({
          entryId: e.entryId,
          firstName: e.firstName,
          lastName: e.lastName,
          teamName: e.teamName,
          startingOrder: e.startingOrder,
          driverType: e.driverType,
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
