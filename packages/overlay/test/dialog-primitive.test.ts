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
    expect(source).toContain('class={["dialog"')
    expect(source).toContain('"dialog-wide"')
    expect(source).toContain('"dialog-wider"')
    expect(source).toContain('class={["dialog-form"')
    expect(source).toContain('class={["dialog-header"')
    expect(source).toContain('class="dialog-title"')
    expect(source).toContain('class="dialog-header-actions"')
    expect(source).toContain('class="dialog-actions"')
  })

  test("title, headerActions, footer and titleAs are part of the contract", () => {
    expect(source).toContain("title: JSX.Element")
    expect(source).toContain("headerActions?: JSX.Element")
    expect(source).toContain("footer?: JSX.Element")
    expect(source).toContain('titleAs?: "div" | "h1" | "h2" | "span"')
    expect(source).toContain("backdropClose?: boolean")
    expect(source).toContain("modal?: boolean")
    expect(source).toContain("modal: true")
    expect(source).toContain("modal={local.modal}")
    expect(source).toContain('data-dialog-modal={local.modal ? "true" : "false"}')
    expect(source).toContain('local.modal ? undefined : { "pointer-events": "none" }')
    expect(source).toContain("style={dialogContentStyle()}")
    expect(source).toContain("style={dialogOverlayStyle()}")
  })

  test("supports built-in backdrop close handling", () => {
    expect(source).toContain("onInteractOutside={handleInteractOutside}")
    expect(source).toContain("local.backdropClose === false")
    expect(source).toContain("event.preventDefault()")
    expect(source).not.toContain("event.target === event.currentTarget")
  })

  test("keeps modal focus and positioning inside the Kobalte dialog primitive", () => {
    const css = readText(DIALOG_CSS)

    expect(source).not.toContain("draggable?: boolean")
    expect(source).not.toContain("onPointerDown={")
    expect(source).not.toContain("PointerEvent")
    expect(source).not.toContain("addEventListener")
    expect(source).not.toContain("data-dialog-drag")
    expect(source).not.toContain("DIALOG_DRAG")
    expect(source).not.toContain("clampDialogOffset")
    expect(source).toContain("<KobalteDialogContent")
    expect(css).toContain(".dialog-overlay")
    expect(css).toMatch(/\.dialog-overlay\[data-dialog-modal="false"\]\s*{[\s\S]*?pointer-events:\s*none;/)
    expect(css).toMatch(/\.dialog\s*{[\s\S]*?pointer-events:\s*none;/)
    expect(css).toMatch(/\.dialog-form\s*{[\s\S]*?pointer-events:\s*auto;/)
    expect(css).toContain("transform: translate(-50%, -50%)")
    expect(css).not.toContain("--dialog-drag")
    expect(css).not.toContain("data-dialog-drag")
    expect(css).not.toContain("cursor: grab")
    expect(css).not.toContain("cursor: grabbing")
    expect(css).not.toContain("::backdrop")
  })
})

describe("Dialog primitive adoption", () => {
  test("components rendering Dialog import the primitive", () => {
    const users = componentSources().filter(({ text }) => /<Dialog\b/.test(text))
    expect(users.map(({ rel }) => rel).sort()).toEqual([
      "src/components/AppDialogHost.tsx",
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
