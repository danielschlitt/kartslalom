"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

interface RecomputeResponse {
  ok: boolean;
  eventsTouched: number;
  classesTouched: number;
  entriesUpdated: number;
}

export function RecomputeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (
      !confirm(
        "Alle Streichlisten und Punkte neu berechnen? Für jede finalisierte Altersklasse mit Zeiten werden Platz und Punkte aus den Läufen (Bester Lauf + Strafsek.) neu abgeleitet.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/recompute-points", {
        method: "POST",
      });
      if (!res.ok) {
        setError("Neuberechnung fehlgeschlagen.");
        return;
      }
      const data: RecomputeResponse = await res.json();
      setMessage(
        data.entriesUpdated === 0
          ? "Alles aktuell — keine Änderungen nötig."
          : `Aktualisiert: ${data.entriesUpdated} Einträge in ${data.classesTouched} Altersklassen über ${data.eventsTouched} Rennen.`,
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
          <div className="text-sm font-semibold">Streichliste neu berechnen</div>
          <div className="text-xs text-[var(--color-muted)]">
            Punkte und Plätze für alle finalisierten Altersklassen mit Zeiten
            aus den Läufen ableiten.
          </div>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
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
      </div>
      {(message || error) && (
        <p
          className={cn(
            "text-xs sm:basis-full sm:text-right",
            error ? "text-red-400" : "text-[var(--color-muted)]",
          )}
        >
          {error ?? message}
        </p>
      )}
    </div>
  );
}
