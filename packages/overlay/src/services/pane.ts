// ── Pane Resizer Service ──
// Config-driven pane resizer for the default task Panel layout. The hardcoded
// element ids / CSS variables that used to be baked in now live in a
// `PaneConfig` so the drag logic stays layout-agnostic without duplicating
// DOM-specific resize code
// (CLAUDE.md rule 8 — single source, rule 9 — abstract the pattern once).
//
// references covered:
// - sanitizePaneWidth (util — also in store/settings.ts)
// - clampNumber (util)
// - paneHandleWidth (DOM helper)
// - defaultRailWidth (layout helper)
// - resolvedPaneWidths (layout helper)
// - renderPaneLayout (applies CSS custom properties)
// - resizePane (drag handler)
// - onPaneResizeMove (pointermove listener)
// - stopPaneResize (pointerup / pointercancel listener)
// - startPaneResize (pointerdown handler)
// - initPaneResizers (attaches listeners to DOM handles)
// - applyPaneWidths (imperatively set widths without dragging)
// The service reads and writes the left sidebar width via the callbacks
// supplied to initPaneResizers(), so the caller
// controls where those values are stored (Solid store, plain state, etc.)
// and which DOM handles / CSS variables back them via the PaneConfig.

import { createAnimationFrameScheduler, type AnimationFrameScheduler } from "../utils/animation-frame"
import { layoutTokenPx } from "../utils/layout-tokens"

// ── Types ──

/**
 * Describes the DOM handles and CSS custom properties that back one
 * horizontal layout. The default Panel supplies the DOM ids and CSS variables
 * so the shared drag logic stays layout-agnostic.
 */
export interface PaneConfig {
  /** Element whose clientWidth bounds the whole row. */
  bodyId: string
  /** Left (sidebar) resize handle element id. */
  leftHandleId: string
  /** Element ids controlled by the left resize handle. */
  leftControls: readonly string[]
  /** CSS custom property that carries the left column width (px). */
  sidebarVar: string
}

/** Default Panel layout (index.html `.panel-body`). */
export const PANEL_PANE_CONFIG: PaneConfig = {
  bodyId: "panelBody",
  leftHandleId: "leftPaneResizer",
  leftControls: ["sidebar", "workspaceMain"],
  sidebarVar: "--ui-sidebar-width",
}

export interface PaneState {
  sidebarWidth: number | null
  sidebarCollapsed: boolean
}

export interface PaneCallbacks {
  /** Read the current pane state. */
  getState: () => PaneState
  /**
   * Called whenever the user finishes a drag or widths are applied
   * programmatically. Persist the new widths here (e.g. save to store /
   * the active host settings source).
   */
  onWidthsChanged: (sidebarWidth: number | null) => void | Promise<void>
}

// ── Module-level drag state ──

interface PaneDrag {
  config: PaneConfig
  callbacks: PaneCallbacks
  pendingClientX: number | null
  resizeOnFrame: AnimationFrameScheduler
}

let paneDrag: PaneDrag | null = null

interface PaneResizeBounds {
  bodyRect: DOMRect
  min: number
  max: number
  now: number
}

const pendingPaneHandleSemantics = new Map<PaneConfig, PaneState>()

function flushPaneHandleSemantics(): void {
  const entries = Array.from(pendingPaneHandleSemantics.entries())
  pendingPaneHandleSemantics.clear()
  for (const [config, state] of entries) {
    renderPaneHandleSemantics(state, config)
  }
}

const renderPaneHandleSemanticsOnFrame = createAnimationFrameScheduler(flushPaneHandleSemantics)

function schedulePaneHandleSemantics(state: PaneState, config: PaneConfig): void {
  pendingPaneHandleSemantics.set(config, { ...state })
  renderPaneHandleSemanticsOnFrame.schedule()
}

// ── Helpers ──

/** Clamp a number to [min, max]. */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Return the rendered width of a pane resize handle element.
 * Falls back to the --ui-resizer-width CSS custom property.
 */
export function paneHandleWidth(node: Element | null | undefined): number {
  if (!node) return 0
  const style = getComputedStyle(node as HTMLElement)
  if (style.display === "none" || style.visibility === "hidden") return 0
  const width = node.getBoundingClientRect().width
  if (width > 0) return width
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-resizer-width")) || 0
}

function paneBodyWidth(config: PaneConfig): number {
  const body = document.getElementById(config.bodyId) as HTMLElement | null
  if (!body) throw new Error(`Pane body element not found: ${config.bodyId}`)
  return body.clientWidth
}

function paneHandleElement(config: PaneConfig): HTMLElement | null {
  return document.getElementById(config.leftHandleId)
}

function paneHandleEnabled(state: PaneState, config: PaneConfig): boolean {
  const handle = paneHandleElement(config)
  return !state.sidebarCollapsed && paneHandleWidth(handle) > 0
}

