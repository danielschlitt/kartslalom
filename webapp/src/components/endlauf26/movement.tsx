import { ArrowDown, ArrowUp, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Championship movement indicator: green arrow up + places gained, red arrow
 * down + places lost, white dot + 0 when unchanged. `delta` null → "—".
 */
export function Movement({
  delta,
  className,
}: {
  delta: number | null;
  className?: string;
}) {
  if (delta === null) {
    return <span className={cn("text-[var(--color-muted)]", className)}>—</span>;
  }
  if (delta > 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-semibold tabular-nums text-[var(--color-rank-green)]",
          className,
        )}
        title={`${delta} ${delta === 1 ? "Platz" : "Plätze"} gewonnen`}
      >
        <ArrowUp className="h-3.5 w-3.5" />
        {delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-semibold tabular-nums text-[var(--color-live)]",
          className,
        )}
        title={`${-delta} ${-delta === 1 ? "Platz" : "Plätze"} verloren`}
      >
        <ArrowDown className="h-3.5 w-3.5" />
        {-delta}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums text-[var(--color-foreground)]",
        className,
      )}
      title="unverändert"
    >
      <Circle className="h-2.5 w-2.5 fill-current" />0
    </span>
  );
}
