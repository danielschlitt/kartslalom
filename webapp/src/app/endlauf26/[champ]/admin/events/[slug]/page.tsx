import { notFound } from "next/navigation";
import { AdminLogin } from "@/components/admin-login.client";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getClassPool,
  getEndlaufEntriesForEvent,
  getEndlaufEventBySlug,
  getEndlaufResults,
  getResultImages,
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

  const [entries, results, images, pools] = await Promise.all([
    getEndlaufEntriesForEvent(event.id),
    getEndlaufResults(event.id),
    getResultImages(event.id),
    Promise.all(ENDLAUF26_AGE_CLASSES.map((c) => getClassPool(championship, c, event.id))),
  ]);

  const groups: AdminGroup[] = ENDLAUF26_AGE_CLASSES.map((c, i) => ({
    ageClass: c,
    name: ageClassName(c),
    entries: entries
      .filter((e) => e.ageClass === c)
      .map((e) => ({
        entryId: e.entryId,
        firstName: e.firstName,
        lastName: e.lastName,
        teamName: e.teamName,
        startingOrder: e.startingOrder,
        runs: e.runs,
        positionLive: e.positionLive,
      })),
    results: results.filter((r) => r.ageClass === c),
    images: images.filter((im) => im.ageClass === c),
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
      }}
      groups={groups}
    />
  );
}
