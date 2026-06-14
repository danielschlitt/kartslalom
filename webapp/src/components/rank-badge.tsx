import { cn } from "@/lib/utils";

export function RankBadge({
  rank,
  isHomeTeam = false,
}: {
  rank: number;
  isHomeTeam?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold tabular-nums",
        isHomeTeam
          ? "bg-[var(--color-rank-blue)] text-white"
          : "text-[var(--color-foreground)]",
      )}
    >
      {rank}.
    </span>
  );
}
