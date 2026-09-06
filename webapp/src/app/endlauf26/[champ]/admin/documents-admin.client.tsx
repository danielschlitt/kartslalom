"use client";

/**
 * Admin: the source PDFs (official standings lists) behind a championship's
 * driver data. One slot per list; upload replaces the stored file.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, RefreshCw, Trash2, Upload } from "lucide-react";

import type { EndlaufDocumentMeta } from "@/lib/dal/endlauf26";
import type { DocumentSlot } from "@/lib/endlauf26/documents";
import { cn, formatDateDe } from "@/lib/utils";

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Nicht als Admin freigeschaltet — Seite neu laden und Admin-Token eingeben.",
  file_too_large: "Datei ist zu groß (max. 25 MB).",
  not_a_pdf: "Nur PDF-Dateien.",
  missing_file: "Keine Datei ausgewählt.",
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsAdmin({
  championshipSlug,
  slots,
  documents,
}: {
  championshipSlug: string;
  slots: DocumentSlot[];
  documents: EndlaufDocumentMeta[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const byKey = new Map(documents.map((d) => [d.key, d]));

  return (
    <section id="dokumente" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold tracking-wider text-[var(--color-muted)] uppercase">
          Quell-PDFs
        </h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Die offiziellen Zwischenstands-Listen, aus denen das Fahrerfeld stammt (grün markiert =
          qualifiziert). Werden hier gespeichert und sind für alle auf der Wertungsseite anklickbar.
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((slot) => (
          <DocumentSlotCard
            key={slot.key}
            championshipSlug={championshipSlug}
            slot={slot}
            doc={byKey.get(slot.key) ?? null}
            onChange={() => startTransition(() => router.refresh())}
            onError={setError}
          />
        ))}
      </div>
    </section>
  );
}

function DocumentSlotCard({
  championshipSlug,
  slot,
  doc,
  onChange,
  onError,
}: {
  championshipSlug: string;
  slot: DocumentSlot;
  doc: EndlaufDocumentMeta | null;
  onChange: () => void;
  onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    onError(null);
    try {
      const form = new FormData();
      form.append("championship", championshipSlug);
      form.append("key", slot.key);
      form.append("file", file);
      const res = await fetch("/api/endlauf26/documents", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) onError(ERROR_TEXT[data.error ?? ""] ?? `Fehler (${data.error ?? "unknown"}).`);
      onChange();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    if (!doc || !confirm(`„${doc.filename}“ löschen?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/endlauf26/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) onError("Löschen fehlgeschlagen.");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{slot.label}</div>
          {doc ? (
            <a
              href={`/api/endlauf26/documents/${doc.id}`}
              target="_blank"
              rel="noopener"
              className="block truncate text-xs text-[var(--color-accent)] hover:underline"
              title={doc.filename}
            >
              {doc.filename}
            </a>
          ) : (
            <div className="text-xs text-[var(--color-muted)]">noch nicht hochgeladen</div>
          )}
          {doc && (
            <div className="text-[11px] text-[var(--color-muted)]">
              {fmtSize(doc.size)} · {formatDateDe(doc.uploadedAt)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          disabled={busy}
          onChange={(ev) => void upload(ev.target.files?.[0])}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-2)]",
            busy && "opacity-50",
          )}
        >
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {doc ? "Ersetzen" : "PDF hochladen"}
        </button>
        {doc && (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Löschen
          </button>
        )}
      </div>
    </div>
  );
}
