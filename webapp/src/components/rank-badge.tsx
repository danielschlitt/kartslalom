import { cn } from "@/lib/utils";

export function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank <= 2
      ? "bg-[var(--color-rank-blue)] text-white"
      : rank <= 4
        ? "bg-[var(--color-rank-green)] text-white"
        : "bg-[var(--color-rank-grey)] text-white/90";
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold tabular-nums",
        tone,
      )}
    >
      {rank}.
    </span>
  );
}
