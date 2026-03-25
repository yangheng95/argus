// ── Theme Service ──
// Exact port of theme / zoom / opacity helpers from app.js.
//
// Exported surface:
//   sanitizeTheme(value)   — "light" | "system" | "dark"  (mirrors app.js)
//   sanitizeOpacity(value) — number clamped to [0.7, 1.0]
//   sanitizeZoom(value)    — number clamped to [0.8, 1.6]
//   resolvedTheme()        — effective "light" | "dark" after system detection
//   applyTheme(theme)      — writes document.body.dataset.theme
//   applyZoom(zoom)        — writes --ui-scale CSS custom property via renderScale
//   applyOpacity(opacity)  — writes --ui-window-opacity or calls Tauri setOpacity

import { settingsStore } from "../store/settings";

// ── Constants (mirror app.js) ──

const MIN_WINDOW_OPACITY = 0.7;
const MIN_UI_ZOOM = 0.8;
const MAX_UI_ZOOM = 1.6;

// app.js DEFAULT_OVERLAY_SETTINGS.opacity
const DEFAULT_OPACITY = 0.8;

// ── System theme media query ──
// Shared singleton, mirrors app.js systemThemeMedia.

const systemThemeMedia: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

// ── sanitizeTheme ──
// Mirrors app.js sanitizeTheme exactly:
//   "light" | "system" → returned as-is; everything else → "dark"

export function sanitizeTheme(value: any): string {
  if (value === "light" || value === "system") return value as string;
  return "dark";
}

// ── sanitizeOpacity ──
// Mirrors app.js sanitizeOpacity:
//   - parse to float
//   - NaN → DEFAULT_OPACITY (0.8)
//   - clamp to [MIN_WINDOW_OPACITY (0.7), 1.0], round to 2 decimal places

export function sanitizeOpacity(value: any): number {
  const next =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(next)) return DEFAULT_OPACITY;
  return Math.max(
    MIN_WINDOW_OPACITY,
    Math.min(1, Math.round(next * 100) / 100),
  );
}

// ── sanitizeZoom ──
// Mirrors app.js sanitizeZoom + clampNumber:
//   - parse to float
//   - NaN → 1
//   - clamp to [MIN_UI_ZOOM (0.8), MAX_UI_ZOOM (1.6)]

export function sanitizeZoom(value: any): number {
  const next = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next)
    ? Math.min(Math.max(next, MIN_UI_ZOOM), MAX_UI_ZOOM)
    : 1;
}

// ── resolvedTheme ──
// Reads settingsStore.theme (sanitised), resolves "system" via matchMedia.
// Mirrors app.js resolvedTheme().

export function resolvedTheme(): string {
  const theme = sanitizeTheme(settingsStore.theme);
  if (theme === "system") {
    return systemThemeMedia?.matches ? "light" : "dark";
  }
  return theme;
}

// ── applyTheme ──
// Writes the effective (resolved) theme to document.body.dataset.theme.
// Mirrors app.js renderTheme() — DOM write portion only.
// Does NOT update brand logos or call renderTitlebarMenu (those belong to the
// respective Solid components).

export function applyTheme(theme: string): void {
  if (typeof document === "undefined") return;
  const sanitized = sanitizeTheme(theme);
  const effective = sanitized === "system"
    ? (systemThemeMedia?.matches ? "light" : "dark")
    : sanitized;
  document.body.dataset.theme = effective;
}

// ── Tauri window helper (internal) ──

async function currentTauriWindow(): Promise<any | null> {
  const getCurrent = (window as any).__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    try {
      return getCurrent() as any;
    } catch {
      // Not running inside Tauri
    }
  }
  return null;
}

// ── applyOpacity ──
// Mirrors app.js applyWindowOpacity():
//   1. Sanitise the value.
//   2. Try Tauri win.setOpacity(). If that succeeds set --ui-window-opacity to "1"
//      (native compositing handles it), otherwise set it to the numeric value.
//   3. In non-Tauri environments fall back to the CSS custom property.
// Returns true if the native Tauri API was used successfully.

export async function applyOpacity(opacity: number): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const value = sanitizeOpacity(opacity);
  const valueStr = String(value);

  const win = await currentTauriWindow();
  if (!win || typeof win.setOpacity !== "function") {
    document.documentElement.style.setProperty(
      "--ui-window-opacity",
      valueStr,
    );
    return false;
  }

  const ok = await win.setOpacity(value).then(
    () => true,
    () => false,
  );
  document.documentElement.style.setProperty(
    "--ui-window-opacity",
    ok ? "1" : valueStr,
  );
  return ok;
}

// ── applyZoom ──
// Mirrors app.js setZoom() / renderScale() — CSS custom property write only.
// The full renderScale() also triggers pane layout, fitBrandVersion, sizeChat, etc.
// Those are side-effects owned by the legacy app.js. This service function covers
// only the CSS write portion that is safe to call from Solid components:
//   document.documentElement.style.setProperty("--ui-scale", ...)
// Callers that need the full layout recalc should trigger it via app.js bridge.

export function applyZoom(zoom: number): void {
  if (typeof document === "undefined") return;
  const sanitized = sanitizeZoom(zoom);
  // Mirrors app.js renderScale() calculation:
  //   width / height from visualViewport, scale = min(w/1040, h/820),
  //   base = clamp(scale, 0.82, 1.04), next = base * state.zoom
  const width =
    window.visualViewport?.width ?? window.innerWidth ?? 900;
  const height =
    window.visualViewport?.height ?? window.innerHeight ?? 760;
  const scale = Math.min(width / 1040, height / 820);
  const base = Math.max(0.82, Math.min(1.04, scale));
  const next = base * sanitized;
  document.documentElement.style.setProperty("--ui-scale", next.toFixed(3));
}

