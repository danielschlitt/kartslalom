import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/admin-login.client";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getClassPool,
  getEndlaufEntriesForEvent,
  getEndlaufEventBySlug,
  getEndlaufEvents,
  getEndlaufResults,
  getResultImages,
  getStartLists,
} from "@/lib/dal/endlauf26";
import {
  ageClassName,
  championshipFromSlug,
  ENDLAUF26_AGE_CLASSES,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { standingsOrderApplies, startOrderBaseLabel } from "@/lib/endlauf26/start-order";
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

  const [entries, results, images, startLists, events, pools] = await Promise.all([
    getEndlaufEntriesForEvent(event.id),
    getEndlaufResults(event.id),
    getResultImages(event.id),
    getStartLists(event.id),
    getEndlaufEvents(championship),
    Promise.all(ENDLAUF26_AGE_CLASSES.map((c) => getClassPool(championship, c, event.id))),
  ]);

  const groups: AdminGroup[] = ENDLAUF26_AGE_CLASSES.map((c, i) => ({
    ageClass: c,
    name: ageClassName(c),
    entries: entries
      .filter((e) => e.ageClass === c)
      .map((e) => ({
        entryId: e.entryId,
        driverId: e.driverId,
        firstName: e.firstName,
        lastName: e.lastName,
        teamName: e.teamName,
        nominated: e.nominated,
        startingOrder: e.startingOrder,
        runs: e.runs,
        positionLive: e.positionLive,
      })),
    results: results.filter((r) => r.ageClass === c),
    images: images.filter((im) => im.ageClass === c),
    startLists: startLists.filter((s) => s.ageClass === c),
    pool: pools[i],
  })).filter((g) => g.pool.length > 0 || g.entries.length > 0 || g.results.length > 0);

  const champSlug = ENDLAUF26_SLUGS[championship];
  return (
    <AdminEndlaufClient
      basePath={`/endlauf26/${champSlug}`}
      championshipSlug={champSlug}
      event={{
        id: event.id,
        slug: event.slug,
        number: event.number,
        name: event.name,
        factor: event.factor,
        status: event.status,
        liveAgeClass: event.liveAgeClass,
        liveEntryId: event.liveEntryId,
        championship,
        startOrder: {
          baseLabel: startOrderBaseLabel(championship, event, events),
          canSync: standingsOrderApplies(championship, event),
        },
      }}
      groups={groups}
    />
  );
}
