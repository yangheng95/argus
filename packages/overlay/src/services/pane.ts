// ── Pane Resizer Service ──
// Config-driven three-column resizer shared by every horizontal pane layout
// (default Panel + Mission). The hardcoded element ids / CSS variables that
// used to be baked in now live in a `PaneConfig` so the same drag logic can
// drive multiple independent layouts without a second implementation
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

// ── Types ──

/**
 * Describes the DOM handles and CSS custom properties that back one
 * horizontal three-column layout. The default Panel and the Mission page
 * each supply their own so the shared drag logic stays layout-agnostic.
 */
export interface PaneConfig {
  /** Element whose clientWidth bounds the whole row (left+center+right). */
  bodyId: string;
  /** Center column element (used to bound the right-handle drag). */
  centerId: string;
  /** Left (sidebar) resize handle element id. */
  leftHandleId: string;
  /** Right (sections) resize handle element id. */
  rightHandleId: string;
  /** CSS custom property that carries the left column width (px). */
  sidebarVar: string;
  /** CSS custom property that carries the right column width (px). */
  sectionsVar: string;
}

/** Default Panel layout (index.html `.panel-body`). */
export const PANEL_PANE_CONFIG: PaneConfig = {
  bodyId: "panelBody",
  centerId: "workspaceMain",
  leftHandleId: "leftPaneResizer",
  rightHandleId: "rightPaneResizer",
  sidebarVar: "--ui-sidebar-width",
  sectionsVar: "--ui-sections-width",
};

/** Mission page layout (Mission.tsx `.mission-body`). */
export const MISSION_PANE_CONFIG: PaneConfig = {
  bodyId: "missionBody",
  centerId: "missionWorkbench",
  leftHandleId: "missionLedgerResizer",
  rightHandleId: "missionChannelsResizer",
  sidebarVar: "--ui-mission-ledger-width",
  sectionsVar: "--ui-mission-channels-width",
};

export interface PaneState {
  sidebarWidth: number | null;
  sectionsWidth: number | null;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
}

export interface PaneCallbacks {
  /** Read the current pane state. */
  getState: () => PaneState;
  /**
 * Called whenever the user finishes a drag or widths are applied
 * programmatically. Persist the new widths here (e.g. save to store /
 * the active host settings source).
 */
  onWidthsChanged: (
    sidebarWidth: number | null,
    sectionsWidth: number | null,
  ) => void | Promise<void>;
}

// ── Module-level drag state ──

interface PaneDrag {
  side: "left" | "right";
  config: PaneConfig;
}

let paneDrag: PaneDrag | null = null;

// ── Helpers ──

/** Clamp a number to [min, max]. */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Return the rendered width of a pane resize handle element.
 * Falls back to the --ui-resizer-width CSS custom property.
 */
export function paneHandleWidth(node: Element | null | undefined): number {
  if (!node) return 0;
  const style = getComputedStyle(node as HTMLElement);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  const width = node.getBoundingClientRect().width;
  if (width > 0) return width;
  return (
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--ui-resizer-width",
      ),
    ) || 0
  );
}

function paneBodyWidth(config: PaneConfig): number {
  return (
    (document.getElementById(config.bodyId) as HTMLElement | null)?.clientWidth ??
    window.visualViewport?.width ??
    window.innerWidth ??
    900
  );
}

/**
 * Compute the default rail width based on the current panel width.
 */
export function defaultRailWidth(config: PaneConfig): number {
  const scale = currentUIScale();
  const panelWidth = paneBodyWidth(config);
  return clampNumber(panelWidth * 0.22, 220 * scale, 380 * scale);
}

/**
 * Read the --ui-scale CSS custom property (
 */
export function currentUIScale(): number {
  if (typeof document === "undefined") return 1;
  return (
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"),
    ) || 1
  );
}

function paneWidthStyleScope(): HTMLElement {
  return document.body || document.documentElement;
}

function setPaneWidthProperty(name: string, value: number): void {
  paneWidthStyleScope().style.setProperty(name, `${value}px`);
}

function readPaneWidthProperty(name: string): number {
  return Number.parseFloat(
    getComputedStyle(paneWidthStyleScope()).getPropertyValue(name),
  );
}

/**
 * Compute the final sidebar and sections widths after overflow clamping.
 */
