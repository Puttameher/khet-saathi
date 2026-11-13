/**
 * Canvas particle system for rain / drizzle / storm, driven by the scene's single rAF loop.
 * Drop count, length and speed scale with precipitation intensity; slant with wind.
 * Drops that reach their ground line spawn small splashes. Also draws lightning bolts.
 * Pooled arrays, no allocation per frame.
 */
export interface RainParams {
  intensity: number; // 0..1
  windKmh: number;
  drizzle: boolean;
  night: number; // 0 day … 1 night (drops read lighter at night)
}

interface Drop { x: number; y: number; vy: number; len: number; groundY: number; a: number; alive: boolean }
interface Splash { x: number; y: number; age: number; life: number; r: number; alive: boolean }
interface Bolt { pts: number[]; age: number; life: number }

const MAX_DROPS = 420;
const MAX_SPLASH = 160;

export class RainSystem {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private drops: Drop[] = [];
  private splashes: Splash[] = [];
  private bolt: Bolt | null = null;
  private spawnAcc = 0;
  private seed = 1;
  /** fraction of height where the field starts (splashes land below it) */
  groundTop = 0.66;

  constructor(private canvas: HTMLCanvasElement) {
    const c = canvas.getContext("2d");
    if (!c) throw new Error("no 2d context");
    this.ctx = c;
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ x: 0, y: 0, vy: 0, len: 0, groundY: 0, a: 0, alive: false });
    for (let i = 0; i < MAX_SPLASH; i++) this.splashes.push({ x: 0, y: 0, age: 0, life: 0, r: 0, alive: false });
  }

  private rand() {
    // xorshift: deterministic, cheap
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0 || 1;
    return (this.seed % 100000) / 100000;
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = Math.min(2, dpr);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  get active() {
    return this.drops.some((d) => d.alive) || this.splashes.some((s) => s.alive) || !!this.bolt;
  }

  private spawn(p: RainParams) {
    const d = this.drops.find((x) => !x.alive);
    if (!d) return;
    const speed = p.drizzle ? 260 + this.rand() * 80 : 620 + p.intensity * 520 + this.rand() * 160;
    d.alive = true;
    d.vy = speed;
    d.len = p.drizzle ? 5 + this.rand() * 4 : 10 + p.intensity * 16 + this.rand() * 6;
    const slant = this.slant(p);
    d.x = -40 + this.rand() * (this.w + 80) - slant * this.h * 0.5;
    d.y = -d.len - this.rand() * 40;
    d.groundY = this.h * (this.groundTop + this.rand() * (1 - this.groundTop) * 0.98);
    d.a = (p.drizzle ? 0.35 : 0.45) + this.rand() * 0.35;
  }

  private slant(p: RainParams) {
    return Math.min(0.55, p.windKmh / 60); // dx per dy
  }

  /** Advance the simulation by dt seconds. */
  step(dt: number, p: RainParams) {
    const area = (this.w * this.h) / (390 * 300);
    const rate = p.intensity <= 0 ? 0 : (p.drizzle ? 90 : 160 + 700 * p.intensity) * area; // drops / s
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) { this.spawn(p); this.spawnAcc -= 1; }
    const slant = this.slant(p);
    for (const d of this.drops) {
      if (!d.alive) continue;
      const dy = d.vy * dt;
      d.y += dy;
      d.x += dy * slant;
      if (d.y >= d.groundY) {
        d.alive = false;
        if (!p.drizzle || this.rand() < 0.25) {
          const s = this.splashes.find((x) => !x.alive);
          if (s) { s.alive = true; s.x = d.x; s.y = d.groundY; s.age = 0; s.life = 0.28 + this.rand() * 0.18; s.r = (2 + p.intensity * 4) * (0.6 + (d.groundY / this.h - this.groundTop) * 1.4); }
        }
      }
    }
    for (const s of this.splashes) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= s.life) s.alive = false;
    }
    if (this.bolt) {
      this.bolt.age += dt;
      if (this.bolt.age > this.bolt.life) this.bolt = null;
    }
  }

  /** Draw a static field of drops (prefers-reduced-motion): no movement, no flashes. */
  stillFrame(p: RainParams) {
    for (const d of this.drops) d.alive = false;
    const n = Math.round((p.drizzle ? 60 : 80 + 220 * p.intensity) * ((this.w * this.h) / (390 * 300)));
    for (let i = 0; i < n; i++) {
      this.spawn(p);
    }
    for (const d of this.drops) if (d.alive) d.y = this.rand() * d.groundY;
    this.draw(p);
  }

  strike() {
    const pts: number[] = [];
    let x = this.w * (0.2 + this.rand() * 0.6);
    let y = 0;
    const end = this.h * (0.45 + this.rand() * 0.15);
    pts.push(x, y);
    while (y < end) {
      y += 10 + this.rand() * 18;
      x += (this.rand() - 0.5) * 26;
      pts.push(x, y);
    }
    this.bolt = { pts, age: 0, life: 0.22 };
  }

  draw(p: RainParams) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const slant = this.slant(p);
    const tone = p.night > 0.5 ? "190,205,230" : "225,236,246";
    ctx.lineCap = "round";
    ctx.lineWidth = p.drizzle ? 0.9 : 1.1 + p.intensity * 0.5;
    // batch into three alpha buckets: one path + one stroke each (no per-drop gradients)
    for (let bucket = 0; bucket < 3; bucket++) {
      const lo = 0.35 + bucket * 0.12, hi = lo + 0.12;
      ctx.strokeStyle = `rgba(${tone},${(lo + hi) / 2 + (bucket === 2 ? 0.1 : 0)})`;
      ctx.beginPath();
      for (const d of this.drops) {
        if (!d.alive || d.a < lo || (bucket < 2 && d.a >= hi)) continue;
        ctx.moveTo(d.x - d.len * slant, d.y - d.len);
        ctx.lineTo(d.x, d.y);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    for (const s of this.splashes) {
      if (!s.alive) continue;
      const k = s.age / s.life;
      ctx.strokeStyle = `rgba(${tone},${0.55 * (1 - k)})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.r * (0.4 + k), s.r * 0.32 * (0.4 + k), 0, Math.PI, 2 * Math.PI);
      ctx.stroke();
      // two tiny droplets thrown up
      const up = Math.sin(k * Math.PI) * s.r * 1.1;
      ctx.fillStyle = `rgba(${tone},${0.6 * (1 - k)})`;
      ctx.fillRect(s.x - s.r * (0.3 + k * 0.8), s.y - up, 1.2, 1.2);
      ctx.fillRect(s.x + s.r * (0.3 + k * 0.8), s.y - up * 0.8, 1.2, 1.2);
    }
    if (this.bolt) {
      const k = 1 - this.bolt.age / this.bolt.life;
      ctx.save();
      ctx.shadowColor = "rgba(200,215,255,0.9)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = `rgba(245,248,255,${k})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const pt = this.bolt.pts;
      ctx.moveTo(pt[0]!, pt[1]!);
      for (let i = 2; i < pt.length; i += 2) ctx.lineTo(pt[i]!, pt[i + 1]!);
      ctx.stroke();
      ctx.restore();
    }
  }

  clear() {
    for (const d of this.drops) d.alive = false;
    for (const s of this.splashes) s.alive = false;
    this.bolt = null;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }
}
