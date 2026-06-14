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

const DROPS: { value: "on" | "off"; label: string }[] = [
  { value: "on", label: "an" },
  { value: "off", label: "aus" },
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
  applyDrops,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  metric: Metric;
  penaltyMode: PenaltyMode;
  applyDrops: boolean;
}) {
  const buildHref = (
    next: Partial<{
      metric: Metric;
      penalty: PenaltyMode;
      drops: "on" | "off";
    }>,
  ) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) sp.set(k, v);
    }
    if (next.metric) sp.set("metric", next.metric);
    if (next.penalty) sp.set("penalty", next.penalty);
    if (next.drops) sp.set("drops", next.drops);
    return `${basePath}?${sp.toString()}`;
  };

  const drops: "on" | "off" = applyDrops ? "on" : "off";

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
      <Divider />
      <FilterGroup label="Streich.">
        {DROPS.map((d) => (
          <Link
            key={d.value}
            href={buildHref({ drops: d.value })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              drops === d.value
                ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            )}
          >
            {d.label}
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

/** Default ON unless URL explicitly opts out via `?drops=off`. */
export function parseApplyDrops(searchParams: { drops?: string }): boolean {
  return searchParams.drops !== "off";
}