export function resolvedPaneWidths(
  state: PaneState,
  config: PaneConfig,
): {
  sidebar: number;
  sections: number;
} {
  const scale = currentUIScale();
  const panelWidth = paneBodyWidth(config);
  const railMin = 120 * scale;
  const chatPreferred = 500 * scale;
  const chatMin = 300 * scale;

  const leftHandle = paneHandleWidth(document.getElementById(config.leftHandleId));
  const rightHandle = paneHandleWidth(document.getElementById(config.rightHandleId));

  const total = panelWidth - leftHandle - rightHandle;
  const railMax = Math.max(railMin, total - chatMin - railMin);
  let sidebar = clampNumber(
    state.sidebarWidth ?? defaultRailWidth(config),
    railMin,
    railMax,
  );
  let sections = clampNumber(
    state.sectionsWidth ?? defaultRailWidth(config),
    railMin,
    railMax,
  );
  let actualSidebar = sidebar;
  let actualSections = sections;
  const sidebarFloor = railMin;
  const sectionsFloor = railMin;

 // First overflow pass — prefer-chat reduction
  if (actualSidebar + actualSections + chatPreferred > total) {
    let overflow = actualSidebar + actualSections + chatPreferred - total;
    const sidebarCap = Math.max(0, actualSidebar - sidebarFloor);
    const sectionsCap = Math.max(0, actualSections - sectionsFloor);
    const totalCap = sidebarCap + sectionsCap;
    if (totalCap > 0) {
      const sidebarShrink = Math.min(
        sidebarCap,
        overflow * (sidebarCap / totalCap),
      );
      actualSidebar -= sidebarShrink;
      overflow -= sidebarShrink;
      const sectionsShrink = Math.min(sectionsCap, overflow);
      actualSections -= sectionsShrink;
      overflow -= sectionsShrink;
      if (overflow > 0) {
        const extraSidebar = Math.min(Math.max(0, actualSidebar - railMin), overflow);
        actualSidebar -= extraSidebar;
      }
    }
  }

 // Second overflow pass — hard chatMin reduction
  if (actualSidebar + actualSections + chatMin > total) {
    const overflow = actualSidebar + actualSections + chatMin - total;
    const sectionsShrink = Math.min(
      Math.max(0, actualSections - sectionsFloor),
      overflow,
    );
    actualSections -= sectionsShrink;
    const remaining = overflow - sectionsShrink;
    if (remaining > 0) {
      actualSidebar -= Math.min(
        Math.max(0, actualSidebar - railMin),
        remaining,
      );
    }
  }

  sidebar = clampNumber(actualSidebar, sidebarFloor, railMax);
  sections = clampNumber(actualSections, sectionsFloor, railMax);
  return { sidebar: Math.round(sidebar), sections: Math.round(sections) };
}

/**
 * Apply the resolved pane widths as CSS custom properties on
 * the pane-width style scope (document.body).
 */
export function renderPaneLayout(state: PaneState, config: PaneConfig): void {
  if (typeof document === "undefined") return;
  const widths = resolvedPaneWidths(state, config);
  setPaneWidthProperty(config.sidebarVar, widths.sidebar);
  setPaneWidthProperty(config.sectionsVar, widths.sections);
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
  const state = callbacks.getState();
  const next: PaneState = {
    ...state,
    sidebarWidth: sidebarWidth ?? state.sidebarWidth,
    sectionsWidth: sectionsWidth ?? state.sectionsWidth,
  };
  renderPaneLayout(next, config);
  void callbacks.onWidthsChanged(next.sidebarWidth, next.sectionsWidth);
}

// ── Drag logic ──

/**
 * Compute new sidebarWidth or sectionsWidth from a pointer X position.
 * Mutates the PaneState values returned by callbacks.getState() by calling
 * renderPaneLayout with a derived state — state is NOT mutated; the caller is
 * responsible for updating their store in onWidthsChanged.
 */
