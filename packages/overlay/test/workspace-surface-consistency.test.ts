import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const WORKSPACE_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "workspace.css"), "utf8")
const ACTIVITY_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "activity.css"), "utf8")

function bodyOf(selector: string): string {
  const css = WORKSPACE_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).trim() === selector) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

function retiredSelector(className: string): RegExp {
  return new RegExp(`(^|[\\n,{])\\s*\\.${className}(?:\\s|[,>{:+~.#\\[]|$)`, "m")
}

test("retired workspace panel shell stays removed from workspace.css", () => {
  for (const className of [
    "workspace-mount",
    "workspace",
    "workspace-header",
    "workspace-tabs",
    "workspace-tab",
    "workspace-tab-label",
    "workspace-tab-file",
    "workspace-close",
    "workspace-body",
    "workspace-view",
  ]) {
    expect(WORKSPACE_CSS).not.toMatch(retiredSelector(className))
  }
  expect(bodyOf(".diff-preview-panel > \.oc-panel__header")).toMatch(/background:\s*var\(--surface-strong\)/)

  const emptyBody = bodyOf(".diff-preview-empty")
  expect(emptyBody).toContain("linear-gradient(180deg, var(--ui-highlight-tone), transparent 72%)")
  expect(emptyBody).toContain("color-mix(in srgb, var(--surface-inset) 92%, transparent)")
  expect(WORKSPACE_CSS).not.toContain("file-view")
})

test("file changes diff close button uses the Button primitive surface", () => {
  expect(ACTIVITY_CSS).toContain('.file-changes-diff-header .oc-button[data-ui="file-changes-diff-close"]')
  expect(ACTIVITY_CSS).toContain("color-mix(in srgb, var(--bad) 12%, transparent)")
  expect(WORKSPACE_CSS).not.toContain("file-changes-diff-close")
})

test("center workbench scrolls open panels instead of crushing them", () => {
  const baseBody = bodyOf(".center-workbench-body")
  expect(baseBody).toContain("overflow-x: auto;")
  expect(baseBody).toContain("overflow-y: hidden;")
  expect(baseBody).toContain("overscroll-behavior-x: contain;")

  const openView = bodyOf('.center-workbench-view[data-open="true"]')
  expect(openView).toContain("min-width: var(--ui-workbench-panel-min-width);")

  expect(WORKSPACE_CSS).not.toMatch(/@container\s+overlay-shell\s+\(width\s*</)
  expect(WORKSPACE_CSS).not.toContain("@media (width < 1120px)")
  expect(WORKSPACE_CSS).toContain('.center-workbench-view[data-open="true"]')
  expect(WORKSPACE_CSS).not.toContain("max(var(--ui-workbench-panel-min-width), calc(50cqw))")
  expect(WORKSPACE_CSS).not.toContain("calc(50vw)")
})
