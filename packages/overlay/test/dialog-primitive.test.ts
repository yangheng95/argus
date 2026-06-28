import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "../")
const DIALOG_SOURCE = join(OVERLAY_ROOT, "src/components/primitives/Dialog.tsx")
const DIALOG_CSS = join(OVERLAY_ROOT, "src/styles/surfaces/dialog.css")

function readText(path: string): string {
  return readFileSync(path, "utf8")
}

function componentSources(): Array<{ rel: string; text: string }> {
  const root = join(OVERLAY_ROOT, "src/components")
  const out: Array<{ rel: string; text: string }> = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        visit(full)
        continue
      }
      if (!full.endsWith(".tsx")) continue
      const rel = relative(OVERLAY_ROOT, full).replace(/\\/g, "/")
      if (rel === "src/components/primitives/Dialog.tsx") continue
      out.push({ rel, text: readText(full) })
    }
  }
  visit(root)
  return out
}

function sourceFiles(): Array<{ rel: string; text: string }> {
  const root = join(OVERLAY_ROOT, "src")
  const out: Array<{ rel: string; text: string }> = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        visit(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(full)) continue
      const rel = relative(OVERLAY_ROOT, full).replace(/\\/g, "/")
      out.push({ rel, text: readText(full) })
    }
  }
  visit(root)
  return out
}

