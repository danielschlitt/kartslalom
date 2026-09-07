import { DKM_NAME } from "@/lib/endlauf26/ranking";
import { cn } from "@/lib/utils";

/**
 * Small inline German flag (black / red / gold). Marks positions that
 * qualify for the national finals (DKM der dmsj).
 */
export function GermanFlag({
  className,
  title = `Qualifiziert für die ${DKM_NAME}`,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 5 3"
      className={cn("inline-block h-2.5 w-4 shrink-0 rounded-[1px] align-middle", className)}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <rect width="5" height="1" y="0" fill="#000" />
      <rect width="5" height="1" y="1" fill="#DD0000" />
      <rect width="5" height="1" y="2" fill="#FFCE00" />
    </svg>
  );
}
