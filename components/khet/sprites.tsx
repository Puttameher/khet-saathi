/**
 * Crop sprites, one per crop × growth stage. Each is drawn with its base at (0,0),
 * growing up to y≈-40, and coloured only through CSS variables set by the scene
 * (--k-leaf, --k-leaf2, --k-grain, --k-bulb, --k-soil-dark) so day/night/storm tint
 * them without re-rendering React.
 */
import type { ReactNode } from "react";

export type CropId = "wheat" | "rice" | "onion";
export type StageId = "seed" | "sprout" | "vegetative" | "flowering" | "grain" | "bulb";

const L = "var(--k-leaf)";
const L2 = "var(--k-leaf2)";
const G = "var(--k-grain)";
const B = "var(--k-bulb)";
const S = "var(--k-soil-dark)";

const blade = (dx: number, h: number, bend: number, color: string, w = 2.2) => (
  <path d={`M0 0 Q${dx * 0.4} ${-h * 0.55} ${dx + bend} ${-h}`} stroke={color} strokeWidth={w} strokeLinecap="round" fill="none" />
);

function seed(): ReactNode {
  return (
    <>
      <ellipse cx="0" cy="0" rx="7" ry="2.2" fill={S} opacity="0.55" />
      <ellipse cx="-1.5" cy="-1.2" rx="1.3" ry="0.9" fill={G} opacity="0.9" />
      <ellipse cx="2.2" cy="-0.8" rx="1.1" ry="0.8" fill={G} opacity="0.7" />
    </>
  );
}

function sprout(crop: CropId): ReactNode {
  if (crop === "onion") return (<><ellipse cx="0" cy="0" rx="5" ry="1.6" fill={S} opacity="0.5" />{blade(0.5, 10, 0.6, L2, 1.6)}</>);
  return (
    <>
      <ellipse cx="0" cy="0" rx="5" ry="1.6" fill={S} opacity="0.5" />
      <path d="M0 0 V-6" stroke={L} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M0 -6 C-4 -9 -7 -7 -7 -5 C-4 -4.5 -2 -5 0 -6Z" fill={L2} />
      <path d="M0 -6 C4 -10 7 -8 7.5 -6 C4.5 -5 2 -5.4 0 -6Z" fill={L} />
    </>
  );
}

function tuft(h: number, color1: string, color2: string, spread = 1): ReactNode {
  return (
    <>
      {blade(-7 * spread, h * 0.75, -2, color2)}
      {blade(-3.5 * spread, h * 0.95, -1, color1)}
      {blade(0.5, h, 1, color2)}
      {blade(4 * spread, h * 0.9, 2, color1)}
      {blade(7.5 * spread, h * 0.7, 2.5, color2)}
    </>
  );
}

function wheatEar(x: number, y: number, color: string, awns: boolean, tilt = 0): ReactNode {
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <ellipse cx="0" cy="-4" rx="1.9" ry="5" fill={color} />
      {[-6, -3, 0].map((dy) => (
        <g key={dy}>
          <path d={`M0 ${dy - 1} l-2.6 -1.6`} stroke={color} strokeWidth="1.1" strokeLinecap="round" />
          <path d={`M0 ${dy - 1} l2.6 -1.6`} stroke={color} strokeWidth="1.1" strokeLinecap="round" />
        </g>
      ))}
      {awns && <path d="M-1 -9 l-2 -6 M0 -9 l0 -7 M1 -9 l2 -6" stroke={color} strokeWidth="0.6" strokeLinecap="round" opacity="0.9" />}
    </g>
  );
}

function panicle(x: number, y: number, color: string, heavy: boolean): ReactNode {
  const droop = heavy ? 9 : 5;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M0 0 Q4 -3 ${6} ${droop - 6}`} stroke={color} strokeWidth="1.1" fill="none" strokeLinecap="round" />
      {[0.25, 0.45, 0.65, 0.85, 1].map((f, i) => (
        <ellipse key={i} cx={f * 6} cy={-3 + f * (droop - 3) * f} rx={heavy ? 1.3 : 1} ry={heavy ? 0.9 : 0.7} fill={color} />
      ))}
    </g>
  );
}

function wheat(stage: StageId): ReactNode {
  switch (stage) {
    case "seed": return seed();
    case "sprout": return sprout("wheat");
    case "vegetative": return tuft(22, L, L2);
    case "flowering":
      return (<>{tuft(28, L, L2)}{wheatEar(-3, -27, L2, false, -8)}{wheatEar(1.5, -30, L2, false, 3)}{wheatEar(6, -24, L2, false, 12)}
        <circle cx="-4.5" cy="-31" r="0.8" fill="#F4E7A1" /><circle cx="2.8" cy="-34" r="0.8" fill="#F4E7A1" /></>);
    default:
      return (<>{tuft(30, G, "var(--k-grain-deep)")}{wheatEar(-3, -29, G, true, -10)}{wheatEar(1.5, -32, G, true, 4)}{wheatEar(6.5, -26, G, true, 16)}</>);
  }
}

function rice(stage: StageId): ReactNode {
  switch (stage) {
    case "seed": return seed();
    case "sprout": return (<>{tuft(10, L, L2, 0.6)}</>);
    case "vegetative": return tuft(24, L, L2, 1.15);
    case "flowering": return (<>{tuft(28, L, L2, 1.15)}{panicle(0.5, -28, "#E8E6C8", false)}{panicle(-3.5, -25, "#E8E6C8", false)}</>);
    default: return (<>{tuft(27, G, "var(--k-grain-deep)", 1.15)}{panicle(0.5, -27, G, true)}{panicle(-3.5, -24, G, true)}{panicle(4, -22, G, true)}</>);
  }
}

function onion(stage: StageId): ReactNode {
  const leaves = (h: number) => (
    <>
      {blade(-4, h * 0.85, -2.5, L2, 2.4)}
      {blade(-1, h, -0.5, L, 2.4)}
      {blade(2.5, h * 0.95, 1.5, L2, 2.4)}
      {blade(5, h * 0.75, 3, L, 2.4)}
    </>
  );
  switch (stage) {
    case "seed": return seed();
    case "sprout": return sprout("onion");
    case "vegetative": return leaves(24);
    case "flowering": return (<>{leaves(26)}<ellipse cx="0.5" cy="-2" rx="4" ry="3.2" fill={B} opacity="0.85" /></>);
    default:
      return (
        <>
          <path d="M-2 -5 Q-10 -12 -14 -8" stroke={G} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M1 -6 Q4 -18 12 -15" stroke={L2} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M0 -6 Q-1 -16 -6 -20" stroke={L} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M-5.5 -1 C-6 -6 -2 -8 0 -9 C2 -8 6 -6 5.5 -1 C4 1 -4 1 -5.5 -1Z" fill={B} />
          <path d="M-2 -4 C-1 -6 1 -6 2 -4" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" fill="none" />
        </>
      );
  }
}

export function PlantSprite({ crop, stage }: { crop: CropId; stage: StageId }) {
  return <>{crop === "rice" ? rice(stage) : crop === "onion" ? onion(stage) : wheat(stage)}</>;
}

/** Stage-specific plant spacing multiplier (seeds/sprouts sit closer, tall crops need room). */
export const stageSpacing: Record<StageId, number> = { seed: 0.75, sprout: 0.8, vegetative: 1, flowering: 1.05, grain: 1.05, bulb: 1 };