describe("Dialog primitive", () => {
  const source = readText(DIALOG_SOURCE)

  test("exports Dialog and DialogProps", () => {
    expect(source).toContain("export interface DialogProps")
    expect(source).toContain("export function Dialog(")
  })

  test("delegates dialog semantics to Kobalte", () => {
    expect(source).toContain('@kobalte/core/dialog"')
    expect(source).toContain("KobalteDialogRoot")
    expect(source).toContain("KobalteDialogPortal")
    expect(source).toContain("KobalteDialogOverlay")
    expect(source).toContain("KobalteDialogContent")
    expect(source).toContain("KobalteDialogTitle")
    expect(source).toContain("open={local.open}")
    expect(source).toContain("onOpenChange={closeFromKobalte}")
    expect(source).not.toContain("<dialog")
    expect(source).not.toContain("showModal()")
    expect(source).not.toContain(".close()")
    expect(source).not.toContain("HTMLDialogElement")
  })

  test("renders canonical dialog shell classes", () => {
    expect(source).toContain("class={[")
    expect(source).toContain('"dialog"')
    expect(source).toContain('"dialog-wide"')
    expect(source).toContain('"dialog-wider"')
    expect(source).toContain('"dialog-fullscreen"')
    expect(source).toContain('"dialog-form"')
    expect(source).toContain('"dialog-header"')
    expect(source).toContain('class="dialog-title"')
    expect(source).toContain('class="dialog-header-actions"')
    expect(source).toContain('class="dialog-actions"')
  })

  test("title, headerActions, footer and titleAs are part of the contract", () => {
    expect(source).toContain("title: JSX.Element")
    expect(source).toContain("headerActions?: JSX.Element")
    expect(source).toContain("footer?: JSX.Element")
    expect(source).toContain('titleAs?: "div" | "h1" | "h2" | "span"')
    expect(source).toContain("fullscreen?: boolean")
    expect(source).toContain("backdropClose?: boolean")
    expect(source).toContain("modal?: boolean")
    expect(source).toContain("overlayClass?: string")
    expect(source).toContain("onOpenAutoFocus?: (event: Event) => void")
    expect(source).toContain("onCloseAutoFocus?: (event: Event) => void")
    expect(source).toContain("modal: true")
    expect(source).toContain("modal={local.modal}")
    expect(source).toContain('aria-modal={local.modal ? "true" : undefined}')
    expect(source).toContain('data-dialog-modal={local.modal ? "true" : "false"}')
    expect(source).toContain('class={["dialog-overlay", local.overlayClass].filter(Boolean).join(" ")}')
    expect(source).toContain("nonModalPointerPassthrough")
    expect(source).toContain('nonModalPointerPassthrough() ? { "pointer-events": "none" } : undefined')
    expect(source).toContain("style={dialogContentStyle()}")
    expect(source).toContain("style={dialogOverlayStyle()}")
    expect(source).toContain('local.fullscreen ? "dialog-fullscreen" : ""')
  })

  test("supports built-in backdrop close handling", () => {
    expect(source).toContain("onInteractOutside={handleInteractOutside}")
    expect(source).toContain("local.backdropClose === false")
    expect(source).toContain("event.preventDefault()")
    expect(source).not.toContain("event.target === event.currentTarget")
  })

  test("keeps Kobalte dialog semantics while preserving header drag offset", () => {
    const css = readText(DIALOG_CSS)

    expect(source).toContain("draggable?: boolean")
    expect(source).toContain("onPointerDown={startDialogDrag}")
    expect(source).toContain("PointerEvent")
    expect(source).toContain("clampDialogOffset")
    expect(source).toContain("let pendingDialogDrag:")
    expect(source).toContain("requestAnimationFrame(applyPendingDialogDrag)")
    expect(source).toContain("flushPendingDialogDrag()")
    expect(source).toContain("schedulePendingDialogDrag()")
    expect(source).toContain('window.addEventListener("pointermove", moveDialog)')
    expect(source).not.toContain("setDialogOffset(\n        clampDialogOffset(form")
    expect(source).not.toContain("clampDialogOffset(form, origin.x + moveEvent.clientX")
    expect(source).toContain("data-dialog-drag-handle")
    expect(source).toContain("DIALOG_DRAG_IGNORE_SELECTOR")
    expect(source).toContain("<KobalteDialogContent")
    expect(css).toContain(".dialog-overlay")
    expect(css).toMatch(/\.dialog\s*{[\s\S]*?z-index:\s*var\(--ui-z-dialog\);/)
    expect(css).toMatch(/\.dialog-overlay\s*{[\s\S]*?z-index:\s*var\(--ui-z-overlay\);/)
    expect(css).toMatch(/\.dialog-overlay\[data-dialog-modal="false"\]\s*{[\s\S]*?pointer-events:\s*none;/)
    expect(css).toMatch(/\.dialog\s*{[\s\S]*?pointer-events:\s*none;/)
    expect(css).toMatch(/\.dialog-form\s*{[\s\S]*?pointer-events:\s*auto;/)
    expect(css).toContain("transform: translate(calc(-50% + var(--dialog-drag-x)), calc(-50% + var(--dialog-drag-y)))")
    expect(css).toContain("--dialog-drag-x")
    expect(css).toContain("data-dialog-drag")
    expect(css).toContain("cursor: grab")
    expect(css).toContain("cursor: grabbing")
    expect(css).not.toContain("::backdrop")
  })
})

describe("Dialog primitive adoption", () => {
  test("components rendering Dialog import the primitive", () => {
    const users = componentSources().filter(({ text }) => /<Dialog\b/.test(text))
    expect(users.map(({ rel }) => rel).sort()).toEqual([
      "src/components/AppDialogHost.tsx",
      "src/components/CommandPalette.tsx",
      "src/components/ConfigDialogHost.tsx",
      "src/components/GoalDialogHost.tsx",
      "src/components/ImagePreview.tsx",
      "src/components/InteractionDialogHost.tsx",
      "src/components/LogViewer.tsx",
      "src/components/SessionDialogHost.tsx",
      "src/components/WorkspaceOnboardingDialog.tsx",
      "src/components/settings/ChannelsPanel.tsx",
    ])
    for (const { text } of users) {
      expect(text).toContain("primitives/Dialog")
    }
  })

  test("feature components do not import Kobalte dialog directly", () => {
    for (const { rel, text } of componentSources()) {
      expect(text, rel).not.toContain('@kobalte/core/dialog"')
    }
  })

  test("feature components no longer render raw dialog tags or showModal", () => {
    for (const { rel, text } of componentSources()) {
      expect(text).not.toMatch(/<dialog\b/)
      expect(text).not.toContain("showModal()")
      expect(text).not.toContain('querySelectorAll("dialog.dialog")')
      expect(text).not.toContain('querySelector("dialog[open]")')
      expect(text).not.toContain("dataset.backdropClose")
    }
  })

  test("overlay source no longer documents retired native dialog wiring", () => {
    for (const { rel, text } of sourceFiles()) {
      expect(text, rel).not.toMatch(/<dialog\b/)
      expect(text, rel).not.toContain("showModal")
      expect(text, rel).not.toContain("renderSkillMarket")
    }
  })
})
