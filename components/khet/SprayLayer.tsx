"use client";
/**
 * Spray animation (P1 #7). Overlays the Khet scene with the same viewBox + aspect mapping so
 * the sprayer walks along a real crop row. CSS keyframes only (transform/opacity), so it
 * costs nothing on the scene's rAF loop. Reduced motion → nothing here; KhetTab shows a
 * static "spraying now" badge instead.
 */
import { memo } from "react";

const VB_W = 400, VB_H = 320, FIELD_Y = 192, ROWS = 7;
const rowY = (i: number) => FIELD_Y + 7 + Math.pow(i / (ROWS - 1), 1.3) * 118;
/** sprayer walks between rows 1 and 2: the strip of field that stays above the crop card */
const WALK_Y = (rowY(1) + rowY(2)) / 2 + 2;
const SVG_PROPS = { viewBox: `0 0 ${VB_W} ${VB_H}`, preserveAspectRatio: "xMidYMax slice", className: "pointer-events-none absolute inset-0 h-full w-full" } as const;

const MIST = Array.from({ length: 16 }, (_, i) => {
  const r = Math.sin(i * 91.7 + 13.1) * 43758.5453;
  const f = r - Math.floor(r);
  return { dx: (f - 0.35) * 14, dy: 9 + f * 9, r: 1.6 + ((i * 7) % 5) * 0.4, delay: -(i * 0.13).toFixed(2), dur: 1.25 + f * 0.6 };
});

function Sprayer() {
  // local units: feet at (0,0), facing right, ~34 tall
  return (
    <g>
      <ellipse cx="0" cy="0.6" rx="9" ry="1.8" fill="#000" opacity="0.22" />
      <g className="ks-spray-legs">
        <path d="M-1.5 -14 L-4 0" stroke="#5B4636" strokeWidth="2.6" strokeLinecap="round" className="ks-leg-a" />
        <path d="M1.5 -14 L4 0" stroke="#6B5442" strokeWidth="2.6" strokeLinecap="round" className="ks-leg-b" />
      </g>
      <g className="ks-spray-bob">
        {/* tank on the back */}
        <rect x="-11" y="-29" width="7.5" height="14" rx="2.6" fill="#2F7DB8" />
        <rect x="-10.2" y="-28" width="2" height="11" rx="1" fill="#fff" opacity="0.35" />
        {/* kurta */}
        <path d="M-4.5 -28 Q0 -30 4.5 -28 L5.5 -13 Q0 -11.5 -5.5 -13 Z" fill="#F1E8D4" />
        {/* arm + wand + nozzle */}
        <path d="M2.5 -25 L7 -18.5 L10 -17" stroke="#8A5A3C" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M9 -17.5 L19 -10" stroke="#3B3F44" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M-6 -20 Q-1 -12 9.5 -17" stroke="#3B3F44" strokeWidth="0.9" fill="none" opacity="0.8" />
        <circle cx="19.4" cy="-9.7" r="1.2" fill="#3B3F44" />
        {/* head + safa */}
        <circle cx="0.6" cy="-32.5" r="3.6" fill="#8A5A3C" />
        <path d="M-3.4 -34 Q0.5 -39.5 4.6 -34.2 Q0.5 -35.4 -3.4 -34 Z" fill="#E08A2E" />
        <path d="M-3.6 -34 L-6.5 -31" stroke="#E08A2E" strokeWidth="1.4" strokeLinecap="round" />
        {/* mask over mouth & nose (safety) */}
        <path d="M1.5 -32 h3 v2.4 h-3 z" fill="#E9F1F4" />
      </g>
      {/* mist plume from the nozzle, settling down onto the leaves */}
      <g transform="translate(19.4 -9.7)">
        <ellipse cx="4" cy="8" rx="9" ry="6" fill="#F4FBFF" className="ks-mist-cloud" />
        {MIST.map((m, i) => (
          <circle
            key={i}
            r={m.r.toFixed(2)}
            fill="#F4FBFF"
            className="ks-mist"
            style={{ ["--dx" as string]: `${m.dx.toFixed(1)}px`, ["--dy" as string]: `${m.dy.toFixed(1)}px`, animationDelay: `${m.delay}s`, animationDuration: `${m.dur.toFixed(2)}s` }}
          />
        ))}
      </g>
    </g>
  );
}

export const SprayLayer = memo(function SprayLayer() {
  return (
    <>
      {/* leaves "refresh": a soft wet-green sheen that grows behind the sprayer */}
      <svg {...SVG_PROPS} style={{ mixBlendMode: "soft-light" }} aria-hidden>
        <defs>
          <linearGradient id="ks-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#C9F59A" stopOpacity="0" />
            <stop offset="0.45" stopColor="#B6F07E" stopOpacity="0.95" />
            <stop offset="1" stopColor="#7FD457" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="ks-sheen-edge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.9" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="ks-sheen-mask" maskContentUnits="objectBoundingBox">
            <rect width="1" height="1" fill="url(#ks-sheen-edge)" />
          </mask>
        </defs>
        <rect mask="url(#ks-sheen-mask)" x="-20" y={FIELD_Y + 2} width={VB_W + 40} height={VB_H - FIELD_Y} fill="url(#ks-sheen)" className="ks-spray-sheen" />
      </svg>
      <svg {...SVG_PROPS} aria-hidden data-testid="spray-layer">
        <g transform={`translate(0 ${WALK_Y.toFixed(1)})`}>
          <g className="ks-spray-walk">
            <g transform="scale(0.74)"><Sprayer /></g>
          </g>
        </g>
      </svg>
    </>
  );
});

/** One-shot glow along every row when a spray task completes. */
export const RowGlow = memo(function RowGlow() {
  return (
    <svg {...SVG_PROPS} style={{ mixBlendMode: "screen" }} aria-hidden data-testid="row-glow">
      <defs>
        <radialGradient id="ks-rowglow">
          <stop offset="0" stopColor="#E9FFB8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#9BE07A" stopOpacity="0" />
        </radialGradient>
      </defs>
      {Array.from({ length: ROWS }, (_, i) => {
        const s = 0.36 + 0.84 * Math.pow(i / (ROWS - 1), 1.2);
        return <ellipse key={i} cx="200" cy={(rowY(i) - 6 * s).toFixed(1)} rx="250" ry={(9 * s).toFixed(1)} fill="url(#ks-rowglow)" className="ks-row-glow" style={{ animationDelay: `${i * 70}ms` }} />;
      })}
    </svg>
  );
});