function resizePane(
  side: "left" | "right",
  clientX: number,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  const scale = currentUIScale();
  const railMin = 120 * scale;
  const chatMin = 300 * scale;
  const state = callbacks.getState();

  if (side === "left") {
    const panelBody = document.getElementById(config.bodyId);
    const rect = panelBody?.getBoundingClientRect();
    if (!rect) return;
    const { sections } = resolvedPaneWidths(state, config);
    const leftHandle = paneHandleWidth(
      document.getElementById(config.leftHandleId),
    );
    const rightHandle = paneHandleWidth(
      document.getElementById(config.rightHandleId),
    );
    const max = Math.max(
      railMin,
      rect.width - sections - leftHandle - rightHandle - chatMin,
    );
    const newSidebarWidth = Math.round(
      clampNumber(clientX - rect.left, railMin, max),
    );
    renderPaneLayout({ ...state, sidebarWidth: newSidebarWidth }, config);
    return;
  }

 // side === "right"
  const workspaceMain = document.getElementById(config.centerId);
  const rect = workspaceMain?.getBoundingClientRect();
  if (!rect) return;
  const rightHandle = paneHandleWidth(
    document.getElementById(config.rightHandleId),
  );
  const max = Math.max(railMin, rect.width - rightHandle - chatMin);
  const newSectionsWidth = Math.round(
    clampNumber(rect.right - clientX, railMin, max),
  );
  renderPaneLayout({ ...state, sectionsWidth: newSectionsWidth }, config);
}

function onPaneResizeMove(
  event: PointerEvent,
  callbacks: PaneCallbacks,
): void {
  if (!paneDrag) return;
  resizePane(paneDrag.side, event.clientX, callbacks, paneDrag.config);
}

async function stopPaneResize(callbacks: PaneCallbacks): Promise<void> {
  if (!paneDrag) return;
  const config = paneDrag.config;
  const handleId =
    paneDrag.side === "left" ? config.leftHandleId : config.rightHandleId;
  const handle = document.getElementById(handleId);
  if (handle) delete (handle as HTMLElement).dataset.active;
  paneDrag = null;
  delete document.body.dataset.resizing;

 // Compute the final persisted values from the current CSS
  const sidebarPx = readPaneWidthProperty(config.sidebarVar);
  const sectionsPx = readPaneWidthProperty(config.sectionsVar);

  await callbacks.onWidthsChanged(
    Number.isFinite(sidebarPx) ? Math.round(sidebarPx) : null,
    Number.isFinite(sectionsPx) ? Math.round(sectionsPx) : null,
  );
}

function startPaneResize(
  side: "left" | "right",
  event: PointerEvent,
  callbacks: PaneCallbacks,
  config: PaneConfig,
): void {
  if (event.button != null && event.button !== 0) return;
  const state = callbacks.getState();
  if (
    side === "left" &&
    (state.sidebarCollapsed ||
      paneHandleWidth(document.getElementById(config.leftHandleId)) === 0)
  ) {
    return;
  }
  if (
    side === "right" &&
    (state.rightPanelCollapsed ||
      paneHandleWidth(document.getElementById(config.rightHandleId)) === 0)
  ) {
    return;
  }
  paneDrag = { side, config };
  const handleId = side === "left" ? config.leftHandleId : config.rightHandleId;
  const handle = document.getElementById(handleId);
  if (handle) (handle as HTMLElement).dataset.active = "true";
  document.body.dataset.resizing = "true";

 // Capture listeners with callbacks in closure
  function onMove(ev: PointerEvent) {
    onPaneResizeMove(ev, callbacks);
  }
  async function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    await stopPaneResize(callbacks);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  resizePane(side, event.clientX, callbacks, config);
  event.preventDefault();
}

// ── Public API ──

/**
 * Attach pointerdown listeners to the config's left/right resize handles.
 * Call once from onMount (or equivalent) after the DOM has been rendered.
 * Returns a cleanup function that removes the listeners.
 */
export function initPaneResizers(
  callbacks: PaneCallbacks,
  config: PaneConfig,
): () => void {
  const leftHandle = document.getElementById(config.leftHandleId);
  const rightHandle = document.getElementById(config.rightHandleId);

  function onLeftDown(ev: Event) {
    startPaneResize("left", ev as PointerEvent, callbacks, config);
  }
  function onRightDown(ev: Event) {
    startPaneResize("right", ev as PointerEvent, callbacks, config);
  }

  leftHandle?.addEventListener("pointerdown", onLeftDown);
  rightHandle?.addEventListener("pointerdown", onRightDown);

 // Render layout immediately so the initial widths are applied
  renderPaneLayout(callbacks.getState(), config);

  return () => {
    leftHandle?.removeEventListener("pointerdown", onLeftDown);
    rightHandle?.removeEventListener("pointerdown", onRightDown);
  };
}

/**
 * Stop any in-progress pane resize.
 * Call on window blur (
 */
export async function cancelPaneResize(
  callbacks: PaneCallbacks,
): Promise<void> {
  if (!paneDrag) return;
  await stopPaneResize(callbacks);
}