// ── Zoom step constant (mirrors app.js ZOOM_STEP) ──

const ZOOM_STEP = 0.1;

// ── setZoom ──
// Set zoom to an absolute value, sanitise, then call applyZoom.
// Mirrors app.js setZoom() — without the state / persistOverlaySettings side
// effects, which remain in app.js during the migration.

export function setZoom(value: number): void {
  applyZoom(sanitizeZoom(value));
}

// ── stepZoom ──
// Increment or decrement the current CSS-derived zoom by delta.
// Mirrors app.js stepZoom(delta).

export function stepZoom(delta: number): void {
  // Read the current zoom from the CSS custom property written by applyZoom.
  // We cannot read app.js state.zoom directly without creating a circular
  // dependency, so we use the value stored in the CSS variable instead.
  const current = Number.parseFloat(
    document.documentElement.style.getPropertyValue("--ui-scale") || "1",
  ) || 1;
  // current = base * zoom; we only want to nudge zoom so we normalise first.
  const width =
    window.visualViewport?.width ?? window.innerWidth ?? 900;
  const height =
    window.visualViewport?.height ?? window.innerHeight ?? 760;
  const scale = Math.min(width / 1040, height / 820);
  const base = Math.max(0.82, Math.min(1.04, scale));
  const currentZoom = base > 0 ? current / base : 1;
  const next = Math.round((currentZoom + delta) * 100) / 100;
  setZoom(next);
}

// ── handleZoomHotkey ──
// Handle Ctrl/Cmd +/−/0 keyboard shortcuts.
// Mirrors app.js handleZoomHotkey(event).

export function handleZoomHotkey(event: KeyboardEvent): void {
  if (typeof window === "undefined") return;
  const hasTauri =
    typeof (window as any).__TAURI__?.core?.invoke === "function";
  if (!hasTauri || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;

  const plus =
    event.code === "Equal" ||
    event.code === "NumpadAdd" ||
    event.key === "+" ||
    event.key === "=";
  if (plus) {
    event.preventDefault();
    stepZoom(ZOOM_STEP);
    return;
  }

  const minus =
    event.code === "Minus" ||
    event.code === "NumpadSubtract" ||
    event.key === "-" ||
    event.key === "_";
  if (minus) {
    event.preventDefault();
    stepZoom(-ZOOM_STEP);
    return;
  }

  const reset =
    event.code === "Digit0" ||
    event.code === "Numpad0" ||
    event.key === "0";
  if (!reset) return;
  event.preventDefault();
  setZoom(1);
}

// ── shouldMigrateOpacity ──
// Returns true when the persisted opacity value is a legacy sub-0.3 value that
// should be migrated upward to the minimum supported value.
// Mirrors app.js shouldMigrateOpacity() (line 927).

const OPACITY_MIGRATION_KEY = "oc_opacity_migrated_v1";
const LEGACY_WINDOW_OPACITY = 0.3;

export function shouldMigrateOpacity(value: unknown): boolean {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(OPACITY_MIGRATION_KEY) === "true") return false;
  const next =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next) && next <= LEGACY_WINDOW_OPACITY;
}

// ── applyWindowPin ──
// Apply the alwaysOnTop state to the native Tauri window.
// Mirrors app.js applyWindowPin() — without the state / renderTitlebarMenu
// side effects, which remain in app.js during the migration.
// Returns true when the Tauri API was called successfully.

export async function applyWindowPin(alwaysOnTop: boolean): Promise<boolean> {
  const win = await currentTauriWindow();
  if (!win || typeof win.setAlwaysOnTop !== "function") return false;
  await win.setAlwaysOnTop(alwaysOnTop).catch(() => undefined);
  return true;
}

// ── withUnpinned ──
// Temporarily unpin the window, run an async callback, then restore pin state.
// Mirrors app.js withUnpinned(run).

export async function withUnpinned<T>(run: () => Promise<T> | T): Promise<T> {
  const win = await currentTauriWindow();
  if (
    !win ||
    typeof win.isAlwaysOnTop !== "function" ||
    typeof win.setAlwaysOnTop !== "function"
  ) {
    return run();
  }
  const pinned = await win.isAlwaysOnTop().catch(() => false);
  if (!pinned) return run();
  await win.setAlwaysOnTop(false).catch(() => undefined);
  try {
    return await run();
  } finally {
    await win.setAlwaysOnTop(true).catch(() => undefined);
    await win.setFocus?.().catch(() => undefined);
  }
}

// ── applyWindowOpacity ──
// Apply window opacity via Tauri native API (preferred) or CSS variable fallback.
// Mirrors app.js applyWindowOpacity (line 1730).
// Render side-effects (renderTitlebarMenu) remain in app.js during migration.

export async function applyWindowOpacity(opacity: number): Promise<boolean> {
  const value = String(sanitizeOpacity(opacity));
  const win = await currentTauriWindow();
  if (!win || typeof (win as any).setOpacity !== "function") {
    document.documentElement.style.setProperty("--ui-window-opacity", value);
    return false;
  }
  const ok = await (win as any).setOpacity(sanitizeOpacity(opacity)).then(
    () => true,
    () => false,
  );
  document.documentElement.style.setProperty("--ui-window-opacity", ok ? "1" : value);
  return ok;
}
