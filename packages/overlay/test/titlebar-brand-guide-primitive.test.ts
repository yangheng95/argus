import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")
const COMPONENT = readFileSync(
  path.join(OVERLAY_ROOT, "src", "components", "titlebar", "TitlebarBrandGuide.tsx"),
  "utf8",
)
const HTML = readFileSync(path.join(OVERLAY_ROOT, "src", "index.html"), "utf8")
const TITLEBAR_CSS = readFileSync(path.join(OVERLAY_ROOT, "src", "styles", "surfaces", "titlebar.css"), "utf8")
const EN_US = readFileSync(path.join(OVERLAY_ROOT, "src", "i18n", "en-US.json"), "utf8")
const ZH_CN = readFileSync(path.join(OVERLAY_ROOT, "src", "i18n", "zh-CN.json"), "utf8")

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

describe("titlebar brand guide primitive", () => {
  test("Solid component is the only owner of brand-guide markup", () => {
    expect(HTML).toContain('id="solidTitlebarBrandGuide"')
    expect(HTML).not.toMatch(/\bclass=["'][^"']*\bbrand-guide\b/)
    expect(HTML).not.toContain("brand.guide_usage_")
    expect(COMPONENT).toContain('import * as Popover from "@kobalte/core/popover"')
    expect(COMPONENT).toContain("<Popover.Root")
    expect(COMPONENT).toContain("<Popover.Trigger")
    expect(COMPONENT).toContain("<Popover.Content")
    expect(COMPONENT).toContain("anchorRef={anchorRef}")
  })

  test("guide trigger and content are accessible popover parts, not a hidden hover card", () => {
    expect(COMPONENT).toContain('type="button"')
    expect(COMPONENT).toContain('aria-label={t("brand.guide_trigger")}')
    expect(COMPONENT).not.toMatch(/<Popover\.Content[^>]*aria-hidden/)
    expect(COMPONENT).not.toMatch(/tabindex=["']0["']/)
    expect(TITLEBAR_CSS).toMatch(/\.brand-guide:hover,\s*\.brand-guide:focus-visible,\s*\.brand-guide\[data-expanded\]/)
    expect(TITLEBAR_CSS).not.toContain('.brand-guide[aria-expanded="true"]')
    expect(TITLEBAR_CSS).not.toMatch(/\.brand-guide:hover\s+\.brand-guide-card/)
    expect(TITLEBAR_CSS).not.toMatch(/\.brand-guide:focus-within\s+\.brand-guide-card/)
    expect(bodyOf(TITLEBAR_CSS, ".brand-guide-card")).not.toMatch(
      /position:\s*absolute|top:\s*|left:\s*|visibility:\s*hidden|pointer-events:\s*none/,
    )
  })

  test("compact brand rules follow the base rules so the menu cannot cover the trigger", () => {
    const copyBase = TITLEBAR_CSS.indexOf(".brand-guide-copyblock {")
    const cardBase = TITLEBAR_CSS.indexOf(".brand-guide-card {")
    const compactCard = TITLEBAR_CSS.indexOf("@container overlay-shell (width < 760px)", cardBase)
    expect(copyBase).toBeGreaterThan(-1)
    expect(cardBase).toBeGreaterThan(-1)
    expect(compactCard).toBeGreaterThan(cardBase)
    expect(TITLEBAR_CSS).not.toContain("@media (max-width: 760px)")
    expect([...TITLEBAR_CSS.matchAll(/\.brand-guide-copyblock\s*\{/g)]).toHaveLength(2)
    expect(TITLEBAR_CSS.slice(compactCard)).toMatch(/\.brand-guide-copyblock\s*\{\s*display:\s*none/)
    expect(TITLEBAR_CSS.slice(compactCard)).toMatch(/\.brand-guide-card\s*\{[\s\S]*width:\s*min\(calc\(320px/)
    expect(TITLEBAR_CSS.slice(compactCard)).toMatch(
      /\.brand-guide-card\s*\{[\s\S]*transform:\s*translateY\(var\(--ui-titlebar-height\)\)/,
    )
  })

  test("guide copy tracks the current titlebar menus without the retired Tools entry", () => {
    expect(EN_US).toContain("workspace, providers, runs, view, settings, help")
    expect(ZH_CN).toContain("工作区、模型提供方、运行、视图、设置、帮助")
    expect(EN_US).not.toMatch(/brand\.guide_usage_4[^\n]*\btools\b/i)
    expect(ZH_CN).not.toMatch(/brand\.guide_usage_4[^\n]*工具/)
  })
})
