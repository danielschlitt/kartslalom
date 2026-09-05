import { NextRequest, NextResponse } from "next/server";
import { isAdminSession, unauthorizedResponse } from "@/lib/admin-auth";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { endlauf26Events, endlauf26Finalizations } from "@/db/schema";
import { getEndlaufEntriesForEvent, writeFinalResults } from "@/lib/dal/endlauf26";
import { ENDLAUF26_AGE_CLASSES } from "@/lib/endlauf26/ranking";

async function loadEvent(id: string) {
  const eventId = Number(id);
  if (!Number.isFinite(eventId)) return { eventId, event: null };
  const [event] = await db
    .select()
    .from(endlauf26Events)
    .where(eq(endlauf26Events.id, eventId))
    .limit(1);
  return { eventId, event: event ?? null };
}

function parseAgeClass(body: unknown): number | null {
  const n = Number((body as { ageClass?: unknown })?.ageClass);
  return (ENDLAUF26_AGE_CLASSES as readonly number[]).includes(n) ? n : null;
}

/**
 * Finalize an age class: derive official positions + base points from the
 * times (best run + penalties) and lock the class. The results then flow
 * into the championship table.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const { eventId, event } = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const ageClass = parseAgeClass(body);
  if (ageClass === null) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }
  if (event.status === "live" && event.liveAgeClass === ageClass) {
    return NextResponse.json({ error: "age_class_still_live" }, { status: 400 });
  }
  const [existing] = await db
    .select()
    .from(endlauf26Finalizations)
    .where(
      and(
        eq(endlauf26Finalizations.eventId, eventId),
        eq(endlauf26Finalizations.ageClass, ageClass),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: "already_finalized" }, { status: 409 });
  }

  const entries = await getEndlaufEntriesForEvent(eventId, ageClass);
  if (entries.length === 0) {
    return NextResponse.json({ error: "no_entries" }, { status: 400 });
  }
  const hasTimes = entries.some(
    (e) => e.runs.first?.timeSeconds != null || e.runs.second?.timeSeconds != null,
  );
  if (!hasTimes && !body?.force) {
    return NextResponse.json({ error: "no_times" }, { status: 400 });
  }

  const written = await writeFinalResults(eventId, ageClass);
  await db.insert(endlauf26Finalizations).values({ eventId, ageClass });

  return NextResponse.json({ ok: true, entriesUpdated: written });
}

/** Re-open a finalized class (keeps the stored times; positions are recomputed on next save/finalize). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminSession())) return unauthorizedResponse();
  const { id } = await params;
  const { eventId, event } = await loadEvent(id);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const ageClass = parseAgeClass(body);
  if (ageClass === null) {
    return NextResponse.json({ error: "invalid_age_class" }, { status: 400 });
  }
  await db
    .delete(endlauf26Finalizations)
    .where(
      and(
        eq(endlauf26Finalizations.eventId, eventId),
        eq(endlauf26Finalizations.ageClass, ageClass),
      ),
    );
  return NextResponse.json({ ok: true });
}
