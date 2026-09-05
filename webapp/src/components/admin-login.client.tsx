"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shown in place of any admin page while the browser has not yet submitted the
 * correct admin token. On success the server sets a cookie and the page is
 * refreshed, so the actual admin content appears in place.
 */
export function AdminLogin({ title = "Admin" }: { title?: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) {
        setError("Admin-Token ist falsch.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  const isWorking = busy || pending;

  return (
    <div className="mx-auto mt-6 w-full max-w-sm space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-[var(--color-surface-2)] p-2 text-[var(--color-muted)]">
          <Lock className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Bitte Admin-Token eingeben, um Zeiten zu erfassen.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            Admin-Token
          </span>
          <input
            type="password"
            name="admin-token"
            autoComplete="current-password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isWorking}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm"
            placeholder="••••••••"
          />
        </label>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={isWorking || !token.trim()}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-[var(--color-accent-foreground)] hover:opacity-90",
            (isWorking || !token.trim()) && "cursor-not-allowed opacity-60",
          )}
        >
          <LogIn className="h-4 w-4" />
          {isWorking ? "Prüfe…" : "Freischalten"}
        </button>
      </form>
    </div>
  );
}
