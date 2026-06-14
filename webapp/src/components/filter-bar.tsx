import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Metric, PenaltyMode } from "@/lib/ranking";

const METRICS: { value: Metric; label: string }[] = [
  { value: "best", label: "Bester Lauf" },
  { value: "sum", label: "Beide Läufe" },
  { value: "first", label: "Nur 1. Lauf" },
  { value: "second", label: "Nur 2. Lauf" },
];

const PENALTIES: { value: PenaltyMode; label: string }[] = [
  { value: "with", label: "mit Strafsek." },
  { value: "without", label: "ohne Strafsek." },
  { value: "only", label: "nur Strafsek." },
];

/**
 * Virtual-view selector that survives via search params. Used on the
 * championship pages to recompute points across events that have run
 * timing data. Events without run times keep their stored points so the
 * filter never destabilises older races.
 */
export function FilterBar({
  basePath,
  searchParams,
  metric,
  penaltyMode,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  metric: Metric;
  penaltyMode: PenaltyMode;
}) {
  const buildHref = (next: Partial<{ metric: Metric; penalty: PenaltyMode }>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) sp.set(k, v);
    }
    if (next.metric) sp.set("metric", next.metric);
    if (next.penalty) sp.set("penalty", next.penalty);
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-xs tracking-wider text-[var(--color-muted)] uppercase">
          Wertung
        </span>
        {METRICS.map((m) => (
          <Link
            key={m.value}
            href={buildHref({ metric: m.value })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              metric === m.value
                ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            )}
          >
            {m.label}
          </Link>
        ))}
      </div>
      <div className="h-4 w-px bg-[var(--color-border)]" />
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-xs tracking-wider text-[var(--color-muted)] uppercase">
          Strafsek.
        </span>
        {PENALTIES.map((p) => (
          <Link
            key={p.value}
            href={buildHref({ penalty: p.value })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              penaltyMode === p.value
                ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function parseViewMode(searchParams: {
  metric?: string;
  penalty?: string;
}): { metric: Metric; penaltyMode: PenaltyMode } {
  const metric: Metric =
    searchParams.metric === "first" ||
    searchParams.metric === "second" ||
    searchParams.metric === "sum"
      ? searchParams.metric
      : "best";
  const penaltyMode: PenaltyMode =
    searchParams.penalty === "without" || searchParams.penalty === "only"
      ? searchParams.penalty
      : "with";
  return { metric, penaltyMode };
}
