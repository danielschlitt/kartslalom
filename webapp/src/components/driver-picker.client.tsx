"use client";

/**
 * Searchable driver picker used by the result-sheet review tables. Candidates
 * are `MatchCandidate`s (id in `entryId`, optional `tag` such as "Nachrücker").
 * Shows the match confidence badge of the proposed assignment.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { searchCandidates, type MatchCandidate, type MatchKind } from "@/lib/ocr/match-entries";

export type PickerKind = MatchKind | "manual";

export function DriverPicker<T extends MatchCandidate>({
  value,
  candidates,
  takenIds,
  kind,
  score,
  disabled,
  onChange,
}: {
  value: T | null;
  candidates: T[];
  takenIds: Set<number>;
  kind: PickerKind;
  score: number;
  disabled: boolean;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => searchCandidates(query, candidates).slice(0, 8) as T[],
    [query, candidates],
  );

  useEffect(() => setActive(0), [query]);

  const pick = (id: number | null) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const badge =
    value === null ? (
      <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-pending)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-pending)] uppercase">
        <AlertTriangle className="h-3 w-3" /> kein Treffer
      </span>
    ) : kind === "manual" ? (
      <span className="rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase">
        manuell
      </span>
    ) : kind === "high" ? (
      <span className="rounded-sm bg-[var(--color-rank-green)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-rank-green)] uppercase">
        {Math.round(score * 100)} %
      </span>
    ) : (
      <span
        className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-pending)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-pending)] uppercase"
        title="Unsichere Zuordnung — bitte prüfen"
      >
        <AlertTriangle className="h-3 w-3" /> {Math.round(score * 100)} % prüfen
      </span>
    );

  return (
    <div className="relative min-w-[14rem]">
      <div
        className={cn(
          "flex items-center gap-1 rounded-md border bg-[var(--color-background)] px-2 py-1",
          value === null
            ? "border-[var(--color-pending)]/60"
            : kind === "low"
              ? "border-[var(--color-pending)]/40"
              : "border-[var(--color-border)]",
          disabled && "opacity-60",
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
        <input
          ref={inputRef}
          type="text"
          value={open ? query : value ? `${value.lastName} ${value.firstName}` : ""}
          placeholder="Fahrer suchen…"
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onBlur={() => setOpen(false)}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => {
            if (!open) return;
            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              setActive((a) => Math.min(a + 1, results.length));
            } else if (ev.key === "ArrowUp") {
              ev.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (ev.key === "Enter") {
              ev.preventDefault();
              if (active < results.length) pick(results[active].entryId);
              else pick(null);
            } else if (ev.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent text-sm outline-none"
        />
        {value !== null && !open && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => pick(null)}
            disabled={disabled}
            className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            title="Zuordnung entfernen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]">
        {badge}
        {value && <span>{value.teamName}</span>}
        {value?.tag && <Tag>{value.tag}</Tag>}
      </div>

      {open && (
        <ul
          onMouseDown={(ev) => ev.preventDefault()}
          className="absolute z-20 mt-1 max-h-64 w-full min-w-[18rem] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg"
        >
          {results.map((c, i) => {
            const taken = takenIds.has(c.entryId) && c.entryId !== value?.entryId;
            return (
              <li key={c.entryId}>
                <button
                  type="button"
                  onClick={() => pick(c.entryId)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                    i === active && "bg-[var(--color-surface-2)]",
                    c.entryId === value?.entryId && "font-semibold",
                  )}
                >
                  <span>
                    {c.lastName} {c.firstName}
                    <span className="ml-2 text-xs text-[var(--color-muted)]">{c.teamName}</span>
                    {c.tag && (
                      <span className="ml-2">
                        <Tag>{c.tag}</Tag>
                      </span>
                    )}
                  </span>
                  {taken && (
                    <span className="shrink-0 text-[10px] text-[var(--color-pending)] uppercase">
                      bereits zugeordnet
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="px-3 py-1.5 text-sm text-[var(--color-muted)]">Kein Fahrer gefunden.</li>
          )}
          <li className="border-t border-[var(--color-border)]/60">
            <button
              type="button"
              onClick={() => pick(null)}
              onMouseEnter={() => setActive(results.length)}
              className={cn(
                "w-full px-3 py-1.5 text-left text-sm text-[var(--color-muted)]",
                active === results.length && "bg-[var(--color-surface-2)]",
              )}
            >
              Keine Zuordnung (Zeile überspringen)
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-[var(--color-accent)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-accent)] uppercase">
      {children}
    </span>
  );
}
