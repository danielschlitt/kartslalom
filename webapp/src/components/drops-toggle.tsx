import Link from "next/link";
import { cn } from "@/lib/utils";

const OPTIONS: { value: "on" | "off"; label: string }[] = [
  { value: "on", label: "an" },
  { value: "off", label: "aus" },
];

/**
 * Tiny on/off toggle for the championship Streichergebnis rule. Lives on the
 * championship pages only — the per-event analysis view has its own filter
 * (best/first/second + Strafsek.) and doesn't touch drops.
 */
export function DropsToggle({
  basePath,
  searchParams,
  applyDrops,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  applyDrops: boolean;
}) {
  const buildHref = (next: "on" | "off") => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "drops") continue;
      if (v) sp.set(k, v);
    }
    sp.set("drops", next);
    return `${basePath}?${sp.toString()}`;
  };

  const current: "on" | "off" = applyDrops ? "on" : "off";

  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <span className="text-xs tracking-wider text-[var(--color-muted)] uppercase">
        Streich.
      </span>
      <div className="flex flex-wrap gap-1">
        {OPTIONS.map((o) => (
          <Link
            key={o.value}
            href={buildHref(o.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              current === o.value
                ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            )}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Default ON unless URL explicitly opts out via `?drops=off`. */
export function parseApplyDrops(searchParams: { drops?: string }): boolean {
  return searchParams.drops !== "off";
}
