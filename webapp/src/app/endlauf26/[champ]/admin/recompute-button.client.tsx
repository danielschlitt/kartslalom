"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecomputeResponse {
  ok: boolean;
  eventsTouched: number;
  finalizedClasses: number;
  liveClasses: number;
  entriesUpdated: number;
}

export function EndlaufRecomputeButton({ championshipSlug }: { championshipSlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (
      !confirm(
        "Streichresultate, Plätze und Punkte der Endläufe neu berechnen?\n\nFür jede abgeschlossene Klasse werden Platz und Punkte aus den Zeiten (bester Lauf + Strafsek.) neu abgeleitet; für offene Klassen die Live-Positionen. Die Meisterschaftstabelle (Streichresultat, Faktoren, Pfeile) wird immer live aus diesen Werten berechnet.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/endlauf26/recompute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ championship: championshipSlug }),
      });
      if (!res.ok) {
        setError("Neuberechnung fehlgeschlagen.");
        return;
      }
      const data: RecomputeResponse = await res.json();
      setMessage(
        `Neu berechnet: ${data.entriesUpdated} Einträge in ${data.finalizedClasses} abgeschlossenen Klassen, ${data.liveClasses} offene Klassen mit Zeiten, ${data.eventsTouched} Endläufe.`,
      );
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const isWorking = busy || pending;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Calculator className="h-4 w-4 text-[var(--color-muted)]" />
        <div>
          <div className="text-sm font-semibold">Streichresultate neu berechnen</div>
          <div className="text-xs text-[var(--color-muted)]">
            Plätze, Punkte und Live-Positionen aller Endläufe aus den Zeiten ableiten.
          </div>
        </div>
      </div>
      <button
        onClick={run}
        disabled={isWorking}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-background)]",
          isWorking && "cursor-not-allowed opacity-60",
        )}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", isWorking && "animate-spin")} />
        {isWorking ? "Berechne…" : "Jetzt neu berechnen"}
      </button>
      {(message || error) && (
        <p className={cn("text-xs sm:basis-full sm:text-right", error ? "text-red-400" : "text-[var(--color-muted)]")}>
          {error ?? message}
        </p>
      )}
    </div>
  );
}
