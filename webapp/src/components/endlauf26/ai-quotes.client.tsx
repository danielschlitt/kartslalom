"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import type { QuotesResponse } from "@/app/api/endlauf26/quotes/[champ]/route";
import { cn } from "@/lib/utils";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: QuotesResponse };

/**
 * "Zitate für Social Media" card on the teams page. Loads lazily; the first
 * view per facts state takes a few seconds (OpenAI), afterwards it comes from
 * the cache. Admins can regenerate for a fresh set of phrasings.
 */
export function AiQuotes({
  champSlug,
  subject,
  title,
  isAdmin,
}: {
  champSlug: string;
  subject: "team" | "region";
  title: string;
  isAdmin: boolean;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      else setState({ status: "loading" });
      try {
        const qs = new URLSearchParams({ subject, ...(refresh ? { refresh: "1" } : {}) });
        const res = await fetch(`/api/endlauf26/quotes/${champSlug}?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as QuotesResponse;
        setState({ status: "ok", data });
      } catch (err) {
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        setRefreshing(false);
      }
    },
    [champSlug, subject],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <span className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          {title}
        </span>
        <span className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
          {state.status === "ok" && (
            <span>
              {state.data.source === "rules"
                ? "regelbasiert"
                : `${state.data.model ?? "KI"}${state.data.createdAt ? ` · ${formatDate(state.data.createdAt)}` : ""}`}
            </span>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing || state.status === "loading"}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-foreground)] disabled:opacity-50"
              title="Zitate neu formulieren lassen (Fakten bleiben gleich)"
            >
              <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Neu
            </button>
          )}
        </span>
      </div>
      <div className="px-4 py-3 text-sm">
        {state.status === "loading" && (
          <p className="animate-pulse text-[var(--color-muted)]">Zitate werden formuliert …</p>
        )}
        {state.status === "error" && (
          <p className="text-[var(--color-muted)]">Zitate derzeit nicht verfügbar ({state.message}).</p>
        )}
        {state.status === "ok" && (
          <>
            <ul className="space-y-2">
              {state.data.quotes.map((q, i) => (
                <Quote key={`${i}-${q.slice(0, 20)}`} text={q} />
              ))}
            </ul>
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              Alle Zahlen stammen aus den Tabellen dieser Seite (Stand:{" "}
              {state.data.facts.scoredEvents.length
                ? `nach ${state.data.facts.scoredEvents.join(" & ")}`
                : "vor dem ersten Endlauf"}
              ). Klick auf ein Zitat kopiert es.
              {state.data.error && ` KI-Text nicht verfügbar (${state.data.error}) – regelbasierte Zitate.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Quote({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available — nothing to do */
    }
  };
  return (
    <li>
      <button
        type="button"
        onClick={() => void copy()}
        className="group flex w-full items-start gap-2 rounded-md border border-[var(--color-border)]/60 px-3 py-2 text-left leading-relaxed hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-accent)]/5"
        title="In die Zwischenablage kopieren"
      >
        <span className="flex-1">„{text}“</span>
        {copied ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-rank-green)]" />
        ) : (
          <Copy className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted)] opacity-0 group-hover:opacity-100" />
        )}
      </button>
    </li>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
