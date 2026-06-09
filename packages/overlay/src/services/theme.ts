// ── Theme Service ──
// Exported surface:
// sanitizeTheme(value) — supported theme id or DEFAULT_THEME
// sanitizeOpacity(value) — number clamped to [0.5, 1.0]
// sanitizeZoom(value) — number clamped to [0.8, 1.6]
// resolvedTheme() — effective "light" | "dark" after system detection
// applyTheme(theme) — writes documentElement/body data-theme
// applyZoom(zoom) — writes --ui-scale CSS custom property via renderScale
// applyOpacity(opacity) — writes --ui-window-opacity CSS variable

import { MIN_WINDOW_OPACITY, sanitizeOpacity, settingsStore } from "../store/settings"
import { getHostTransport } from "./host-transport"
import { readInitialVsCodeHostTheme } from "./host-theme"
import { sanitizeThemeForHost, type OverlayThemeID } from "./theme-registry"

export { MIN_WINDOW_OPACITY, sanitizeOpacity } from "../store/settings"

// ── Constants ──

const MIN_UI_ZOOM = 0.8
const MAX_UI_ZOOM = 1.6

// DEFAULT_OVERLAY_SETTINGS.opacity
const DEFAULT_OPACITY = 0.8

// ── System theme media query ──
// Shared singleton,

const systemThemeMedia: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null

// ── sanitizeTheme ──
// "light" | "system" → returned as-is; everything else → default theme

export function sanitizeTheme(value: any): string {
  return sanitizeThemeForHost(value)
}

// ── sanitizeZoom ──
// - parse to float
// - NaN → 1
// - clamp to [MIN_UI_ZOOM (0.8), MAX_UI_ZOOM (1.6)]

export function sanitizeZoom(value: any): number {
  const next = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(next) ? Math.min(Math.max(next, MIN_UI_ZOOM), MAX_UI_ZOOM) : 1
}

// ── resolvedTheme ──
// Reads settingsStore.theme (sanitised), resolves "system" via matchMedia.

export function resolvedTheme(): string {
  const theme = sanitizeTheme(settingsStore.theme)
  return resolveThemeValue(theme)
}

function resolveThemeValue(theme: string): string {
  const host = getHostTransport().kind
  const hostScopedTheme: OverlayThemeID = sanitizeThemeForHost(theme, host)
  if (hostScopedTheme === "system") {
    if (host === "vscode") {
      const hostTheme = readInitialVsCodeHostTheme()
      if (hostTheme) return hostTheme
    }
    return systemThemeMedia?.matches ? "light" : "dark"
  }
  return hostScopedTheme
}

// ── applyTheme ──
// Writes the effective (resolved) theme to both root and body.
// `documentElement` drives the new palette-only theme layer; `body` keeps
// legacy God CSS selectors working until that file leaves the runtime path.
// Does NOT update brand logos; those belong to the respective Solid components.

export function applyTheme(theme: string): void {
  if (typeof document === "undefined") return
  const sanitized = sanitizeTheme(theme)
  const effective = resolveThemeValue(sanitized)
  document.documentElement.dataset.theme = effective
  document.body.dataset.theme = effective
}

// Tauri's native setOpacity is unreliable on transparent windows (returns ok
// but the compositor ignores it on Windows DWM). Single source of truth: the
// --ui-window-opacity CSS variable, which the theme files fold into the
// `--body-bg` alpha via color-mix(). At slider=100 the body bg becomes fully
// opaque; lower values mix toward `transparent` so the desktop bleeds
// through. We don't set `body { opacity }` — that would double-apply with
// the bg alpha (rule 8) and would dim text/UI unnecessarily.
export function applyOpacity(opacity: number): void {
  if (typeof document === "undefined") return
  document.documentElement.style.setProperty("--ui-window-opacity", String(sanitizeOpacity(opacity)))
}

