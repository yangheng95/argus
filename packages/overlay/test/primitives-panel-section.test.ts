// ── primitives-panel-section.test.ts ──
// Static-analysis guards for the Panel and Section primitive layer.
// Rendering tests are not possible in the Bun/node env (no DOM), so we
// verify:
//   1. CSS contract: expected class names are defined
//   2. JSX contract: correct named exports, expected props in source
//   3. Load-order: both CSS files are registered in index.html after
//      primitives/tabs.css and before any surface file

import { describe, test, expect } from "bun:test"
import { existsSync, readFileSync } from "fs"
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

// ── Section.tsx extended props ───────────────────────────────────────

describe("Section extended badge/body props", () => {
  const tsx = readText(join(OVERLAY_ROOT, "src/components/primitives/Section.tsx"))

  test("supports bodyId prop (id on .oc-section__body)", () => {
    expect(tsx).toContain("bodyId")
    expect(tsx).toContain("local.bodyId")
  })

  test("supports badgeTone prop (data-tone on .oc-section__badge)", () => {
    expect(tsx).toContain("badgeTone")
    expect(tsx).toContain("data-tone={local.badgeTone}")
  })

  test("supports badgeId prop (id on .oc-section__badge)", () => {
    expect(tsx).toContain("badgeId")
    expect(tsx).toContain("id={local.badgeId}")
  })

  test("supports badgeVariant prop (data-variant on .oc-section__badge)", () => {
    expect(tsx).toContain("badgeVariant")
    expect(tsx).toContain("data-variant={local.badgeVariant}")
  })

  test("accepts attr:* index signature for Solid attr: directives", () => {
    expect(tsx).toMatch(/\[key: `attr:\$\{string\}`\]/)
  })
})

// ── Step 9.E adoption guards ──────────────────────────────────────────

describe("FilesSection.tsx — top-level Files tab surface", () => {
  const tsx = readText(join(OVERLAY_ROOT, "src/components/FilesSection.tsx"))

  test("renders a top-level panel body instead of a nested Section", () => {
    expect(tsx).toContain('class="files-tab-panel"')
    expect(tsx).toContain('id="changesSection"')
    expect(tsx).toContain("<ChangesPanel")
    expect(tsx).not.toContain('from "./primitives/Section"')
    expect(tsx).not.toMatch(/<Section\b/)
  })

  test("no bare collapsible section chrome", () => {
    expect(tsx).not.toMatch(/class="section"/)
    expect(tsx).not.toMatch(/<details\b/)
    expect(tsx).not.toContain("section-head")
    expect(tsx).not.toContain("section-body")
  })
})

describe("Board.tsx — Section primitive adoption", () => {
  const tsx = readText(join(OVERLAY_ROOT, "src/components/Board.tsx"))

  test("imports Section primitive", () => {
    expect(tsx).toContain('from "./primitives/Section"')
  })

  test("uses <Section> in AcceptancePanel (acceptanceSection id)", () => {
    expect(tsx).toMatch(/id="acceptanceSection"/)
    // verify it's on Section, not bare details
    const acceptanceIdx = tsx.indexOf("acceptanceSection")
    const before = tsx.slice(Math.max(0, acceptanceIdx - 30), acceptanceIdx)
    expect(before).not.toContain("<details")
  })

  test('SectionFrame uses <Section> not bare <details class="section"', () => {
    // The bare <details class="section"> should be gone
    expect(tsx).not.toMatch(/<details[^>]*class="section"/)
  })

  test("no raw section-head / section-body class strings in JSX", () => {
    // Strip comments then check — find class= with these old names
    expect(tsx).not.toMatch(/class="section-head"/)
    expect(tsx).not.toMatch(/class="section-body"/)
    expect(tsx).not.toMatch(/class="section-icon"/)
    expect(tsx).not.toMatch(/class="section-title"/)
    expect(tsx).not.toMatch(/class="section-badge"/)
  })
})

describe("DiffPreviewPanel.tsx — Panel primitive adoption", () => {
  const tsx = readText(join(OVERLAY_ROOT, "src/components/DiffPreviewPanel.tsx"))

  test("imports Panel primitive", () => {
    expect(tsx).toContain('from "./primitives/Panel"')
  })

  test("uses <Panel> element", () => {
    expect(tsx).toMatch(/<Panel\b/)
  })

  test('no bare <div class="diff-preview-panel"', () => {
    expect(tsx).not.toMatch(/<div[^>]*class="diff-preview-panel"/)
  })

  test('no bare <header class="diff-preview-head"', () => {
    expect(tsx).not.toContain('class="diff-preview-head"')
  })
})

describe("FileViewPanel.tsx retirement", () => {
  test("built-in file preview component is deleted", () => {
    expect(existsSync(join(OVERLAY_ROOT, "src/components/FileViewPanel.tsx"))).toBe(false)
    expect(readText(join(OVERLAY_ROOT, "src/components/WorkspacePanel.tsx"))).not.toContain("FileViewPanel")
  })
})

describe("TracePanel.tsx — Panel primitive adoption", () => {
  const tsx = readText(join(OVERLAY_ROOT, "src/components/TracePanel.tsx"))

  test("imports Panel primitive", () => {
    expect(tsx).toContain('from "./primitives/Panel"')
  })

  test("uses <Panel> element", () => {
    expect(tsx).toMatch(/<Panel\b/)
  })

  test('no bare <div class="trace-panel"', () => {
    expect(tsx).not.toMatch(/<div[^>]*class="trace-panel"/)
  })

  test('no bare <div class="trace-panel-head"', () => {
    expect(tsx).not.toContain('class="trace-panel-head"')
  })
})

describe("CSS class rename guards — no stale .section-* selectors", () => {
  const inspectorCss = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
  const typographyCss = readText(join(OVERLAY_ROOT, "src/styles/cascade/typography.css"))
  const fieldCss = readText(join(OVERLAY_ROOT, "src/styles/surfaces/field.css"))
  const workspaceCss = readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css"))

  test("inspector.css uses .oc-section__head not .section-head for main rule", () => {
    expect(inspectorCss).toContain(".oc-section__head {")
    // allow section-head-action (surface-specific CTA class, not the primitive)
    const badPattern = /\.section-head\s*[\{:]/
    const occurrences = inspectorCss.match(/\.section-head(?!-action)/g) ?? []
    expect(occurrences.length).toBe(0)
  })

  test("inspector.css uses .oc-section not .section for main rule", () => {
    expect(inspectorCss).toContain(".oc-section {")
    expect(inspectorCss).not.toMatch(/^\.section\s*\{/m)
  })

  test("inspector.css uses .oc-section__badge not .section-badge", () => {
    expect(inspectorCss).toContain(".oc-section__badge")
    expect(inspectorCss).not.toContain(".section-badge")
  })

  test("typography.css uses .oc-section__title not .section-title", () => {
    expect(typographyCss).toContain(".oc-section__title,")
    expect(typographyCss).not.toContain(".section-title")
  })

  test("field.css uses .oc-section not .section in baseline list", () => {
    expect(fieldCss).toContain(".oc-section,")
    expect(fieldCss).toContain(".oc-section__body,")
  })

  test("workspace.css uses .oc-section__head not .section-head", () => {
    expect(workspaceCss).toContain(".oc-section[open] > .oc-section__head,")
    expect(workspaceCss).not.toContain(".section-head,")
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
