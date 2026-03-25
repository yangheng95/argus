// ── Tech FX Service ──
// Exact port of the background "tech atlas" canvas animation from app.js.
//
// Exported surface:
//   startTechFx(canvas)   — attach a canvas and start the animation loop
//   stopTechFx()          — cancel the animation frame loop
//   syncTechFx(force?)    — main entry used on resize / visibility change
//                           (permanently disabled in current build per app.js)
//
// Internal helpers (also exported for testing / direct use):
//   createTechPoint(w, h)
//   rebuildTechFxPoints()
//   drawTechFx(ts?, staticMode?)
//   techFxStep(ts)
//   syncTechFxSize(force?)
//   refreshTechFxPalette()
//   clearTechFxCanvas()

// ── Types ──

interface TechPoint {
  alpha: number;
  layer: string;
  links: number;
  link_dist: number;
  orbit: number;
  phase: number;
  pulse: number;
  r: number;
  speed: number;
  warm: boolean;
  x: number;
  y: number;
}

interface TechPointWithCoords extends TechPoint {
  cx: number;
  cy: number;
}

interface TechFxColors {
  glow: string;
  line: string;
  soft: string;
  warm: string;
}

// ── Module state (mirrors app.js techFx object) ──

const techFx = {
  colors: {
    glow: "#8bc1b5",
    line: "#93a39c",
    soft: "#d7ddd7",
    warm: "#cf8b57",
  } as TechFxColors,
  ctx: null as CanvasRenderingContext2D | null,
  dpr: 1,
  frame: 0,
  height: 0,
  last: 0,
  points: [] as TechPoint[],
  running: false,
  width: 0,
};

/** The canvas element managed by this service (set via startTechFx). */
let canvas: HTMLCanvasElement | null = null;

// ── Helpers ──

/** Clamp a number to [min, max]. */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Returns true when the user prefers reduced motion. */
function reduceMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Read a CSS custom-property value from document.body.
 * Falls back to `fallback` when unavailable.
 */
function techColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const node = document.body ?? document.documentElement;
  return getComputedStyle(node).getPropertyValue(name).trim() || fallback;
}

// ── Exported functions ──

/**
 * Refresh the palette from CSS custom properties.
 * Mirrors app.js refreshTechFxPalette().
 */
export function refreshTechFxPalette(): void {
  techFx.colors = {
    glow: techColor("--accent", "#8bc1b5"),
    line: techColor("--text-soft", "#93a39c"),
    soft: techColor("--border-strong", "#d7ddd7"),
    warm: techColor("--accent-start", "#cf8b57"),
  };
}

/**
 * Create a single random tech point for the given canvas dimensions.
 * Exact port of app.js createTechPoint().
 */
export function createTechPoint(width: number, height: number): TechPoint {
  return {
    alpha: 0.018 + Math.random() * 0.028,
    layer: "mid",
    links: 0,
    link_dist: 0,
    orbit: 28 + Math.random() * 48,
    phase: Math.random() * Math.PI * 2,
    pulse: 0.00018 + Math.random() * 0.00032,
    r: 55 + Math.random() * 95,
    speed: 0.0000028 + Math.random() * 0.0000055,
    warm: Math.random() > 0.68,
    x: Math.random() * (width + 220) - 110,
    y: Math.random() * (height + 220) - 110,
  };
}

/**
 * Rebuild the points array based on current canvas dimensions.
 * Respects reduced-motion: uses ~50% of points when enabled.
 * Exact port of app.js rebuildTechFxPoints().
 */
export function rebuildTechFxPoints(): void {
  const total = clampNumber(
    Math.round((techFx.width * techFx.height) / 130000),
    5,
    10,
  );
  const count = reduceMotion() ? Math.max(3, Math.round(total * 0.5)) : total;
  techFx.points = Array.from({ length: count }, () =>
    createTechPoint(techFx.width, techFx.height),
  );
}

/**
 * Wrap a 1-D coordinate inside the canvas (with margin).
 * Exact port of app.js wrapTechCoord().
 */
function wrapTechCoord(value: number, size: number, margin: number): number {
  const span = size + margin * 2;
  const next = (value + margin) % span;
  return (next < 0 ? next + span : next) - margin;
}

/**
 * Synchronise the canvas size with the viewport.
 * Returns true when the canvas was resized (and points were rebuilt).
 * Exact port of app.js syncTechFxSize().
 */
