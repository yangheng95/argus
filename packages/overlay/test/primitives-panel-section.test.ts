// ── primitives-panel-section.test.ts ──
// Static-analysis guards for the Panel and Section primitive layer.
// Rendering tests are not possible in the Bun/node env (no DOM), so we
// verify:
//   1. CSS contract: expected class names are defined
//   2. JSX contract: correct named exports, expected props in source
//   3. Load-order: both CSS files are registered in index.html after
//      primitives/tabs.css and before any surface file

import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const OVERLAY_ROOT = join(import.meta.dir, "../")

function readText(path: string): string {
  return readFileSync(path, "utf8")
}

// ── panel.css ────────────────────────────────────────────────────────

describe("panel.css primitive", () => {
  const css = readText(join(OVERLAY_ROOT, "src/styles/primitives/panel.css"))

  test("defines .oc-panel root class", () => {
    expect(css).toMatch(/\.oc-panel\s*\{/)
  })

  test("defines .oc-panel__header child class", () => {
    expect(css).toMatch(/\.oc-panel__header\s*\{/)
  })

  test("defines .oc-panel__body child class", () => {
    expect(css).toMatch(/\.oc-panel__body\s*\{/)
  })

  test("defines .oc-panel__footer child class", () => {
    expect(css).toMatch(/\.oc-panel__footer\s*\{/)
  })

  test("uses --oc-panel-* tokens for overrideable values", () => {
    expect(css).toMatch(/--oc-panel-header-height/)
    expect(css).toMatch(/--oc-panel-bg/)
  })

  test("panel body is flex:1 and min-height:0", () => {
    // Find the rule block (after the opening brace) to skip comment mentions
    const ruleStart = css.lastIndexOf(".oc-panel__body")
    const braceOpen = css.indexOf("{", ruleStart)
    const braceClose = css.indexOf("}", braceOpen)
    const bodyBlock = css.slice(braceOpen, braceClose)
    expect(bodyBlock).toMatch(/flex:\s*1/)
    expect(bodyBlock).toMatch(/min-height:\s*0/)
  })

  test("no raw hex color literals", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

// ── section.css ───────────────────────────────────────────────────────

describe("section.css primitive", () => {
  const css = readText(join(OVERLAY_ROOT, "src/styles/primitives/section.css"))

  test("defines .oc-section root class", () => {
    expect(css).toMatch(/\.oc-section\s*\{/)
  })

  test("defines .oc-section__head summary class", () => {
    expect(css).toMatch(/\.oc-section__head\s*\{/)
  })

  test("defines .oc-section__icon class", () => {
    expect(css).toMatch(/\.oc-section__icon\s*\{/)
  })

  test("defines .oc-section__title class", () => {
    expect(css).toMatch(/\.oc-section__title\s*\{/)
  })

  test("defines .oc-section__badge class", () => {
    expect(css).toMatch(/\.oc-section__badge\s*\{/)
  })

  test("icon color changes when section is open (accent)", () => {
    expect(css).toMatch(/\.oc-section\[open\]/)
    expect(css).toMatch(/var\(--accent\)/)
  })

  test("removes native details-marker from summary", () => {
    expect(css).toContain("list-style: none")
    expect(css).toContain("::-webkit-details-marker")
  })

  test("no raw hex color literals", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

// ── Panel.tsx ────────────────────────────────────────────────────────

describe("Panel JSX primitive", () => {
  const tsx = readText(join(OVERLAY_ROOT, "src/components/primitives/Panel.tsx"))

  test("exports Panel function", () => {
    expect(tsx).toContain("export function Panel(")
  })

  test("exports PanelProps interface", () => {
    expect(tsx).toContain("export interface PanelProps")
  })

  test("applies .oc-panel root class", () => {
    expect(tsx).toContain("oc-panel")
  })

  test("renders header in .oc-panel__header when provided", () => {
    expect(tsx).toContain("oc-panel__header")
  })

  test("renders body in .oc-panel__body", () => {
    expect(tsx).toContain("oc-panel__body")
  })

  test("renders footer in .oc-panel__footer when provided", () => {
    expect(tsx).toContain("oc-panel__footer")
  })

  test("supports `as` prop to override root tag", () => {
    expect(tsx).toContain("as?:")
    expect(tsx).toContain("Dynamic")
  })
})

// ── Section.tsx ───────────────────────────────────────────────────────

describe("Section JSX primitive", () => {
  const tsx = readText(join(OVERLAY_ROOT, "src/components/primitives/Section.tsx"))

  test("exports Section function", () => {
    expect(tsx).toContain("export function Section(")
  })

  test("exports SectionProps interface", () => {
    expect(tsx).toContain("export interface SectionProps")
  })

  test("root is <details> element", () => {
    expect(tsx).toMatch(/<details/)
  })

  test("head is <summary> element with .oc-section__head", () => {
    expect(tsx).toMatch(/<summary/)
    expect(tsx).toContain("oc-section__head")
  })

  test("renders icon in .oc-section__icon when provided", () => {
    expect(tsx).toContain("oc-section__icon")
  })

  test("renders title in .oc-section__title", () => {
    expect(tsx).toContain("oc-section__title")
  })

  test("renders badge in .oc-section__badge when provided", () => {
    expect(tsx).toContain("oc-section__badge")
  })

  test("content wrapped in .oc-section__body", () => {
    expect(tsx).toContain("oc-section__body")
  })

  test("supports defaultOpen prop", () => {
    expect(tsx).toContain("defaultOpen")
  })

  test("supports id and ref forwarding", () => {
    expect(tsx).toContain("local.id")
    expect(tsx).toContain("local.ref")
  })
})

// ── index.html load order ─────────────────────────────────────────────

describe("index.html primitive load order", () => {
  const html = readText(join(OVERLAY_ROOT, "src/index.html"))

  test("panel.css is loaded in index.html", () => {
    expect(html).toContain("primitives/panel.css")
  })

  test("section.css is loaded in index.html", () => {
    expect(html).toContain("primitives/section.css")
  })

  test("panel.css and section.css load before all surface files", () => {
    const panelAt = html.indexOf("primitives/panel.css")
    const sectionAt = html.indexOf("primitives/section.css")
    const firstSurfaceAt = html.indexOf("surfaces/titlebar.css")
    expect(panelAt).toBeGreaterThan(-1)
    expect(sectionAt).toBeGreaterThan(-1)
    expect(panelAt).toBeLessThan(firstSurfaceAt)
    expect(sectionAt).toBeLessThan(firstSurfaceAt)
  })

  test("panel.css and section.css load after primitives/tabs.css", () => {
    const tabsAt = html.indexOf("primitives/tabs.css")
    const panelAt = html.indexOf("primitives/panel.css")
    const sectionAt = html.indexOf("primitives/section.css")
    expect(tabsAt).toBeGreaterThan(-1)
    expect(panelAt).toBeGreaterThan(tabsAt)
    expect(sectionAt).toBeGreaterThan(tabsAt)
  })
})
