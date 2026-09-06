"use client";

import { useEffect, useState } from "react";
import type { PredictionResponse } from "@/app/api/endlauf26/drivers/[id]/prediction/route";

/**
 * "AI Prediction" card on the driver detail page. Loads lazily so the page
 * itself renders instantly; the first view per standings state takes a few
 * seconds (OpenAI), afterwards it comes from the cache.
 */
export function AiPrediction({ driverId }: { driverId: number }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: PredictionResponse }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/endlauf26/drivers/${driverId}/prediction`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PredictionResponse;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ok", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <span className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          AI Prediction
        </span>
        {state.status === "ok" && (
          <span className="text-xs text-[var(--color-muted)]">
            {state.data.source === "rules"
              ? "regelbasiert"
              : `${state.data.model ?? "KI"}${state.data.createdAt ? ` · ${formatDate(state.data.createdAt)}` : ""}`}
          </span>
        )}
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        {state.status === "loading" && (
          <p className="animate-pulse text-[var(--color-muted)]">Einschätzung wird berechnet …</p>
        )}
        {state.status === "error" && (
          <p className="text-[var(--color-muted)]">
            Einschätzung derzeit nicht verfügbar ({state.message}).
          </p>
        )}
        {state.status === "ok" && (
          <>
            <p className="leading-relaxed">{state.data.text}</p>
            <Summary s={state.data.summary} />
            {state.data.error && (
              <p className="text-xs text-[var(--color-muted)]">
                KI-Text nicht verfügbar ({state.data.error}) – regelbasierte Zusammenfassung.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Summary({ s }: { s: PredictionResponse["summary"] }) {
  if (s.rank === null || s.remainingEvents.length === 0) return null;
  const items: { label: string; value: string }[] = [
    { label: "Aktuell", value: `${s.rank}. von ${s.classSize}` },
    { label: "Rechnerisch max.", value: s.theoreticalBestRank ? `${s.theoreticalBestRank}.` : "—" },
    { label: "Realistisch max.", value: s.realisticBestRank ? `${s.realisticBestRank}.` : "—" },
    { label: "Realistisch min.", value: s.realisticWorstRank ? `${s.realisticWorstRank}.` : "—" },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
      {items.map((it) => (
        <span key={it.label}>
          {it.label}: <span className="font-semibold text-[var(--color-foreground)] tabular-nums">{it.value}</span>
        </span>
      ))}
      <span className="basis-full">
        Annahme: eigener Sieg in {s.remainingEvents.join(", ")}; Gegner höchstens 5 Plätze unter ihrem aktuellen Wertungsplatz.
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
