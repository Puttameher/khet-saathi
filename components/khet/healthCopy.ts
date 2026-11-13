/** Plain-language lines for each Crop Care Score factor (lib/health.ts). Numbers come from the factor detail. */
import type { Factor, FactorId } from "@/lib/health";
import type { Lang } from "@/lib/config";

type D = Factor["detail"];
const n = (v: D[string] | undefined) => (v == null ? "?" : String(v));

const HI: Record<FactorId, (d: D) => string> = {
  onTime: (d) => `${n(d.count)} काम समय पर पूरे किए`,
  overdue: (d) => `${n(d.count)} काम की तारीख निकल गई`,
  sprayRecent: (d) => (d.daysAgo === 0 ? "आज स्प्रे हुआ" : `${n(d.daysAgo)} दिन पहले स्प्रे हुआ`),
  irrigation: (d) => (d.daysAgo === 0 ? "आज सिंचाई दर्ज" : `${n(d.daysAgo)} दिन पहले सिंचाई दर्ज`),
  dryStress: (d) => `सूखा: 7 दिन में ${n(d.rain7dMm)} mm बारिश, सिंचाई ${d.daysSinceIrrigation === "never" ? "दर्ज नहीं" : `${n(d.daysSinceIrrigation)} दिन पहले`}`,
  heatStress: (d) => `तेज़ गर्मी: ${n(d.maxTempC)}°C`,
  waterlog: (d) => `ज़्यादा पानी: 48 घंटे में ${n(d.rain48hMm)} mm बारिश`,
  checkIn: (d) => (d.daysAgo === "never" ? "अभी तक हाल-चाल नहीं लिया" : Number(d.daysAgo) <= 1 ? "हाल-चाल ताज़ा है" : `${n(d.daysAgo)} दिन से हाल-चाल नहीं`),
};
const TE: Record<FactorId, (d: D) => string> = {
  onTime: (d) => `${n(d.count)} పనులు సమయానికి పూర్తి`,
  overdue: (d) => `${n(d.count)} పనుల తేదీ దాటింది`,
  sprayRecent: (d) => (d.daysAgo === 0 ? "ఈరోజు పిచికారీ అయింది" : `${n(d.daysAgo)} రోజుల క్రితం పిచికారీ`),
  irrigation: (d) => (d.daysAgo === 0 ? "ఈరోజు నీరు పెట్టారు" : `${n(d.daysAgo)} రోజుల క్రితం నీరు`),
  dryStress: (d) => `ఎండ: 7 రోజుల్లో ${n(d.rain7dMm)} mm వర్షం, నీరు ${d.daysSinceIrrigation === "never" ? "నమోదు లేదు" : `${n(d.daysSinceIrrigation)} రోజుల క్రితం`}`,
  heatStress: (d) => `ఎక్కువ వేడి: ${n(d.maxTempC)}°C`,
  waterlog: (d) => `ఎక్కువ నీరు: 48 గం.లో ${n(d.rain48hMm)} mm వర్షం`,
  checkIn: (d) => (d.daysAgo === "never" ? "ఇంకా పలకరించలేదు" : Number(d.daysAgo) <= 1 ? "పలకరింపు తాజాగా ఉంది" : `${n(d.daysAgo)} రోజులుగా పలకరింపు లేదు`),
};

export function factorText(f: Factor, lang: Lang): string {
  return (lang === "te" ? TE : HI)[f.id](f.detail);
}
/** Factors whose value comes from the weather forecast (show the weather source next to them). */
export const WEATHER_FACTORS: FactorId[] = ["dryStress", "heatStress", "waterlog"];
