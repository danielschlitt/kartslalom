import type { SeriesParam } from "@/components/series-tabs";

/** German subtitle showing series + drop-rule state. */
export function seriesSubtitle(series: SeriesParam, applyDrops: boolean) {
  if (series === "hts") {
    return applyDrops
      ? "Hessen-Thüringen Süd · 8 Rennen · 2 Streichresultate"
      : "Hessen-Thüringen Süd · 8 Rennen · ohne Streichresultate";
  }
  return applyDrops
    ? "HMJ · 5 Rennen · 1 Streichresultat"
    : "HMJ · 5 Rennen · ohne Streichresultate";
}