// ── applyZoom ──
// The full renderScale() also triggers pane layout and chat sizing. Those are
// side-effects. This service function covers
// only the CSS write portion that is safe to call from Solid components:
// document.documentElement.style.setProperty("--ui-scale", ...)
// Callers that need the full layout recalc should trigger it .

export function applyZoom(zoom: number): void {
  if (typeof document === "undefined") return
  const sanitized = sanitizeZoom(zoom)
  // width / height from visualViewport, scale = min(w/1040, h/820),
  // base = clamp(scale, 0.82, 1.04), next = base * state.zoom
  const width = window.visualViewport?.width ?? window.innerWidth ?? 900
  const height = window.visualViewport?.height ?? window.innerHeight ?? 760
  const scale = Math.min(width / 1040, height / 820)
  const base = Math.max(0.82, Math.min(1.04, scale))
  const next = base * sanitized
  document.documentElement.style.setProperty("--ui-scale", next.toFixed(3))
}

// ── Zoom step constant (

const ZOOM_STEP = 0.1

// ── setZoom ──
// Set zoom to an absolute value, sanitise, then call applyZoom.
// effects, which remain.

export function setZoom(value: number): void {
  applyZoom(sanitizeZoom(value))
}

// ── stepZoom ──
// Increment or decrement the current CSS-derived zoom by delta.

export function stepZoom(delta: number): void {
  // Read the current zoom from the CSS custom property written by applyZoom.
  // We cannot read state.zoom directly without creating a circular
  // dependency, so we use the value stored in the CSS variable instead.
  const current = Number.parseFloat(document.documentElement.style.getPropertyValue("--ui-scale") || "1") || 1
  // current = base * zoom; we only want to nudge zoom so we normalise first.
  const width = window.visualViewport?.width ?? window.innerWidth ?? 900
  const height = window.visualViewport?.height ?? window.innerHeight ?? 760
  const scale = Math.min(width / 1040, height / 820)
  const base = Math.max(0.82, Math.min(1.04, scale))
  const currentZoom = base > 0 ? current / base : 1
  const next = Math.round((currentZoom + delta) * 100) / 100
  setZoom(next)
}

// ── handleZoomHotkey ──
// Handle Ctrl/Cmd +/−/0 keyboard shortcuts.

export function handleZoomHotkey(event: KeyboardEvent): void {
  if (typeof window === "undefined") return
  // Only intercept Ctrl/Cmd +/−/0 inside the Tauri overlay window —
  // browser preview and the VS Code webview rely on the host's native
  // zoom, so we must not steal the keystroke there.
  const isTauri = getHostTransport().kind === "tauri"
  if (!isTauri || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return

  const plus = event.code === "Equal" || event.code === "NumpadAdd" || event.key === "+" || event.key === "="
  if (plus) {
    event.preventDefault()
    stepZoom(ZOOM_STEP)
    return
  }

  const minus = event.code === "Minus" || event.code === "NumpadSubtract" || event.key === "-" || event.key === "_"
  if (minus) {
    event.preventDefault()
    stepZoom(-ZOOM_STEP)
    return
  }

  const reset = event.code === "Digit0" || event.code === "Numpad0" || event.key === "0"
  if (!reset) return
  event.preventDefault()
  setZoom(1)
}

/**
 * Register a listener for OS-level prefers-color-scheme changes.
 * Returns a cleanup function that removes the listener.
 */
export function installSystemThemeListener(onchange: () => void): () => void {
  if (!systemThemeMedia) return () => {}
  systemThemeMedia.addEventListener("change", onchange)
  return () => systemThemeMedia!.removeEventListener("change", onchange)
}

/** Toggle Tauri devtools (F12 handler). No-op outside Tauri. */
export async function toggleDevtools(): Promise<void> {
  try {
    await getHostTransport().native({ kind: "devtools.toggle" })
  } catch {
    // No-op for hosts without devtools (vscode webview).
  }
}
