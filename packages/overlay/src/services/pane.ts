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
// The service reads and writes two persistent values (sidebar + sections
// widths) via the callbacks supplied to initPaneResizers(), so the caller
// controls where those values are stored (Solid store, plain state, etc.)
// and which DOM handles / CSS variables back them via the PaneConfig.

import { createAnimationFrameScheduler, type AnimationFrameScheduler } from "../utils/animation-frame"

// ── Types ──

/**
 * Describes the DOM handles and CSS custom properties that back one
 * horizontal layout. The default Panel supplies the DOM ids and CSS variables
 * so the shared drag logic stays layout-agnostic.
 */
export interface PaneConfig {
  /** Element whose clientWidth bounds the whole row (left+center+right). */
  bodyId: string
  /** Left (sidebar) resize handle element id. */
  leftHandleId: string
  /** Element ids controlled by the left resize handle. */
  leftControls: readonly string[]
  /** Right (sections) resize handle element id, absent in layouts without a right pane. */
  rightHandleId: string | null
  /** Element ids controlled by the right resize handle. */
  rightControls: readonly string[] | null
  /** CSS custom property that carries the left column width (px). */
  sidebarVar: string
  /** CSS custom property that carries the right column width (px). */
  sectionsVar: string
}

/** Default Panel layout (index.html `.panel-body`). */
export const PANEL_PANE_CONFIG: PaneConfig = {
  bodyId: "panelBody",
  leftHandleId: "leftPaneResizer",
  leftControls: ["sidebar", "workspaceMain"],
  rightHandleId: null,
  rightControls: null,
  sidebarVar: "--ui-sidebar-width",
  sectionsVar: "--ui-sections-width",
}

export interface PaneState {
  sidebarWidth: number | null
  sectionsWidth: number | null
  sidebarCollapsed: boolean
  rightPanelCollapsed: boolean
}

export interface PaneCallbacks {
  /** Read the current pane state. */
  getState: () => PaneState
  /**
   * Called whenever the user finishes a drag or widths are applied
   * programmatically. Persist the new widths here (e.g. save to store /
   * the active host settings source).
   */
  onWidthsChanged: (sidebarWidth: number | null, sectionsWidth: number | null) => void | Promise<void>
}

// ── Module-level drag state ──

interface PaneDrag {
  side: "left" | "right"
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
  return (
    (document.getElementById(config.bodyId) as HTMLElement | null)?.clientWidth ??
    window.visualViewport?.width ??
    window.innerWidth ??
    900
  )
}

function paneHandleElement(config: PaneConfig, side: "left" | "right"): HTMLElement | null {
  const id = side === "left" ? config.leftHandleId : config.rightHandleId
  return id ? document.getElementById(id) : null
}

function paneHandleControls(config: PaneConfig, side: "left" | "right"): readonly string[] | null {
  return side === "left" ? config.leftControls : config.rightControls
}

function paneHandleCollapsed(state: PaneState, side: "left" | "right"): boolean {
  return side === "left" ? state.sidebarCollapsed : state.rightPanelCollapsed
}

function paneHandleEnabled(state: PaneState, config: PaneConfig, side: "left" | "right"): boolean {
  const handle = paneHandleElement(config, side)
  return !paneHandleCollapsed(state, side) && paneHandleWidth(handle) > 0
}

function paneResolvedWidthForSide(state: PaneState, config: PaneConfig, side: "left" | "right"): number {
  const widths = resolvedPaneWidths(state, config)
  return side === "left" ? widths.sidebar : widths.sections
}

/**
 * Compute the default rail width based on the current panel width.
 */
export function defaultRailWidth(config: PaneConfig): number {
  const scale = currentUIScale()
  const panelWidth = paneBodyWidth(config)
  return clampNumber(panelWidth * 0.22, 220 * scale, 380 * scale)
}

/**
 * Compute the default width for the right-side sections pane.
 */
