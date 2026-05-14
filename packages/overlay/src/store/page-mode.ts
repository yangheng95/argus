// ── Page Mode Store ──
//
// Single source of truth for the top-level Overlay page mode. Two values
// today: "panel" (default conversation/inspector layout) and "gateway"
// (the operator control room that manages tasks and channel ingress).
//
// Changing modes does NOT clear or rewrite shared task state — boardStore
// continues to hold the selected task, the panel mounts stay alive but
// hidden, and returning to Panel restores the user's previous view
// without a reload (PRD §6.3).
//
// Why a dedicated store instead of a signal living inside main.tsx:
// Gateway (and any future page) needs to dispatch the toggle from its
// own subtree, and tests need a stable import path for assertions about
// the active mode.

import { createSignal } from "solid-js"

export type PageMode = "panel" | "gateway"

const [pageMode, setPageModeRaw] = createSignal<PageMode>("panel")

export { pageMode }

export function setPageMode(next: PageMode): void {
  if (next !== "panel" && next !== "gateway") {
    throw new Error(`setPageMode: unsupported page mode ${JSON.stringify(next)}`)
  }
  setPageModeRaw(next)
}

export function isGatewayPage(): boolean {
  return pageMode() === "gateway"
}
