import Link from "next/link";
import { Flag, Settings, Trophy, Users, Zap } from "lucide-react";
import {
  ENDLAUF26_LABELS,
  ENDLAUF26_SLUGS,
  type Endlauf26Championship,
} from "@/lib/endlauf26/ranking";
import { cn } from "@/lib/utils";

export type ChampTab = "standings" | "events" | "teams" | "live" | "admin";

export function ChampHeader({
  championship,
  active,
  title,
  subtitle,
  isLive,
}: {
  championship: Endlauf26Championship;
  active: ChampTab;
  title?: string;
  subtitle?: string;
  isLive?: boolean;
}) {
  const slug = ENDLAUF26_SLUGS[championship];
  const base = `/endlauf26/${slug}`;
  const labels = ENDLAUF26_LABELS[championship];
  const tabs: { id: ChampTab; href: string; label: string; icon: React.ReactNode }[] = [
    { id: "standings", href: base, label: "Wertung", icon: <Trophy className="h-4 w-4" /> },
    { id: "events", href: `${base}/events`, label: "Endläufe", icon: <Flag className="h-4 w-4" /> },
    { id: "teams", href: `${base}/teams`, label: "Vereine", icon: <Users className="h-4 w-4" /> },
    { id: "live", href: `${base}/live`, label: "Live", icon: <Zap className="h-4 w-4" /> },
    { id: "admin", href: `${base}/admin`, label: "Admin", icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-wider text-[var(--color-accent)] uppercase">
            Endläufe 2026 · {labels.short}
          </div>
          <h1 className="text-2xl font-semibold">{title ?? labels.long}</h1>
          <p className="text-sm text-[var(--color-muted)]">{subtitle ?? labels.subtitle}</p>
        </div>
        <Link
          href={`/endlauf26/${championship === "hmj" ? ENDLAUF26_SLUGS.adac_hth : ENDLAUF26_SLUGS.hmj}`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:underline"
        >
          → {championship === "hmj" ? ENDLAUF26_LABELS.adac_hth.short : ENDLAUF26_LABELS.hmj.short}
        </Link>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-[var(--color-border)] text-sm">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-3 py-2",
              active === t.id
                ? "border-[var(--color-accent)] text-[var(--color-foreground)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
              t.id === "live" && isLive && "text-[var(--color-live)]",
            )}
          >
            {t.icon}
            {t.label}
            {t.id === "live" && isLive && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-live)]" />
            )}
          </Link>
        ))}
      </nav>
    </header>
  );
}
