/**
 * Khet Saathi design tokens — the single source of truth.
 * Rendered into CSS custom properties by app/layout.tsx (see tokensToCss) and
 * read directly by the canvas/SVG scene. Tailwind maps onto these variables in globals.css.
 *
 * Palette idea: soil, turmeric, young leaf, monsoon slate. Warm neutrals instead of grey,
 * one bright accent (haldi), verdict colours that read in direct sunlight.
 */
export const palette = {
  // warm neutrals (light → dark)
  parchment50: "#FBF8F1",
  parchment100: "#F5EFE3",
  parchment200: "#EADFC9",
  parchment300: "#D8C8A8",
  stone500: "#8A8170",
  loam700: "#3A3127",
  loam800: "#262019",
  loam900: "#1A1612",
  loam950: "#110E0B",
  ink: "#1E1913",
  // accents
  haldi: "#E3A93B", // turmeric gold — primary accent
  haldiDeep: "#B97F17",
  leaf: "#4F8A4A",
  leafBright: "#7DB36A",
  sage: "#A9BF94",
  clay: "#B9552F",
  amber: "#D08A1F",
  monsoon: "#5F7C8F",
  sky: "#9CC3DE",
} as const;

export const verdict = {
  GO: { fg: palette.leaf, bg: "rgba(79,138,74,0.14)", ring: "rgba(125,179,106,0.45)" },
  WAIT: { fg: palette.amber, bg: "rgba(208,138,31,0.14)", ring: "rgba(227,169,59,0.45)" },
  SKIP_TODAY: { fg: palette.clay, bg: "rgba(185,85,47,0.14)", ring: "rgba(185,85,47,0.45)" },
  UNKNOWN: { fg: palette.stone500, bg: "rgba(138,129,112,0.14)", ring: "rgba(138,129,112,0.35)" },
} as const;

export const health = {
  healthy: { core: "#8FD07A", mid: "#4F8A4A", glow: "rgba(125,200,106,0.55)" },
  attention: { core: "#F5C766", mid: "#D08A1F", glow: "rgba(240,180,70,0.55)" },
  risk: { core: "#F08A63", mid: "#B9552F", glow: "rgba(230,110,70,0.55)" },
} as const;

/** Sky keyframes by sun elevation (−1 deep night … 1 noon): [top, horizon] */
export const sky = {
  night: ["#0B1020", "#1E2740"],
  astro: ["#141A33", "#3B3557"],
  dawn: ["#3E4E7A", "#F0A877"],
  golden: ["#7FA6CC", "#F4C98F"],
  day: ["#6FA5D6", "#D9EAF2"],
  overcastDay: ["#8E99A3", "#C9CDCF"],
  overcastNight: ["#151922", "#2A2F38"],
  storm: ["#3C434D", "#6A6F74"],
} as const;

export const scene = {
  hillFar: ["#7E9A73", "#3B4A3A"], // [day, night]
  hillNear: ["#5F7F52", "#2C3A2C"],
  soilDry: ["#A87B4F", "#4A3626"],
  soilWet: ["#6B4A2F", "#2E2219"],
  leafYoung: "#7DB36A",
  leafMature: "#4F8A4A",
  grainGold: "#E3B556",
  onionBulb: "#C98C9A",
  mist: "rgba(220,240,230,0.75)",
  rain: "rgba(200,220,240,0.55)",
} as const;

export const radius = { sm: "10px", md: "16px", lg: "22px", xl: "28px", pill: "999px" } as const;
export const motion = {
  spring: { type: "spring", stiffness: 380, damping: 30, mass: 0.9 },
  springSoft: { type: "spring", stiffness: 160, damping: 22 },
  springBouncy: { type: "spring", stiffness: 420, damping: 14 },
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  durFast: "160ms",
  durBase: "280ms",
  durSlow: "700ms",
} as const;
export const tap = { min: "56px", primary: "72px", mic: "96px" } as const;

export function tokensToCss(): string {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) vars[`--ks-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(radius)) vars[`--ks-r-${k}`] = v;
  for (const [k, v] of Object.entries(tap)) vars[`--ks-tap-${k}`] = v;
  vars["--ks-ease-out"] = motion.easeOut;
  vars["--ks-dur-fast"] = motion.durFast;
  vars["--ks-dur-base"] = motion.durBase;
  vars["--ks-dur-slow"] = motion.durSlow;
  for (const [k, v] of Object.entries(verdict)) {
    vars[`--ks-v-${k.toLowerCase()}`] = v.fg;
    vars[`--ks-v-${k.toLowerCase()}-bg`] = v.bg;
  }
  return `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}
function kebab(s: string) {
  return s.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
}
