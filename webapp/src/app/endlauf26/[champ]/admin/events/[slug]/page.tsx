import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/admin-login.client";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getEndlaufEntriesForEvent,
  getEndlaufEventBySlug,
  getFinalizedClasses,
} from "@/lib/dal/endlauf26";
import {
  ageClassName,
  championshipFromSlug,
  ENDLAUF26_AGE_CLASSES,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { AdminEndlaufClient, type AdminGroup } from "./admin-endlauf.client";

export const dynamic = "force-dynamic";

export default async function EndlaufAdminEventPage({
  params,
}: {
  params: Promise<{ champ: string; slug: string }>;
}) {
  const { champ, slug } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();

  if (!(await isAdminSession())) return <AdminLogin title="Admin · Endlauf" />;

  const event = await getEndlaufEventBySlug(championship, slug);
  if (!event) notFound();

  const [entries, finalized] = await Promise.all([
    getEndlaufEntriesForEvent(event.id),
    getFinalizedClasses(event.id),
  ]);

  const groups: AdminGroup[] = ENDLAUF26_AGE_CLASSES.map((c) => ({
    ageClass: c,
    name: ageClassName(c),
    isFinalized: finalized.has(c),
    entries: entries
      .filter((e) => e.ageClass === c)
      .map((e) => ({
        entryId: e.entryId,
        firstName: e.firstName,
        lastName: e.lastName,
        teamName: e.teamName,
        startingOrder: e.startingOrder,
        runs: e.runs,
        positionRun1: e.positionRun1,
        positionRun2: e.positionRun2,
        positionLive: e.positionLive,
        finishPosition: e.finishPosition,
        pointsAwarded: e.pointsAwarded,
      })),
  })).filter((g) => g.entries.length > 0);

  return (
    <AdminEndlaufClient
      basePath={`/endlauf26/${ENDLAUF26_SLUGS[championship]}`}
      event={{
        id: event.id,
        slug: event.slug,
        number: event.number,
        name: event.name,
        factor: event.factor,
        status: event.status,
        liveAgeClass: event.liveAgeClass,
        liveEntryId: event.liveEntryId,
      }}
      groups={groups}
    />
  );
}
