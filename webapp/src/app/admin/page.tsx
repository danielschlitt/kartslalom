import Link from "next/link";
import { ArrowRight, Upload } from "lucide-react";
import { getAllRaceEvents } from "@/lib/dal/races";
import { cn, formatDateDe } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminIndexPage() {
  const events = await getAllRaceEvents();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Startreihenfolge festlegen, Zeiten erfassen, Status setzen.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/admin/import"
          className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:bg-[var(--color-surface-2)]"
        >
          <Upload className="h-4 w-4 text-[var(--color-muted)]" />
          <div className="flex-1">
            <div className="text-sm font-semibold">CSV-Import</div>
            <div className="text-xs text-[var(--color-muted)]">
              Vergangene Rennen mit Zeiten nachpflegen
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-[var(--color-muted)]" />
        </Link>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          Rennen
        </h2>
        <div className="space-y-2">
          {events.map((e) => (
            <Link
              key={e.id}
              href={`/admin/events/${e.id}`}
              className={cn(
                "flex items-center justify-between rounded-lg border bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-2)]",
                e.status === "live"
                  ? "border-[var(--color-live)]/60"
                  : "border-[var(--color-border)]",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--color-muted)]">R{e.number}</span>
                <span className="font-semibold">{e.name}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {formatDateDe(e.eventDate)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {e.status === "live" && (
                  <span className="rounded-md bg-[var(--color-live)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-live)]">
                    LIVE
                  </span>
                )}
                {e.status === "completed" && (
                  <span className="text-xs text-[var(--color-muted)]">Beendet</span>
                )}
                {e.status === "upcoming" && (
                  <span className="text-xs text-[var(--color-pending)]">Geplant</span>
                )}
                <ArrowRight className="h-4 w-4 text-[var(--color-muted)]" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
