"use client";
import { motion, useReducedMotion } from "motion/react";

const COLORS = ["#E3A93B", "#7DB36A", "#4F8A4A", "#F5C766", "#A9BF94", "#B9552F"];

/** A small radial burst of leaves/seeds. Mount it with a fresh key to replay. */
export function Celebrate({ count = 14, radius = 70 }: { count?: number; radius?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-0 w-0">
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 2) * 0.2;
        const r = radius * (0.7 + ((i * 37) % 10) / 25);
        const leaf = i % 3 === 0;
        return (
          <motion.span
            key={i}
            className="absolute block"
            style={{
              width: leaf ? 10 : 7, height: leaf ? 6 : 7, left: -4, top: -4,
              borderRadius: leaf ? "60% 0 60% 0" : 999,
              background: COLORS[i % COLORS.length],
            }}
            initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r + 12, scale: [0.4, 1.15, 0.8], opacity: [1, 1, 0], rotate: leaf ? 180 : 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </span>
  );
}
