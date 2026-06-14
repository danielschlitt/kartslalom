import { ImportClient } from "./import.client";

const TEMPLATE = [
  "race_event",
  "event_date",
  "age_class",
  "driver_name",
  "team",
  "test_time",
  "test_penalty",
  "run1_time",
  "run1_penalty",
  "run2_time",
  "run2_penalty",
].join(",");

const EXAMPLE =
  "1,26.04.2026,Altersklasse I,Glatter Jonas,OAMC Reinheim,42.51,0,41.83,0,40.97,5";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">CSV-Import</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Zeiten vergangener Rennen nachpflegen. Es werden bestehende Fahrer
          und Rennen abgeglichen — neue Datensätze werden nicht erzeugt.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold uppercase text-[var(--color-muted)]">
          Vorlage
        </h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Erste Zeile = Spaltenüberschriften. <code>race_event</code> kann die
          Rennnummer (<code>1</code>) oder der Name (<code>#1 MSC Horlofftal</code>)
          sein. Zeiten in Sekunden, Komma oder Punkt erlaubt.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--color-background)] p-3 text-xs">
{TEMPLATE}
{"\n"}{EXAMPLE}
        </pre>
      </section>

      <ImportClient />
    </div>
  );
}