function paneResolvedSidebarWidth(state: PaneState, config: PaneConfig): number {
  const widths = resolvedPaneWidths(state, config)
  return widths.sidebar
}

/**
 * Compute the default rail width from the shared layout token contract.
 */
export function defaultRailWidth(config: PaneConfig): number {
  void config
  return layoutTokenPx("--ui-rail-width")
}

/**
 * Read the --ui-scale CSS custom property (
 */
export function currentUIScale(): number {
  if (typeof document === "undefined") return 1
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1
}

function paneWidthStyleScope(): HTMLElement {
  return document.body || document.documentElement
}

function setPaneWidthProperty(name: string, value: number): void {
  paneWidthStyleScope().style.setProperty(name, `${value}px`)
}

function readPaneWidthProperty(name: string): number {
  return Number.parseFloat(getComputedStyle(paneWidthStyleScope()).getPropertyValue(name))
}

/**
 * Compute the final sidebar width after overflow clamping.
 */
export function resolvedPaneWidths(
  state: PaneState,
  config: PaneConfig,
): {
  sidebar: number
} {
  const panelWidth = paneBodyWidth(config)
  const railMin = layoutTokenPx("--ui-rail-min-width")
  const chatMin = layoutTokenPx("--ui-chat-min-width")

  const leftHandle = paneHandleWidth(paneHandleElement(config))
  const total = panelWidth - leftHandle
  const railMax = Math.max(railMin, total - chatMin)
  const sidebar = clampNumber(state.sidebarWidth ?? defaultRailWidth(config), railMin, railMax)
  return { sidebar: Math.round(sidebar) }
}

function paneResizeBounds(state: PaneState, config: PaneConfig): PaneResizeBounds | null {
  const panelBody = document.getElementById(config.bodyId)
  const bodyRect = panelBody?.getBoundingClientRect()
  if (!bodyRect) return null

  const railMin = layoutTokenPx("--ui-rail-min-width")
  const now = paneResolvedSidebarWidth(state, config)
  let max = bodyRect.width
  for (let index = 0; index < 6; index += 1) {
    const next = paneResolvedSidebarWidth(
      {
        ...state,
        sidebarWidth: max,
      },
      config,
    )
    if (Math.abs(next - max) <= 1) {
      max = next
      break
    }
    max = next
  }
  max = Math.min(
    max,
    paneResolvedSidebarWidth(
      {
        ...state,
        sidebarWidth: max,
      },
      config,
    ),
  )
  max = Math.max(railMin, max)
  return {
    bodyRect,
    min: Math.round(railMin),
    max: Math.round(max),
    now: Math.round(clampNumber(now, railMin, max)),
  }
}

function renderPaneHandleSemantics(state: PaneState, config: PaneConfig): void {
  const handle = paneHandleElement(config)
  if (!handle) return
  const enabled = paneHandleEnabled(state, config)
  handle.hidden = state.sidebarCollapsed
  handle.dataset.disabled = String(!enabled)
  handle.tabIndex = enabled ? 0 : -1
  if (config.leftControls.length) handle.setAttribute("aria-controls", config.leftControls.join(" "))
  else handle.removeAttribute("aria-controls")
  const bounds = enabled ? paneResizeBounds(state, config) : null
  if (!bounds) {
    handle.removeAttribute("aria-valuemin")
    handle.removeAttribute("aria-valuemax")
    handle.removeAttribute("aria-valuenow")
    return
  }
  handle.setAttribute("aria-valuemin", String(bounds.min))
  handle.setAttribute("aria-valuemax", String(bounds.max))
  handle.setAttribute("aria-valuenow", String(bounds.now))
}

/**
 * Apply the resolved pane widths as CSS custom properties on
 * the pane-width style scope (document.body).
 */
export function renderPaneLayout(state: PaneState, config: PaneConfig): void {
  if (typeof document === "undefined") return
  const widths = resolvedPaneWidths(state, config)
  setPaneWidthProperty(config.sidebarVar, widths.sidebar)
  schedulePaneHandleSemantics(state, config)
}

/**
 * Imperatively set the sidebar width, re-render layout, and call onWidthsChanged.
 * Equivalent to calling state.sidebarWidth = x; renderPaneLayout().
 */
export function applyPaneWidths(
  sidebarWidth: number | null,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  const state = callbacks.getState()
  const next: PaneState = {
    ...state,
    sidebarWidth: sidebarWidth ?? state.sidebarWidth,
  }
  renderPaneLayout(next, config)
  void callbacks.onWidthsChanged(next.sidebarWidth)
}

// ── Drag logic ──

/**
 * Compute new sidebarWidth from a pointer X position.
 * Mutates the PaneState values returned by callbacks.getState() by calling
 * renderPaneLayout with a derived state — state is NOT mutated; the caller is
 * responsible for updating their store in onWidthsChanged.
 */
