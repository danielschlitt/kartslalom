export function EventStatusBadge({
  status,
}: {
  status: "upcoming" | "live" | "completed";
}) {
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
