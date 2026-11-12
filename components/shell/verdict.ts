import { verdict as V } from "@/design/tokens";
import type { Verdict } from "@/lib/rules";
export function verdictColor(v: Verdict | null | undefined) {
  return V[v ?? "UNKNOWN"] ?? V.UNKNOWN;
}
