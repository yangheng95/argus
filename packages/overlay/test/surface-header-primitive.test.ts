import { expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const SURFACE_HEADER_SOURCE = join(import.meta.dir, "../src/components/ui/SurfaceHeader.tsx")
const HEADER_CSS = join(import.meta.dir, "../src/styles/surfaces/header.css")
// styles.css was dissolved 2026-05-04 into cascade + surface files. Tests
// that previously asserted "this class does NOT appear in styles.css" now
// assert it does NOT appear in the cascade layer (where cross-cutting rules
// live), while surface-specific chrome legitimately lives in surface files.
const CASCADE_DIR = join(import.meta.dir, "../src/styles/cascade")

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

// Combined CSS across all surface + cascade + primitive files.
const ALL_SURFACE_CSS = walkCss(join(import.meta.dir, "../src/styles"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")

// Cascade-only CSS — where cross-cutting layout/chrome rules should NOT appear.
const CASCADE_CSS = walkCss(CASCADE_DIR)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")

function blocksForSelectors(css: string, classNames: string[]): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const match of css.matchAll(re)) {
    const selector = match[1] ?? ""
    const body = match[2] ?? ""
    if (classNames.some((className) => new RegExp(`\\.${className}(?![-\\w])`).test(selector))) {
      blocks.push({ selector, body })
    }
  }
  return blocks
}

function exactBlockBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`(^|\\n)${escaped}\\s*\\{([^{}]*)\\}`).exec(css)
  if (!match) throw new Error(`Missing CSS block for ${selector}`)
  return match[2] ?? ""
}

test("SurfaceHeader owns the canonical header structure", () => {
  const source = readFileSync(SURFACE_HEADER_SOURCE, "utf8")

  expect(source).toContain('export const SURFACE_HEADER_VARIANTS = ["panel", "settings-group"] as const')
  expect(source).toContain('Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "classList" | "title">')
  expect(source).toContain('class="oc-surface-header"')
  expect(source).toContain("data-surface={local.variant}")
  expect(source).toContain('class="oc-surface-header__title"')
  expect(source).toContain('class="oc-surface-header__actions"')
  expect(source).not.toMatch(
    /\b(?:ext-group-head|config-panel-group-title|sidebar-header|chat-header|sections-header)\b/,
  )
})

test("SurfaceHeader variants have surface CSS hooks", () => {
  const css = readFileSync(HEADER_CSS, "utf8")

  expect(css).toContain('.oc-surface-header[data-surface="settings-group"]')
  expect(css).toContain("var(--oc-header-title-line-height)")
})

test("sidebar header variant inherits the rail surface token", () => {
  const css = readFileSync(HEADER_CSS, "utf8")

  expect(css).toMatch(/\.sidebar-header\.oc-surface-header\s*\{[^}]*background:\s*var\(--rail-surface\)/)
})

test("cascade layer does not own base surface header chrome (it lives in header.css)", () => {
  // sidebar-header / chat-header / sections-header are now defined in
  // surfaces/header.css — they must not appear as standalone top-level rules
  // in the cascade layer (base/typography/dark/light/vscode-dark).
  expect(CASCADE_CSS).not.toMatch(/(^|\n)\.(?:sidebar-header|chat-header|sections-header)\s*\{/)
})

test("surface header actions own action spacing outside theme resets", () => {
  // Neither a direct solo rule nor a theme-scoped rule should set gap on
  // sidebar-header-actions / chat-header-meta inside the cascade layer.
  expect(CASCADE_CSS).not.toMatch(/(^|\n)\.(?:sidebar-header-actions|chat-header-meta)\s*\{[^}]*\bgap\s*:/)
  expect(CASCADE_CSS).not.toMatch(/body[^{]*\.sidebar-header-actions(?![-\w])[^{}]*\{[^}]*\bgap\s*:/)
})

test("surface header main and action slots own flex layout primitives", () => {
  const primitiveLayout = /\b(?:display|align-items|min-width|gap)\s*:/

  expect(exactBlockBody(ALL_SURFACE_CSS, ".chat-header-main")).not.toMatch(primitiveLayout)
  expect(exactBlockBody(ALL_SURFACE_CSS, ".chat-header-meta")).not.toMatch(primitiveLayout)
  expect(exactBlockBody(ALL_SURFACE_CSS, ".sidebar-header-actions")).not.toMatch(primitiveLayout)
})

test("retired panel collapse header mounts stay out of active CSS", () => {
  const headerCss = readFileSync(HEADER_CSS, "utf8")

  expect(ALL_SURFACE_CSS).not.toContain("panel-header-collapse-mount")
  expect(headerCss).not.toContain("sections-header-actions")
})

test("surface header titles own title typography outside theme resets", () => {
  const titleBlocks = blocksForSelectors(ALL_SURFACE_CSS, ["sidebar-title", "chat-title", "sections-title"])
  const typography = /\b(?:font(?:-size|-weight)?|line-height|color|letter-spacing|text-transform)\s*:/

  for (const block of titleBlocks) {
    expect(block.body).not.toMatch(typography)
  }
})

test("workflow tab header uses the shared surface header instead of local toolbar chrome", () => {
  // Cascade layer must not define agent-workflow toolbar/heading/title chrome.
  expect(CASCADE_CSS).not.toMatch(/agent-workflow-(?:toolbar|heading|title)/)
  expect(CASCADE_CSS).not.toMatch(/body[^{]*agent-workflow-(?:toolbar|heading|title|count)[^{}]*\{/)
})
