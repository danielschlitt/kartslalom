import { NextRequest, NextResponse } from "next/server";
import {
  getCachedPrediction,
  getEndlaufChampionship,
  getEndlaufDriver,
  saveCachedPrediction,
  toEventInfo,
} from "@/lib/dal/endlauf26";
import {
  generatePredictionText,
  getPredictionModel,
  PredictTextError,
  predictionStateHash,
} from "@/lib/endlauf26/predict-text";
import { buildPredictionFacts, factsToPlainText } from "@/lib/endlauf26/prediction";

export const dynamic = "force-dynamic";

export interface PredictionResponse {
  text: string;
  /** `ai` = fresh from OpenAI, `cache` = stored text, `rules` = deterministic fallback */
  source: "ai" | "cache" | "rules";
  model: string | null;
  createdAt: string | null;
  summary: {
    rank: number | null;
    classSize: number;
    theoreticalBestRank: number | null;
    realisticBestRank: number | null;
    realisticWorstRank: number | null;
    remainingEvents: string[];
  };
  /** Set when the AI call failed and the rules text is shown instead. */
  error?: string;
}

/**
 * Public. What is still possible for a driver in the championship, phrased
 * by OpenAI from deterministic simulations. Cached per driver until the
 * standings change.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const driverId = Number(id);
  if (!Number.isInteger(driverId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const driver = await getEndlaufDriver(driverId);
  if (!driver) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const data = await getEndlaufChampionship(driver.d.championship);
  const facts = buildPredictionFacts(
    data.championship,
    data.drivers,
    data.events.map(toEventInfo),
    data.rows,
    driverId,
    data.scored,
  );
  if (!facts) return NextResponse.json({ error: "not_in_field" }, { status: 404 });

  const summary: PredictionResponse["summary"] = {
    rank: facts.driver.rank,
    classSize: facts.classSize,
    theoreticalBestRank: facts.theoreticalBestRank,
    realisticBestRank: facts.realisticBestRank,
    realisticWorstRank: facts.realisticWorstRank,
    remainingEvents: facts.remainingEvents.map((e) => e.name),
  };

  const model = getPredictionModel();
  const stateHash = predictionStateHash(facts, model);

  const cached = await getCachedPrediction(driverId);
  if (cached && cached.stateHash === stateHash) {
    const body: PredictionResponse = {
      text: cached.text,
      source: "cache",
      model: cached.model,
      createdAt: cached.createdAt,
      summary,
    };
    return NextResponse.json(body);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const body: PredictionResponse = {
      text: factsToPlainText(facts),
      source: "rules",
      model: null,
      createdAt: null,
      summary,
    };
    return NextResponse.json(body);
  }

  try {
    const text = await generatePredictionText(facts, apiKey, model);
    await saveCachedPrediction({ driverId, stateHash, text, model });
    const body: PredictionResponse = {
      text,
      source: "ai",
      model,
      createdAt: new Date().toISOString(),
      summary,
    };
    return NextResponse.json(body);
  } catch (err) {
    const code = err instanceof PredictTextError ? err.code : "unknown";
    console.error("[endlauf26/prediction]", driverId, code, err instanceof Error ? err.message : err);
    const body: PredictionResponse = {
      text: factsToPlainText(facts),
      source: "rules",
      model: null,
      createdAt: null,
      summary,
      error: code,
    };
    return NextResponse.json(body);
  }
}
