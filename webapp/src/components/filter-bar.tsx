import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Metric, PenaltyMode, ViewMode } from "@/lib/ranking";

/**
 * Analysis filter for the per-event details page. Lets the public explore
 * how positions would change under different scoring views, without ever
 * altering the official championship totals.
 */
export type AnalysisMetric = Extract<Metric, "best" | "first" | "second">;
export type AnalysisPenalty = Extract<PenaltyMode, "with" | "without">;

const METRICS: { value: AnalysisMetric; label: string }[] = [
  { value: "best", label: "Bester Lauf" },
  { value: "first", label: "Nur 1. Lauf" },
  { value: "second", label: "Nur 2. Lauf" },
];

const PENALTIES: { value: AnalysisPenalty; label: string }[] = [
  { value: "with", label: "mit Strafsek." },
  { value: "without", label: "ohne Strafsek." },
];

export function EventAnalysisFilterBar({
  basePath,
  searchParams,
  metric,
  penaltyMode,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  metric: AnalysisMetric;
  penaltyMode: AnalysisPenalty;
}) {
  const buildHref = (
    next: Partial<{ metric: AnalysisMetric; penalty: AnalysisPenalty }>,
  ) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) sp.set(k, v);
    }
    if (next.metric) sp.set("metric", next.metric);
    if (next.penalty) sp.set("penalty", next.penalty);
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:flex-row md:flex-wrap md:items-center md:gap-3">
      <FilterGroup label="Wertung">
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
      </FilterGroup>
      <Divider />
      <FilterGroup label="Strafsek.">
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
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 md:flex-row md:items-center md:gap-1">
      <span className="w-full px-1 text-center text-xs tracking-wider text-[var(--color-muted)] uppercase md:w-auto md:text-left">
        {label}
      </span>
      <div className="flex flex-wrap justify-center gap-1 md:justify-start">
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return (
    <>
      <div className="hidden h-4 w-px bg-[var(--color-border)] md:block" />
      <div className="h-px w-full bg-[var(--color-border)] md:hidden" />
    </>
  );
}

export function parseAnalysisView(searchParams: {
  metric?: string;
  penalty?: string;
}): ViewMode & { metric: AnalysisMetric; penaltyMode: AnalysisPenalty } {
  const metric: AnalysisMetric =
    searchParams.metric === "first" || searchParams.metric === "second"
      ? searchParams.metric
      : "best";
  const penaltyMode: AnalysisPenalty =
    searchParams.penalty === "without" ? "without" : "with";
  return { metric, penaltyMode };
}