function resizePane(clientX: number, callbacks: PaneCallbacks, config: PaneConfig): void {
  const state = callbacks.getState()
  const bounds = paneResizeBounds(state, config)
  if (!bounds) return

  const newSidebarWidth = Math.round(clampNumber(clientX - bounds.bodyRect.left, bounds.min, bounds.max))
  renderPaneLayout({ ...state, sidebarWidth: newSidebarWidth }, config)
}

function flushPendingPaneResize(): void {
  if (!paneDrag) return
  const clientX = paneDrag.pendingClientX
  if (clientX === null) return
  paneDrag.pendingClientX = null
  resizePane(clientX, paneDrag.callbacks, paneDrag.config)
}

function onPaneResizeMove(event: PointerEvent): void {
  if (!paneDrag) return
  paneDrag.pendingClientX = event.clientX
  paneDrag.resizeOnFrame.schedule()
}

async function persistRenderedPaneWidths(
  callbacks: PaneCallbacks,
  config: PaneConfig,
): Promise<void> {
  const sidebarPx = readPaneWidthProperty(config.sidebarVar)
  const sidebarWidth = Number.isFinite(sidebarPx) ? Math.round(sidebarPx) : null

  await callbacks.onWidthsChanged(sidebarWidth)
}

async function stopPaneResize(): Promise<void> {
  if (!paneDrag) return
  paneDrag.resizeOnFrame.cancel()
  flushPendingPaneResize()
  const config = paneDrag.config
  const handle = paneHandleElement(config)
  if (handle) delete (handle as HTMLElement).dataset.active
  const callbacks = paneDrag.callbacks
  paneDrag = null
  delete document.body.dataset.resizing
  await persistRenderedPaneWidths(callbacks, config)
}

function startPaneResize(
  event: PointerEvent,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  if (event.button != null && event.button !== 0) return
  const state = callbacks.getState()
  if (!paneHandleEnabled(state, config)) return
  paneDrag = {
    config,
    callbacks,
    pendingClientX: null,
    resizeOnFrame: createAnimationFrameScheduler(flushPendingPaneResize),
  }
  const handle = paneHandleElement(config)
  if (handle) (handle as HTMLElement).dataset.active = "true"
  document.body.dataset.resizing = "true"

  // Capture listeners with callbacks in closure
  function onMove(ev: PointerEvent) {
    onPaneResizeMove(ev)
  }
  async function onUp() {
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onUp)
    await stopPaneResize()
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onUp)

  resizePane(event.clientX, callbacks, config)
  event.preventDefault()
}

function resizePaneByKeyboard(
  event: KeyboardEvent,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  const state = callbacks.getState()
  if (!paneHandleEnabled(state, config)) return
  const bounds = paneResizeBounds(state, config)
  if (!bounds) return
  const step = Math.round(24 * currentUIScale())
  let next = bounds.now
  if (event.key === "ArrowLeft") {
    next -= step
  } else if (event.key === "ArrowRight") {
    next += step
  } else if (event.key === "Home") {
    next = bounds.min
  } else if (event.key === "End") {
    next = bounds.max
  } else {
    return
  }
  event.preventDefault()
  const width = Math.round(clampNumber(next, bounds.min, bounds.max))
  renderPaneLayout(
    {
      ...state,
      sidebarWidth: width,
    },
    config,
  )
  void persistRenderedPaneWidths(callbacks, config)
}

// ── Public API ──

/**
 * Attach pointerdown listeners to the config's left resize handle.
 * Call once from onMount (or equivalent) after the DOM has been rendered.
 * Returns a cleanup function that removes the listeners.
 */
export function initPaneResizers(callbacks: PaneCallbacks, config: PaneConfig): () => void {
  const leftHandle = paneHandleElement(config)

  function onLeftDown(ev: Event) {
    startPaneResize(ev as PointerEvent, callbacks, config)
  }
  function onLeftKeyDown(ev: Event) {
    resizePaneByKeyboard(ev as KeyboardEvent, callbacks, config)
  }

  leftHandle?.addEventListener("pointerdown", onLeftDown)
  leftHandle?.addEventListener("keydown", onLeftKeyDown)

  // Render layout immediately so the initial widths are applied
  renderPaneLayout(callbacks.getState(), config)

  return () => {
    leftHandle?.removeEventListener("pointerdown", onLeftDown)
    leftHandle?.removeEventListener("keydown", onLeftKeyDown)
  }
}

/**
 * Stop any in-progress pane resize.
 * Call on window blur (
 */
export async function cancelPaneResize(callbacks: PaneCallbacks): Promise<void> {
  void callbacks
  if (!paneDrag) return
  await stopPaneResize()
}
