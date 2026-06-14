"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportResult {
  ok: boolean;
  rowsParsed: number;
  entriesUpserted: number;
  runsWritten: number;
  errors: { row: number; reason: string }[];
}

export function ImportClient() {
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: csvText,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "import failed");
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setCsvText(await file.text());
  };

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-2">
        <span className="text-sm text-[var(--color-muted)]">
          CSV einfügen oder Datei wählen
        </span>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={10}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 font-mono text-xs"
          placeholder="race_event,event_date,age_class,..."
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          className="text-sm text-[var(--color-muted)]"
        />
        <button
          onClick={submit}
          disabled={busy || !csvText.trim()}
          className={cn(
            "inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-foreground)]",
            (busy || !csvText.trim()) && "opacity-50",
          )}
        >
          <Upload className="h-4 w-4" />
          Importieren
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-live)]/40 bg-[var(--color-live)]/10 p-3 text-sm text-[var(--color-live)]">
          Fehler: {error}
        </div>
      )}

      {result && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
          <div>
            <strong>{result.rowsParsed}</strong> Zeilen gelesen,{" "}
            <strong>{result.entriesUpserted}</strong> Einträge,{" "}
            <strong>{result.runsWritten}</strong> Läufe geschrieben.
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[var(--color-pending)]">
                {result.errors.length} Warnungen
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-[var(--color-muted)]">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Zeile {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
