/** Pure (client-safe) WMO code helpers. */
/** WMO weather code → coarse condition used by scene + speech */
export type Condition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "heavy_rain" | "thunder";
export function conditionOf(code: number, precipMm = 0): Condition {
  if (code >= 95) return "thunder";
  if (code === 65 || code === 82 || precipMm >= 4) return "heavy_rain";
  if ((code >= 61 && code <= 64) || (code >= 80 && code <= 81) || precipMm >= 0.5) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "cloudy";
  if (code === 1 || code === 2) return "partly";
  return "clear";
}
