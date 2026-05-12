import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const TITLEBAR_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "titlebar.css"), "utf8")
const SIDEBAR_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "sidebar.css"), "utf8")
const INSPECTOR_CSS = readFileSync(join(OVERLAY_ROOT, "src", "styles", "surfaces", "inspector.css"), "utf8")

function bodyOf(source: string, selector: string): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const wanted = selector.replace(/\s+/g, " ").trim()
  for (const chunk of css.split("}")) {
    const open = chunk.indexOf("{")
    if (open < 0) continue
    if (chunk.slice(0, open).replace(/\s+/g, " ").trim() === wanted) return chunk.slice(open + 1)
  }
  throw new Error(`CSS rule not found: ${selector}`)
}

test("titlebar controls stay on the surface family", () => {
  expect(bodyOf(TITLEBAR_CSS, ".titlebar-theme-option:hover")).toMatch(/background:\s*var\(--surface-hover\)/)
  expect(bodyOf(TITLEBAR_CSS, ".titlebar-menubar-trigger:hover, .titlebar-menubar-trigger:focus-visible, .titlebar-menubar-trigger[data-active=\"true\"]")).toMatch(/background:\s*var\(--surface-hover\)/)
  expect(bodyOf(TITLEBAR_CSS, ".titlebar-menubar-note")).toMatch(/background:\s*var\(--surface-inset\)/)
  expect(bodyOf(TITLEBAR_CSS, ".titlebar-status-chip, .titlebar-setup-cta, .titlebar-status-icon")).toContain("color-mix(in srgb, var(--surface-strong) 86%, transparent)")
  expect(bodyOf(TITLEBAR_CSS, ".titlebar-status-chip:hover, .titlebar-setup-cta:hover, .titlebar-status-icon:hover")).toMatch(/background:\s*var\(--surface-hover\)/)
})

test("sidebar search stays on the rail surface family", () => {
  expect(bodyOf(SIDEBAR_CSS, ".task-list-search")).toMatch(/background:\s*var\(--surface-inset\)/)
  expect(bodyOf(SIDEBAR_CSS, ".task-list-search:focus-within")).toMatch(/background:\s*var\(--surface-hover\)/)
  expect(bodyOf(SIDEBAR_CSS, ".task-list-search .oc-button[data-ui=\"task-list-search-clear\"]:hover, .task-list-search .oc-button[data-ui=\"task-list-search-clear\"]:focus-visible")).toContain("--oc-button-bg: var(--surface-hover)")
})

test("inspector list rows keep a neutral inset base", () => {
  expect(bodyOf(INSPECTOR_CSS, ".goal-item, .knowledge-item, .pref-item, .criteria-check")).toMatch(/background:\s*var\(--surface-inset\)/)
})
