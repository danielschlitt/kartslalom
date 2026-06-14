import Link from "next/link";
import { cn } from "@/lib/utils";

export type SeriesParam = "hts" | "hmj";

export function SeriesTabs({
  active,
  basePath,
  searchParams,
}: {
  active: SeriesParam;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
}) {
  const build = (s: SeriesParam) => {
    const sp = new URLSearchParams();
    if (searchParams) {
      for (const [k, v] of Object.entries(searchParams)) {
        if (v) sp.set(k, v);
      }
    }
    sp.set("series", s);
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className="inline-flex rounded-lg bg-[var(--color-surface-2)] p-1">
      <Tab href={build("hts")} active={active === "hts"}>
        Hessen-Thüringen Süd
      </Tab>
      <Tab href={build("hmj")} active={active === "hmj"}>
        HMJ
      </Tab>
    </div>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
      )}
    >
      {children}
    </Link>
  );
}
