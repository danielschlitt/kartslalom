import { cn, formatTime } from "@/lib/utils";
import type { RunValue, RunHighlight } from "@/lib/ranking";

/**
 * Three sub-cells per Wertungslauf:
 * - Zeit (raw time)         · highlight green if fastest raw in this run, violet if also fastest raw overall
 * - Strafsek                · no highlight
 * - Gesamt (time + penalty) · highlight green if fastest total in this run, violet if also fastest total overall
 *
 * Pass `withSeparator` to render a left border on the first cell of the run group.
 */
export function RunCells({
  run,
  highlight,
  withSeparator,
}: {
  run: RunValue | null | undefined;
  highlight?: RunHighlight;
  withSeparator?: boolean;
}) {
  const time = run?.timeSeconds ?? null;
  const penalty = run?.penaltySeconds ?? 0;
  const total =
    time !== null && time !== undefined ? time + penalty : null;

  return (
    <>
      <td
        className={cn(
          "px-2 py-1.5 text-right tabular-nums",
          withSeparator && "border-l border-[var(--color-border)]/40",
          highlightClass(
            highlight?.fastestInRun.raw,
            highlight?.fastestOverall.raw,
          ),
        )}
      >
        {formatTime(time)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-muted)]">
        {penalty > 0 ? `+${penalty}` : "0"}
      </td>
      <td
        className={cn(
          "px-2 py-1.5 text-right font-medium tabular-nums",
          highlightClass(
            highlight?.fastestInRun.total,
            highlight?.fastestOverall.total,
          ),
        )}
      >
        {formatTime(total)}
      </td>
    </>
  );
}

function highlightClass(fastestInRun?: boolean, fastestOverall?: boolean) {
  if (fastestOverall)
    return "bg-[var(--color-fastest-overall)] text-[var(--color-fastest-overall-fg)]";
  if (fastestInRun)
    return "bg-[var(--color-fastest-run)] text-[var(--color-fastest-run-fg)]";
  return "";
}
