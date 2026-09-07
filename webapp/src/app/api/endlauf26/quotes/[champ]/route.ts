import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/admin-auth";
import {
  getCachedQuotes,
  getEndlaufChampionship,
  getEndlaufResultsForChampionship,
  saveCachedQuotes,
  toEventInfo,
} from "@/lib/dal/endlauf26";
import { HOME_REGION, HOME_TEAM } from "@/lib/endlauf26/home-team";
import {
  factsToQuotes,
  generateQuotes,
  getQuotesModel,
  QuotesTextError,
  quotesStateHash,
} from "@/lib/endlauf26/quotes-text";
import { championshipFromSlug } from "@/lib/endlauf26/ranking";
import { buildSubjectFacts, type GroupKind, type SubjectFacts } from "@/lib/endlauf26/team-stats";

export const dynamic = "force-dynamic";

export interface QuotesResponse {
  subject: GroupKind;
  subjectName: string;
  quotes: string[];
  /** `ai` = fresh from OpenAI, `cache` = stored, `rules` = deterministic fallback */
  source: "ai" | "cache" | "rules";
  model: string | null;
  createdAt: string | null;
  facts: SubjectFacts;
  /** Set when the AI call failed and the rule-based quotes are shown instead. */
  error?: string;
}

/**
 * Concurrent cache misses for the same facts (the teams page loads two cards
 * at once, several browsers may open it) share one OpenAI call per process.
 */
const inFlight = new Map<string, Promise<string[]>>();

function generateOnce(key: string, run: () => Promise<string[]>): Promise<string[]> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = run().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * Public. Social-media quotes about the home club (`?subject=team`) or the
 * home region (`?subject=region`), phrased by OpenAI from deterministic
 * facts. Cached per (championship, subject) until the facts change.
 * `?refresh=1` (admins only) regenerates ignoring the cache.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ champ: string }> }) {
  const { champ } = await params;
  const championship = championshipFromSlug(champ);
  if (!championship) return NextResponse.json({ error: "invalid_championship" }, { status: 400 });

  const subjectParam = req.nextUrl.searchParams.get("subject") ?? "team";
  if (subjectParam !== "team" && subjectParam !== "region") {
    return NextResponse.json({ error: "invalid_subject" }, { status: 400 });
  }
  const subject: GroupKind = subjectParam;
  const subjectName = subject === "team" ? HOME_TEAM : HOME_REGION;
  const refresh = req.nextUrl.searchParams.get("refresh") === "1" && (await isAdminSession());

  const [data, results] = await Promise.all([
    getEndlaufChampionship(championship),
    getEndlaufResultsForChampionship(championship),
  ]);
  const facts = buildSubjectFacts(
    championship,
    subject,
    subjectName,
    data.rows,
    data.events.map(toEventInfo),
    results,
    data.scored,
  );
  if (!facts) return NextResponse.json({ error: "subject_not_in_field" }, { status: 404 });

  const model = getQuotesModel();
  const stateHash = quotesStateHash(facts, model);
  const base = { subject, subjectName: facts.subjectName, facts };

  if (!refresh) {
    const cached = await getCachedQuotes(championship, subject);
    if (cached && cached.stateHash === stateHash && cached.quotes.length > 0) {
      const body: QuotesResponse = {
        ...base,
        quotes: cached.quotes,
        source: "cache",
        model: cached.model,
        createdAt: cached.createdAt,
      };
      return NextResponse.json(body);
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const body: QuotesResponse = {
      ...base,
      quotes: factsToQuotes(facts),
      source: "rules",
      model: null,
      createdAt: null,
    };
    return NextResponse.json(body);
  }

  try {
    const quotes = await generateOnce(`${championship}:${subject}:${stateHash}:${refresh ? Date.now() : ""}`, () =>
      generateQuotes(facts, apiKey, model),
    );
    await saveCachedQuotes({ championship, subject, stateHash, quotes, model });
    const body: QuotesResponse = {
      ...base,
      quotes,
      source: "ai",
      model,
      createdAt: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (err) {
    const code = err instanceof QuotesTextError ? err.code : "unknown";
    console.error("[endlauf26/quotes]", championship, subject, code, err instanceof Error ? err.message : err);
    const body: QuotesResponse = {
      ...base,
      quotes: factsToQuotes(facts),
      source: "rules",
      model: null,
      createdAt: null,
      error: code,
    };
    return NextResponse.json(body);
  }
}
