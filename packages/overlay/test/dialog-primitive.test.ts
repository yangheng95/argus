import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "../")
const DIALOG_SOURCE = join(OVERLAY_ROOT, "src/components/primitives/Dialog.tsx")
const DIALOG_CSS = join(OVERLAY_ROOT, "src/styles/surfaces/dialog.css")

function readText(path: string): string {
  return readFileSync(path, "utf8")
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
  const migrated = [
    "src/components/MemoryPanel.tsx",
    "src/components/LogViewer.tsx",
    "src/components/settings/ChannelsPanel.tsx",
  ]

  test("migrated components import the Dialog primitive", () => {
    for (const rel of migrated) {
      const text = readText(join(OVERLAY_ROOT, rel))
      expect(text).toContain("Dialog")
      expect(text).toMatch(/<Dialog\b/)
    }
  })

  test("migrated components no longer render raw dialog tags or showModal", () => {
    for (const rel of migrated) {
      const text = readText(join(OVERLAY_ROOT, rel))
      expect(text).not.toMatch(/<dialog\b/)
      expect(text).not.toContain("showModal()")
    }
  })
})
