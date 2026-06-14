import Link from "next/link";
import { Calendar, Flag, Medal, Trophy, Zap } from "lucide-react";
import { getActiveAgeClasses, getAllRaceEvents } from "@/lib/dal/races";
import { cn, formatDateDe } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [events, ageClasses] = await Promise.all([
    getAllRaceEvents(),
    getActiveAgeClasses(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Saison 2026</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Hessen-Thüringen Süd · 8 Rennen · davon 5 für die HMJ-Wertung
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLink
          href="/championship"
          icon={<Trophy className="h-4 w-4" />}
          label="Endwertung"
          hint="HTS · HMJ"
        />
        <QuickLink
          href="/championship/live"
          icon={<Zap className="h-4 w-4" />}
          label="Live-Meisterschaft"
          hint="inkl. laufendem Rennen"
          accent
        />
        <QuickLink
          href="/admin"
          icon={<Calendar className="h-4 w-4" />}
          label="Admin"
          hint="Zeiten erfassen"
        />
        <QuickLink
          href="/admin/import"
          icon={<Flag className="h-4 w-4" />}
          label="Import"
          hint="CSV-Backfill"
        />
      </div>

      {ageClasses.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            Meisterschaft pro Altersklasse
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {ageClasses.map((c) => (
              <Link
                key={c.id}
                href={`/championship/class/${c.id}`}
                className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:bg-[var(--color-surface-2)]"
              >
                <span className="rounded-md bg-[var(--color-surface-2)] p-2 text-[var(--color-muted)]">
                  <Medal className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-xs text-[var(--color-muted)]">
                    Meisterschaft
                  </span>
                  <span className="text-sm font-semibold">{c.name}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          Renntermine
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {events.map((e) => (
            <Link
              key={e.id}
              href={`/events/${e.id}`}
              className={cn(
                "rounded-lg border bg-[var(--color-surface)] p-3 transition-colors hover:bg-[var(--color-surface-2)]",
                e.status === "live"
                  ? "border-[var(--color-live)]/60"
                  : "border-[var(--color-border)]",
              )}
            >
              <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
                <span>R{e.number} · {formatDateDe(e.eventDate)}</span>
                <StatusBadge status={e.status} />
              </div>
              <div className="mt-1 font-semibold">{e.hostTeamName}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <Tag>{e.kartType === "electric" ? "Elektro" : "Benzin"}</Tag>
                {e.isHmj && <Tag tone="hmj">HMJ</Tag>}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
  hint,
  accent,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 transition-colors",
        accent
          ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/15"
          : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]",
      )}
    >
      <span
        className={cn(
          "rounded-md p-2",
          accent
            ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
            : "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-[var(--color-muted)]">{hint}</span>
      </span>
    </Link>
  );
}

function StatusBadge({ status }: { status: "upcoming" | "live" | "completed" }) {
  if (status === "live")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-live)]/15 px-1.5 py-0.5 font-semibold text-[var(--color-live)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-live)]" />
        LIVE
      </span>
    );
  if (status === "completed")
    return <span className="text-[var(--color-muted)]">Beendet</span>;
  return <span className="text-[var(--color-pending)]">Geplant</span>;
}

function Tag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "hmj";
}) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5",
        tone === "hmj"
          ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          : "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
      )}
    >
      {children}
    </span>
  );
}
