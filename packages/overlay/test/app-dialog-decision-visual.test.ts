import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const overlayRoot = join(import.meta.dir, "..")

function readText(path: string): string {
  return readFileSync(join(overlayRoot, path), "utf8")
}

function block(css: string, selector: string): string {
  const index = css.indexOf(selector)
  if (index < 0) return ""
  const start = css.indexOf("{", index)
  const end = css.indexOf("\n}", start)
  return start >= 0 && end >= 0 ? css.slice(start + 1, end) : ""
}

describe("app dialog visual treatment", () => {
  test("ordinary app dialogs use the shared flat prompt shell", () => {
    const host = readText("src/components/AppDialogHost.tsx")
    const css = readText("src/styles/surfaces/dialog.css")

    expect(host).toContain('formClass="app-dialog-form"')
    expect(css).toContain(".app-dialog-form")
    expect(block(css, ".app-dialog-form")).toContain("max-width: min(calc(460px * var(--ui-scale))")
    expect(block(css, ".app-dialog-form > .dialog-header")).toContain("background: var(--surface)")
    expect(block(css, ".app-dialog-form > .app-dialog-body")).toContain("background: transparent")
    expect(block(css, ".app-dialog-form > .app-dialog-body")).toContain("box-shadow: none")
    expect(block(css, ".app-dialog-form > .dialog-actions:not(.compact)")).not.toContain("linear-gradient")
  })

  test("task queue decision chrome is removed from the host and styles", () => {
    const host = readText("src/components/AppDialogHost.tsx")
    const css = readText("src/styles/surfaces/dialog.css")
    const enUs = readText("src/i18n/en-US.json")
    const zhCn = readText("src/i18n/zh-CN.json")

    expect(host).not.toContain("task-queue-decision")
    expect(host).not.toContain("SegmentedControl")
    expect(host).not.toContain("recommendedValue")
    expect(host).not.toContain("countdownSeconds")
    expect(css).not.toContain(".app-dialog-form--decision")
    expect(css).not.toContain(".app-dialog-decision__choice")
    expect(css).not.toContain(".app-dialog-decision__timer")
    expect(enUs).not.toContain('"task.queue_decision.')
    expect(zhCn).not.toContain('"task.queue_decision.')
  })
})
