import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const PANEL_SOURCE = join(import.meta.dir, "../src/components/BrowserPreviewPanel.tsx")
const INSPECTOR_CSS = join(import.meta.dir, "../src/styles/surfaces/inspector.css")

test("BrowserPreviewPanel uses native guest webview as the live DOM selection surface", () => {
  const source = readFileSync(PANEL_SOURCE, "utf8")

  expect(source).toContain("const nativePreviewScope = createMemo<BrowserPreviewNativeScope | undefined>")
  expect(source).toContain("if (!browserPreviewNativeSurfaceAvailable()) return undefined")
  expect(source).toContain("if ((latestEvidenceScope() || renderedEvidence()) && !nodeSelectionEnabled() && !nodeSelection())")
  expect(source).toContain('data-ui="browser-preview-native-surface"')
  expect(source).toContain('data-ui="browser-preview-address-input"')
  expect(source).toContain("saveTaskBrowserPreviewTarget")
  expect(source).not.toContain("const webPreviewScope")
  expect(source).not.toContain('data-ui="browser-preview-web-frame"')
  expect(source).not.toContain("browser-preview/live")
})

test("BrowserPreviewPanel exposes native guest DOM node selection controls", () => {
  const source = readFileSync(PANEL_SOURCE, "utf8")
  const css = readFileSync(INSPECTOR_CSS, "utf8")

  expect(source).toContain('class="browser-preview-comment-mode-button"')
  expect(source).toContain("setNativeSelectionEnabled(true)")
  expect(source).toContain("takeNativeSelection()")
  expect(source).toContain("BrowserPreviewNodeSelectionLayer")
  expect(source).toContain("BrowserPreviewNodeCommentPopover")
  expect(source).toContain("onCommentDraft")
  expect(source).not.toContain("captureNodeSelection")
  expect(source).not.toContain("browserPreviewElementSelectionFromFrame")
  expect(css).not.toContain(".browser-preview-selection-capture")
  expect(css).not.toContain(".browser-preview-web-frame")
  expect(css).toContain(".browser-preview-node-selection-box")
  expect(css).toContain(".browser-preview-node-comment-popover")
})

test("BrowserPreviewPanel keeps native preview mounted while node comments are pending", () => {
  const source = readFileSync(PANEL_SOURCE, "utf8")

  // The selection button must be usable whenever a target is ready — not gated
  // on a scope that disappears while evidence/screenshot is shown.
  expect(source).toContain("disabled={!readyTarget()}")

  // Rendered evidence must not preempt the live selection surface once the user
  // enters node selection mode or a selected node comment popover is pending.
  expect(source).toContain("<Match when={!nodeSelectionEnabled() && !nodeSelection() ? renderedEvidence() : undefined}>")
  expect(source).toContain("if ((latestEvidenceScope() || renderedEvidence()) && !nodeSelectionEnabled() && !nodeSelection())")

  // Captured native selections should open the comment popover without hiding
  // the native child webview and falling back to an iframe surface.
  expect(source).toContain('if (result.kind === "captured")')
  expect(source).toContain("setNodeSelection(result.selection)")
  expect(source).not.toContain("requestNativePreviewClose(false)\n            return")
})

test("BrowserPreviewPanel renders single-row browser chrome", () => {
  const source = readFileSync(PANEL_SOURCE, "utf8")
  const css = readFileSync(INSPECTOR_CSS, "utf8")

  expect(source).toContain('class="browser-preview-chrome-grid"')
  expect(source).toContain('class="browser-preview-address-form"')
  expect(source).toContain('name="refresh"')
  expect(source).toContain('class="browser-preview-comment-mode-button"')
  expect(source).not.toContain('name="nav-back"')
  expect(source).not.toContain('name="nav-forward"')
  expect(source).not.toContain('name="copy"')
  expect(source).not.toContain('name="external-link"')
  expect(source).not.toContain('class="browser-preview-proxy-chip"')
  expect(source).not.toContain('class="browser-preview-browser-controls"')
  expect(source).not.toContain('data-row="tools"')
  expect(css).toContain(".browser-preview-chrome-grid")
  expect(css).toContain(".browser-preview-chrome-actions")
  expect(css).not.toContain(".browser-preview-toolbar-row")
})