export function defaultSectionsWidth(config: PaneConfig): number {
  const scale = currentUIScale()
  const panelWidth = paneBodyWidth(config)
  return clampNumber(panelWidth * 0.3, 380 * scale, 560 * scale)
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
 * Compute the final sidebar and sections widths after overflow clamping.
 */
export function resolvedPaneWidths(
  state: PaneState,
  config: PaneConfig,
): {
  sidebar: number
  sections: number
} {
  const scale = currentUIScale()
  const panelWidth = paneBodyWidth(config)
  const railMin = 120 * scale
  const chatPreferred = 500 * scale
  const chatMin = 300 * scale

  const leftHandle = paneHandleWidth(paneHandleElement(config, "left"))
  const rightHandle = paneHandleWidth(paneHandleElement(config, "right"))

  const total = panelWidth - leftHandle - rightHandle
  const railMax = Math.max(railMin, total - chatMin - railMin)
  let sidebar = clampNumber(state.sidebarWidth ?? defaultRailWidth(config), railMin, railMax)
  let sections = clampNumber(state.sectionsWidth ?? defaultSectionsWidth(config), railMin, railMax)
  let actualSidebar = sidebar
  let actualSections = sections
  const sidebarFloor = railMin
  const sectionsFloor = railMin

  // First overflow pass — prefer-chat reduction
  if (actualSidebar + actualSections + chatPreferred > total) {
    let overflow = actualSidebar + actualSections + chatPreferred - total
    const sidebarCap = Math.max(0, actualSidebar - sidebarFloor)
    const sectionsCap = Math.max(0, actualSections - sectionsFloor)
    const totalCap = sidebarCap + sectionsCap
    if (totalCap > 0) {
      const sidebarShrink = Math.min(sidebarCap, overflow * (sidebarCap / totalCap))
      actualSidebar -= sidebarShrink
      overflow -= sidebarShrink
      const sectionsShrink = Math.min(sectionsCap, overflow)
      actualSections -= sectionsShrink
      overflow -= sectionsShrink
      if (overflow > 0) {
        const extraSidebar = Math.min(Math.max(0, actualSidebar - railMin), overflow)
        actualSidebar -= extraSidebar
      }
    }
  }

  // Second overflow pass — hard chatMin reduction
  if (actualSidebar + actualSections + chatMin > total) {
    const overflow = actualSidebar + actualSections + chatMin - total
    const sectionsShrink = Math.min(Math.max(0, actualSections - sectionsFloor), overflow)
    actualSections -= sectionsShrink
    const remaining = overflow - sectionsShrink
    if (remaining > 0) {
      actualSidebar -= Math.min(Math.max(0, actualSidebar - railMin), remaining)
    }
  }

  sidebar = clampNumber(actualSidebar, sidebarFloor, railMax)
  sections = clampNumber(actualSections, sectionsFloor, railMax)
  return { sidebar: Math.round(sidebar), sections: Math.round(sections) }
}

function paneResizeBounds(state: PaneState, config: PaneConfig, side: "left" | "right"): PaneResizeBounds | null {
  const panelBody = document.getElementById(config.bodyId)
  const bodyRect = panelBody?.getBoundingClientRect()
  if (!bodyRect) return null

  const scale = currentUIScale()
  const railMin = 120 * scale
  const now = paneResolvedWidthForSide(state, config, side)
  let max = bodyRect.width
  for (let index = 0; index < 6; index += 1) {
    const next = paneResolvedWidthForSide(
      {
        ...state,
        ...(side === "left" ? { sidebarWidth: max } : { sectionsWidth: max }),
      },
      config,
      side,
    )
    if (Math.abs(next - max) <= 1) {
      max = next
      break
    }
    max = next
  }
  max = Math.min(
    max,
    paneResolvedWidthForSide(
      {
        ...state,
        ...(side === "left" ? { sidebarWidth: max } : { sectionsWidth: max }),
      },
      config,
      side,
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
  for (const side of ["left", "right"] as const) {
    const handle = paneHandleElement(config, side)
    if (!handle) continue
    const collapsed = paneHandleCollapsed(state, side)
    const enabled = paneHandleEnabled(state, config, side)
    const controls = paneHandleControls(config, side)
    handle.hidden = collapsed
    handle.dataset.disabled = String(!enabled)
    handle.tabIndex = enabled ? 0 : -1
    if (controls?.length) handle.setAttribute("aria-controls", controls.join(" "))
    else handle.removeAttribute("aria-controls")
    const bounds = enabled ? paneResizeBounds(state, config, side) : null
    if (!bounds) {
      handle.removeAttribute("aria-valuemin")
      handle.removeAttribute("aria-valuemax")
      handle.removeAttribute("aria-valuenow")
      continue
    }
    handle.setAttribute("aria-valuemin", String(bounds.min))
    handle.setAttribute("aria-valuemax", String(bounds.max))
    handle.setAttribute("aria-valuenow", String(bounds.now))
  }
}

/**
 * Apply the resolved pane widths as CSS custom properties on
 * the pane-width style scope (document.body).
 */
export function renderPaneLayout(state: PaneState, config: PaneConfig): void {
  if (typeof document === "undefined") return
  const widths = resolvedPaneWidths(state, config)
  setPaneWidthProperty(config.sidebarVar, widths.sidebar)
  setPaneWidthProperty(config.sectionsVar, widths.sections)
  schedulePaneHandleSemantics(state, config)
}

/**
 * Imperatively set sidebar and/or sections widths, re-render layout, and
 * call onWidthsChanged.
 * Equivalent to calling state.sidebarWidth = x; renderPaneLayout().
 */
export function applyPaneWidths(
  sidebarWidth: number | null,
  sectionsWidth: number | null,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  const state = callbacks.getState()
  const next: PaneState = {
    ...state,
    sidebarWidth: sidebarWidth ?? state.sidebarWidth,
    sectionsWidth: sectionsWidth ?? state.sectionsWidth,
  }
  renderPaneLayout(next, config)
  void callbacks.onWidthsChanged(next.sidebarWidth, next.sectionsWidth)
}

// ── Drag logic ──

/**
 * Compute new sidebarWidth or sectionsWidth from a pointer X position.
 * Mutates the PaneState values returned by callbacks.getState() by calling
 * renderPaneLayout with a derived state — state is NOT mutated; the caller is
 * responsible for updating their store in onWidthsChanged.
 */
function resizePane(side: "left" | "right", clientX: number, callbacks: PaneCallbacks, config: PaneConfig): void {
  const state = callbacks.getState()
  const bounds = paneResizeBounds(state, config, side)
  if (!bounds) return

  if (side === "left") {
    const newSidebarWidth = Math.round(clampNumber(clientX - bounds.bodyRect.left, bounds.min, bounds.max))
    renderPaneLayout({ ...state, sidebarWidth: newSidebarWidth }, config)
    return
  }

  const newSectionsWidth = Math.round(clampNumber(bounds.bodyRect.right - clientX, bounds.min, bounds.max))
  renderPaneLayout({ ...state, sectionsWidth: newSectionsWidth }, config)
}

function flushPendingPaneResize(): void {
  if (!paneDrag) return
  const clientX = paneDrag.pendingClientX
  if (clientX === null) return
  paneDrag.pendingClientX = null
  resizePane(paneDrag.side, clientX, paneDrag.callbacks, paneDrag.config)
}

function onPaneResizeMove(event: PointerEvent): void {
  if (!paneDrag) return
  paneDrag.pendingClientX = event.clientX
  paneDrag.resizeOnFrame.schedule()
}

async function persistRenderedPaneWidths(
  callbacks: PaneCallbacks,
  config: PaneConfig,
  side: "left" | "right",
): Promise<void> {
  const sidebarPx = readPaneWidthProperty(config.sidebarVar)
  const sectionsPx = readPaneWidthProperty(config.sectionsVar)
  const sidebarWidth = Number.isFinite(sidebarPx) ? Math.round(sidebarPx) : null
  const sectionsWidth = Number.isFinite(sectionsPx) ? Math.round(sectionsPx) : null

  await callbacks.onWidthsChanged(side === "left" ? sidebarWidth : null, side === "right" ? sectionsWidth : null)
}

async function stopPaneResize(): Promise<void> {
  if (!paneDrag) return
  paneDrag.resizeOnFrame.cancel()
  flushPendingPaneResize()
  const config = paneDrag.config
  const handle = paneHandleElement(config, paneDrag.side)
  if (handle) delete (handle as HTMLElement).dataset.active
  const side = paneDrag.side
  const callbacks = paneDrag.callbacks
  paneDrag = null
  delete document.body.dataset.resizing
  await persistRenderedPaneWidths(callbacks, config, side)
}

function startPaneResize(
  side: "left" | "right",
  event: PointerEvent,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  if (event.button != null && event.button !== 0) return
  const state = callbacks.getState()
  if (!paneHandleEnabled(state, config, side)) return
  paneDrag = {
    side,
    config,
    callbacks,
    pendingClientX: null,
    resizeOnFrame: createAnimationFrameScheduler(flushPendingPaneResize),
  }
  const handle = paneHandleElement(config, side)
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

  resizePane(side, event.clientX, callbacks, config)
  event.preventDefault()
}

function resizePaneByKeyboard(
  side: "left" | "right",
  event: KeyboardEvent,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  const state = callbacks.getState()
  if (!paneHandleEnabled(state, config, side)) return
  const bounds = paneResizeBounds(state, config, side)
  if (!bounds) return
  const step = Math.round(24 * currentUIScale())
  let next = bounds.now
  if (event.key === "ArrowLeft") {
    next += side === "left" ? -step : step
  } else if (event.key === "ArrowRight") {
    next += side === "left" ? step : -step
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
      ...(side === "left" ? { sidebarWidth: width } : { sectionsWidth: width }),
    },
    config,
  )
  void persistRenderedPaneWidths(callbacks, config, side)
}

// ── Public API ──

/**
 * Attach pointerdown listeners to the config's left/right resize handles.
 * Call once from onMount (or equivalent) after the DOM has been rendered.
 * Returns a cleanup function that removes the listeners.
 */
export function initPaneResizers(callbacks: PaneCallbacks, config: PaneConfig): () => void {
  const leftHandle = paneHandleElement(config, "left")
  const rightHandle = paneHandleElement(config, "right")

  function onLeftDown(ev: Event) {
    startPaneResize("left", ev as PointerEvent, callbacks, config)
  }
  function onRightDown(ev: Event) {
    startPaneResize("right", ev as PointerEvent, callbacks, config)
  }
  function onLeftKeyDown(ev: Event) {
    resizePaneByKeyboard("left", ev as KeyboardEvent, callbacks, config)
  }
  function onRightKeyDown(ev: Event) {
    resizePaneByKeyboard("right", ev as KeyboardEvent, callbacks, config)
  }

  leftHandle?.addEventListener("pointerdown", onLeftDown)
  rightHandle?.addEventListener("pointerdown", onRightDown)
  leftHandle?.addEventListener("keydown", onLeftKeyDown)
  rightHandle?.addEventListener("keydown", onRightKeyDown)

  // Render layout immediately so the initial widths are applied
  renderPaneLayout(callbacks.getState(), config)

  return () => {
    leftHandle?.removeEventListener("pointerdown", onLeftDown)
    rightHandle?.removeEventListener("pointerdown", onRightDown)
    leftHandle?.removeEventListener("keydown", onLeftKeyDown)
    rightHandle?.removeEventListener("keydown", onRightKeyDown)
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
