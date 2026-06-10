import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const WORKSPACE_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "workspace.css"), "utf8")

function bodyOf(selector: string): string {
  const css = WORKSPACE_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).trim() === selector) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

test("workspace panels share a neutral surface family", () => {
  expect(bodyOf(".workspace-mount")).toMatch(/background:\s*var\(--surface-inset\)/)
  expect(bodyOf(".workspace-header")).toMatch(/background:\s*var\(--surface-strong\)/)
  expect(bodyOf(".diff-preview-panel > \.oc-panel__header")).toMatch(/background:\s*var\(--surface-strong\)/)

  const emptyBody = bodyOf(".diff-preview-empty")
  expect(emptyBody).toContain("linear-gradient(180deg, var(--ui-highlight-tone), transparent 72%)")
  expect(emptyBody).toContain("color-mix(in srgb, var(--surface-inset) 92%, transparent)")
  expect(WORKSPACE_CSS).not.toContain("file-view")
})

test("compact center workbench scrolls open panels instead of crushing them", () => {
  expect(WORKSPACE_CSS).toContain("@media (max-width: 1120px)")
  expect(WORKSPACE_CSS).toContain(".center-workbench-body {\n    overflow-x: auto;")
  expect(WORKSPACE_CSS).toContain("overscroll-behavior-x: contain;")
  expect(WORKSPACE_CSS).toContain('.center-workbench-view[data-open="true"]')
  expect(WORKSPACE_CSS).toContain("max(calc(280px * var(--ui-scale)), calc(50vw))")
})
