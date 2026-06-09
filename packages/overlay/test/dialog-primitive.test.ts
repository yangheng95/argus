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

describe("Dialog primitive", () => {
  const source = readText(DIALOG_SOURCE)

  test("exports Dialog and DialogProps", () => {
    expect(source).toContain("export interface DialogProps")
    expect(source).toContain("export function Dialog(")
  })

  test("controls the native dialog via showModal and close", () => {
    expect(source).toContain("dialog.showModal()")
    expect(source).toContain("dialog.close()")
    expect(source).toContain("if (local.open)")
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
  })

  test("supports built-in backdrop close handling", () => {
    expect(source).toContain("event.target === event.currentTarget")
    expect(source).toContain("dialogRef?.close()")
  })

  test("makes the header the single dialog drag handle", () => {
    const css = readText(DIALOG_CSS)

    expect(source).toContain("draggable?: boolean")
    expect(source).toContain("onPointerDown={startDialogDrag}")
    expect(source).toContain("data-dialog-drag-handle")
    expect(source).toContain("data-dialog-draggable")
    expect(source).toContain("DIALOG_DRAG_IGNORE_SELECTOR")
    expect(source).toContain("clampDialogOffset")
    expect(css).toContain("--dialog-drag-x")
    expect(css).toContain("--dialog-drag-y")
    expect(css).toContain('data-dialog-drag-handle="true"')
    expect(css).toContain('data-dialog-dragging="true"')
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
      expect(text).not.toContain("querySelectorAll(\"dialog.dialog\")")
      expect(text).not.toContain("dataset.backdropClose")
    }
  })
})
