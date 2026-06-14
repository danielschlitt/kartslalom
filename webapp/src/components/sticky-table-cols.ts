import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const mdReset =
  "md:static md:z-auto md:w-auto md:min-w-0 md:max-w-none md:border-r-0 md:bg-transparent md:shadow-none";

/** Sticky rank column (#) — fixed on mobile horizontal scroll. */
export function stickyRankClass({ header = false }: { header?: boolean } = {}) {
  return cn(
    "max-md:sticky max-md:left-0 max-md:w-11 max-md:min-w-11 max-md:max-w-11",
    header ? "max-md:z-20 max-md:bg-[var(--color-surface)]" : "max-md:z-10",
    mdReset,
  );
}

/** Sticky driver column — fixed on mobile horizontal scroll. */
export function stickyDriverClass({
  header = false,
}: { header?: boolean } = {}) {
  return cn(
    "max-md:sticky max-md:left-11 max-md:min-w-[7.5rem] max-md:max-w-[10rem]",
    "max-md:border-r max-md:border-[var(--color-border)]",
    "max-md:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.5)]",
    header ? "max-md:z-20 max-md:bg-[var(--color-surface)]" : "max-md:z-10",
    mdReset,
  );
}

/** Opaque background for sticky body cells (required so scrolled content doesn't show through). */
export function stickyBodyBg(
  isHome: boolean,
  homeBg: string,
): CSSProperties | undefined {
  if (isHome) return { backgroundColor: homeBg };
  return undefined;
}