export function syncTechFxSize(force = false): boolean {
  if (!(canvas instanceof HTMLCanvasElement)) return false;
  const width = Math.max(
    1,
    Math.round(
      window.innerWidth ?? window.visualViewport?.width ?? 1,
    ),
  );
  const height = Math.max(
    1,
    Math.round(
      window.innerHeight ?? window.visualViewport?.height ?? 1,
    ),
  );
  const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
  const resized =
    force ||
    !techFx.ctx ||
    techFx.width !== width ||
    techFx.height !== height ||
    techFx.dpr !== dpr;
  if (!resized) return false;

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  techFx.ctx = ctx;
  techFx.dpr = dpr;
  techFx.width = width;
  techFx.height = height;
  rebuildTechFxPoints();
  return true;
}

/**
 * Draw one frame onto the canvas.
 * When staticMode is true the clock is frozen at 0 (no animation drift).
 * Exact port of app.js drawTechFx().
 */
export function drawTechFx(ts = performance.now(), staticMode = false): void {
  if (!techFx.ctx || !techFx.width || !techFx.height) return;
  const ctx = techFx.ctx;
  const { width, height } = techFx;
  const clock = staticMode ? 0 : ts;
  const margin = 220;
  ctx.clearRect(0, 0, width, height);

  const points: TechPointWithCoords[] = techFx.points
    .map((point): TechPointWithCoords => ({
      ...point,
      cx: wrapTechCoord(
        point.x +
          Math.cos(clock * point.speed + point.phase) * point.orbit +
          Math.sin(clock * point.speed * 0.38 + point.phase * 1.4) *
            point.orbit *
            0.52,
        width,
        margin,
      ),
      cy: wrapTechCoord(
        point.y +
          Math.sin(clock * point.speed * 0.88 + point.phase) *
            point.orbit *
            0.88 +
          Math.cos(clock * point.speed * 0.32 + point.phase * 1.1) *
            point.orbit *
            0.42,
        height,
        margin,
      ),
    }))
    .sort((a, b) => b.r - a.r);

  points.forEach((point) => {
    const pulse = 0.9 + Math.sin(clock * point.pulse + point.phase) * 0.12;
    const r = point.r * pulse;
    const color = point.warm ? techFx.colors.warm : techFx.colors.glow;

    // Outer diffuse halo
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.globalAlpha = point.alpha * 0.42;
    ctx.shadowBlur = r * 1.6;
    ctx.shadowColor = color;
    ctx.arc(point.cx, point.cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Soft inner core
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = techFx.colors.soft;
    ctx.globalAlpha = point.alpha * 0.22;
    ctx.shadowBlur = r * 0.5;
    ctx.shadowColor = color;
    ctx.arc(point.cx, point.cy, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/**
 * Single rAF step — calls drawTechFx then schedules the next frame.
 * Exact port of app.js techFxStep().
 */
export function techFxStep(ts: number): void {
  if (!techFx.running) return;
  drawTechFx(ts);
  techFx.frame = requestAnimationFrame(techFxStep);
}

/**
 * Clear the canvas and reset all tech-fx state.
 * Exact port of app.js clearTechFxCanvas().
 */
export function clearTechFxCanvas(): void {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  if (techFx.frame) cancelAnimationFrame(techFx.frame);
  techFx.frame = 0;
  techFx.last = 0;
  techFx.running = false;
  techFx.points = [];
  techFx.width = 0;
  techFx.height = 0;
  techFx.ctx = null;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = "0px";
  canvas.style.height = "0px";
}

/**
 * Stop the animation loop (cancel pending rAF).
 * Does NOT clear the canvas — use clearTechFxCanvas() for that.
 * Exact port of app.js stopTechFx().
 */
export function stopTechFx(): void {
  if (techFx.frame) cancelAnimationFrame(techFx.frame);
  techFx.frame = 0;
  techFx.last = 0;
  techFx.running = false;
}

/**
 * Register the canvas element and start the animation.
 * Call this from an onMount hook passing the <canvas> ref.
 */
export function startTechFx(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl;
  syncTechFx(true);
}

/**
 * Main synchronisation entry-point.
 *
 * NOTE: In the current build the effect is **permanently disabled** (matches
 * app.js `if (true) { clearTechFxCanvas(); return; }` guard).  The full
 * animation path is implemented and can be re-enabled by removing that guard.
 *
 * Exact port of app.js syncTechFx().
 */
export function syncTechFx(force = false): void {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  // Tech FX permanently disabled (matches app.js decision)
  clearTechFxCanvas();
  return;

  // The code below is unreachable for now but is preserved verbatim from
  // app.js so it can be re-enabled by removing the early return above.
  // @ts-ignore — unreachable
  syncTechFxSize(force);
  // @ts-ignore — unreachable
  refreshTechFxPalette();
  if (document.visibilityState === "hidden" || reduceMotion()) {
    stopTechFx();
    drawTechFx(performance.now(), true);
    return;
  }
  if (techFx.running && !force) return;
  stopTechFx();
  techFx.running = true;
  techFx.frame = requestAnimationFrame(techFxStep);
}
