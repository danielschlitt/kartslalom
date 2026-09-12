import Link from "next/link";
import { notFound } from "next/navigation";
import { ChampHeader } from "@/components/endlauf26/champ-header";
import { EndlaufChampionshipTable } from "@/components/endlauf26/championship-table";
import { GermanFlag } from "@/components/endlauf26/german-flag";
import { FileText } from "lucide-react";
import {
  getDocuments,
  getEndlaufChampionship,
  getLiveEndlaufEvent,
  toEventInfo,
} from "@/lib/dal/endlauf26";
import { ENDLAUF26_DOCUMENT_SLOTS } from "@/lib/endlauf26/documents";
import {
  ageClassName,
  championshipFromSlug,
  DKM_NAME,
  ENDLAUF26_SLUGS,
} from "@/lib/endlauf26/ranking";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function EndlaufChampionshipPage({
  params,
  searchParams,
}: {
  params: Promise<{ champ: string }>;
  searchParams: Promise<{ drops?: string; klasse?: string }>;
}) {
  const { champ } = await params;
  const sp = await searchParams;
  const championship = championshipFromSlug(champ);
  if (!championship) notFound();

  const applyDrops = sp.drops !== "off";
  const [data, liveEvent, documents] = await Promise.all([
    getEndlaufChampionship(championship, { applyDrops }),
    getLiveEndlaufEvent(championship),
    getDocuments(championship),
  ]);
  const slots = ENDLAUF26_DOCUMENT_SLOTS[championship];
  const slotLabel = new Map(slots.map((s) => [s.key, s.label]));
  // Slot order (start list first), unknown keys last.
  const slotIndex = (key: string) => {
    const i = slots.findIndex((s) => s.key === key);
    return i < 0 ? slots.length : i;
  };
  documents.sort((a, b) => slotIndex(a.key) - slotIndex(b.key));

  const classes = [...new Set(data.rows.map((r) => r.ageClass))].sort((a, b) => a - b);
  const selected = sp.klasse ? Number(sp.klasse) : null;
  const visibleClasses = selected && classes.includes(selected) ? [selected] : classes;
  const base = `/endlauf26/${ENDLAUF26_SLUGS[championship]}`;

  const scoredCount = data.events.map((e) => ({
    event: e,
    classes: data.scored.get(e.id)?.size ?? 0,
  }));

  return (
    <div className="space-y-6">
      <ChampHeader championship={championship} active="standings" isLive={!!liveEvent} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 text-xs">
          <ClassChip href={base} active={selected === null} label="Alle Klassen" />
          {classes.map((c) => (
            <ClassChip
              key={c}
              href={`${base}?klasse=${c}${applyDrops ? "" : "&drops=off"}`}
              active={selected === c}
              label={ageClassName(c)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
          {championship === "hmj" && (
            <Link
              href={`${base}?${new URLSearchParams({
                ...(selected ? { klasse: String(selected) } : {}),
                ...(applyDrops ? { drops: "off" } : {}),
              }).toString()}`}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 hover:text-[var(--color-foreground)]"
            >
              Streichresultat: {applyDrops ? "an" : "aus"}
            </Link>
          )}
          <span>
            Endläufe gewertet:{" "}
            {scoredCount.map((f, i) => (
              <span key={f.event.id}>
                {i > 0 && " · "}
                {f.event.name} {f.classes}/{classes.length}
              </span>
            ))}
          </span>
        </div>
      </div>

      <Legend championship={championship} />

      {documents.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
          <span>
            {championship === "hmj"
              ? "Grundlage (offizielle Liste, grün = qualifiziert):"
              : "Grundlage (finale Startliste; Zwischenstände der Regionen zur Information):"}
          </span>
          {documents.map((d) => (
            <a
              key={d.id}
              href={`/api/endlauf26/documents/${d.id}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
              title={d.filename}
            >
              <FileText className="h-3.5 w-3.5" />
              {slotLabel.get(d.key) ?? d.filename} ({d.mime === "text/csv" ? "CSV" : "PDF"})
            </a>
          ))}
        </p>
      )}

      {visibleClasses.map((c) => (
        <EndlaufChampionshipTable
          key={c}
          championship={championship}
          ageClassName={ageClassName(c)}
          rows={data.rows.filter((r) => r.ageClass === c)}
          events={data.events.map(toEventInfo)}
          driverHref={(id) => `${base}/driver/${id}`}
        />
      ))}

      {data.rows.length === 0 && (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-muted)]">
          Noch keine Daten importiert. <code>make seed-endlauf26</code> ausführen.
        </p>
      )}
    </div>
  );
}

function ClassChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md border px-2 py-1",
        active
          ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 text-[var(--color-foreground)]"
          : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
      )}
    >
      {label}
    </Link>
  );
}

function Legend({ championship }: { championship: "hmj" | "adac_hth" }) {
  return (
    <p className="text-xs text-[var(--color-muted)]">
      {championship === "hmj" ? (
        <>
          Zelle = Platz · Punkte. Endläufe zählen ×1,25. Das schlechteste von 7 Ergebnissen ist{" "}
          <span className="line-through">durchgestrichen</span> (bei Gleichstand das spätere).
          Punktgleich → mehr bessere Platzierungen → jüngerer Fahrer → sonst{" "}
          <span className="rounded-sm px-1" style={{ backgroundColor: "rgba(250,204,21,0.18)", color: "#fde047" }}>
            gleicher Platz
          </span>
          . Pfeile: Veränderung der Meisterschaftsposition durch den jeweiligen Endlauf.{" "}
          <span className="font-semibold text-[var(--color-live)]">abgemeldet</span> = tritt bei
          den Endläufen nicht an (nicht gewertet),{" "}
          <span className="font-semibold text-[var(--color-accent)]">Nachrücker</span> = war in
          der Liste nicht grün markiert, startet aber bei den Endläufen.{" "}
          <GermanFlag className="mx-0.5" /> = Platz qualifiziert für die {DKM_NAME} (K1: 1–2, K2–K4: 1–3,
          K5: 1–2).
        </>
      ) : (
        <>
          Fahrerfeld = finale Startliste. Der Platz in der Regionalmeisterschaft zählt wie ein Rennen
          (Platz → Punkte; mehrere Fahrer können mit denselben Punkten starten). Malsfeld zählt ×1,1.
          Alle drei Endläufe sind Pflicht — wer einen (abgeschlossenen) Endlauf auslässt, wird als{" "}
          <span className="font-semibold text-[var(--color-live)]">n. g.</span> geführt. Punktgleich →
          mehr bessere Platzierungen → jüngerer Fahrer → sonst{" "}
          <span className="rounded-sm px-1" style={{ backgroundColor: "rgba(250,204,21,0.18)", color: "#fde047" }}>
            gleicher Platz
          </span>
          . Pfeile: Veränderung der Meisterschaftsposition durch den jeweiligen Endlauf.{" "}
          <span className="font-semibold text-[var(--color-live)]">abgemeldet</span> = tritt bei
          den Endläufen nicht an (nicht gewertet),{" "}
          <span className="font-semibold text-[var(--color-accent)]">Nachrücker</span> = laut
          Startliste für einen frei gewordenen Platz nachgerückt.{" "}
          <GermanFlag className="mx-0.5" /> am Platz = der letzte Startplatz je Klasse (K1–K5) für die{" "}
          {DKM_NAME}: Er geht an den Sieger — ist der schon über die hmj qualifiziert, an den
          Zweiten, dann an den Dritten usw.{" "}
          <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-surface-2)] px-1 text-[10px] font-semibold uppercase">
            <GermanFlag className="h-2 w-3" title="" /> hmj
          </span>{" "}
          = bereits über die hmj-Wertung (Stand nach beiden Langgöns-Endläufen) qualifiziert.
        </>
      )}
    </p>
  );
}
