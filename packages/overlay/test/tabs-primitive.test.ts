import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const TABS_SOURCE = join(import.meta.dir, "../src/components/ui/Tabs.tsx")
const TABS_CSS = join(import.meta.dir, "../src/styles/primitives/tabs.css")
const EXECUTOR_SELECTOR_SOURCE = join(import.meta.dir, "../src/components/ExecutorSelector.tsx")
const FILE_CHANGES_PANEL_SOURCE = join(import.meta.dir, "../src/components/FileChangesPanel.tsx")
const BROWSER_PREVIEW_PANEL_SOURCE = join(import.meta.dir, "../src/components/BrowserPreviewPanel.tsx")
const CONFIG_DIALOG_SOURCE = join(import.meta.dir, "../src/components/ConfigDialogHost.tsx")
// 2026-05-04: `src/styles.css` was decomposed into `src/styles/...`. The
// "only one chrome owner" check walks the new tree to confirm no rule
// for the retired `.right-panel-tab*` class survives anywhere.
const STYLES_ROOT = join(import.meta.dir, "../src/styles")

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

function sourceArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\] as const`))
  expect(match).not.toBeNull()
  return match![1]!
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
}

function cssDataValues(css: string, attr: "size" | "tone"): string[] {
  return Array.from(
    new Set(
      Array.from(css.matchAll(new RegExp(`\\.oc-tabs?\\[data-${attr}="([^"]+)"\\]`, "g"))).map((match) => match[1]!),
    ),
  ).sort()
}

test("Tabs primitive exposes the canonical data-attribute contract", () => {
  const source = readFileSync(TABS_SOURCE, "utf8")

  expect(source).toContain('export const TABS_SIZES = ["sm", "md"] as const')
  expect(source).toContain('export const TABS_TONES = ["neutral"] as const')
  expect(source).toContain('import { Tabs as KobalteTabs } from "@kobalte/core/tabs"')
  expect(source).toContain('Omit<JSX.HTMLAttributes<HTMLDivElement>, "classList" | "role" | "onChange">')
  expect(source).toContain('Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "classList" | "role" | "onChange">')
  expect(source).toContain(
    'Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "classList" | "role" | "type" | "onClick">',
  )
  expect(source).toContain('class="oc-tabs"')
  expect(source).toContain('class="oc-tab"')
  expect(source).toContain("<KobalteTabs.List")
  expect(source).toContain("<KobalteTabs.Trigger")
  expect(source).toContain("<KobalteTabs.Content")
  expect(source).toContain('data-active={local.active ? "true" : "false"}')
  expect(source).not.toMatch(/\b(?:right-panel-tab|btn|workspace-toggle)\b/)
})

test("Tabs primitive delegates tab semantics to Kobalte", () => {
  const source = readFileSync(TABS_SOURCE, "utf8")

  expect(source).toContain("<KobalteTabs")
  expect(source).toContain("export function TabList")
  expect(source).toContain("export function TabPanel")
  expect(source).toContain('orientation?: "horizontal" | "vertical"')
  expect(source).toContain("orientation={local.orientation}")
  expect(source).toContain('activationMode="manual"')
  expect(source).not.toContain('role="tablist"')
  expect(source).not.toContain('role="tab"')
  expect(source).not.toContain('role="tabpanel"')
})

test("retired WorkspacePanel does not keep a hand-written tab surface", () => {
  expect(existsSync(join(import.meta.dir, "../src/components/WorkspacePanel.tsx"))).toBe(false)
})

test("Feature tab surfaces use the Tabs primitive instead of hand-written ARIA", () => {
  for (const sourcePath of [EXECUTOR_SELECTOR_SOURCE, FILE_CHANGES_PANEL_SOURCE, CONFIG_DIALOG_SOURCE]) {
    const source = readFileSync(sourcePath, "utf8")

    expect(source).toContain("<Tabs")
    expect(source).toContain("<TabList")
    expect(source).toContain("<Tab")
    expect(source).toContain("<TabPanel")
    expect(source).toContain("onValueChange")
    expect(source).not.toContain('role="tablist"')
    expect(source).not.toContain('role="tab"')
    expect(source).not.toContain('role="tabpanel"')
    expect(source).not.toContain("aria-selected")
    expect(source).not.toContain("file-changes-tab")
    expect(source).not.toContain('"config-nav-item"')
    expect(source).not.toContain('class="config-tab-panel active"')
    const tabOpenTags = source.match(/<Tab\b[^>]*>/g) ?? []
    expect(tabOpenTags.length).toBeGreaterThan(0)
    for (const tag of tabOpenTags) {
      expect(tag).not.toContain("onClick=")
    }
  }
})

test("Tabs primitive owns the canonical keyboard focus ring", () => {
  const css = readFileSync(TABS_CSS, "utf8")

  expect(css).toMatch(/\.oc-tab:focus-visible\s*\{[^}]*outline:\s*var\(--oc-border-width\)\s+solid\s+var\(--accent\);/s)
  expect(css).toMatch(/\.oc-tab:focus-visible\s*\{[^}]*outline-offset:\s*calc\(1px \* var\(--ui-scale\)\);/s)
  expect(css).not.toMatch(/\.oc-tab[^{]*:focus-visible\s*\{[^}]*outline:\s*none\s*;/s)
})

test("Browser Preview viewport choices do not pretend to be tab panels", () => {
  const source = readFileSync(BROWSER_PREVIEW_PANEL_SOURCE, "utf8")

  expect(source).toContain('from "./ui/SegmentedControl"')
  expect(source).toContain("<SegmentedControl<BrowserPreviewViewportID>")
  expect(source).not.toContain('from "./ui/Tabs"')
  expect(source).not.toContain("<Tabs")
  expect(source).not.toContain("<Tab")
  expect(source).toContain('data-ui="browser-preview-viewports"')
  expect(source).toContain('class="oc-tabs"')
  expect(source).toContain('itemClass="oc-tab"')
})

test("Tabs primitive TypeScript API and CSS data variants stay in lockstep", () => {
  const source = readFileSync(TABS_SOURCE, "utf8")
  const css = readFileSync(TABS_CSS, "utf8")

  expect(cssDataValues(css, "size")).toEqual(sourceArray(source, "TABS_SIZES").sort())
  expect(cssDataValues(css, "tone")).toEqual(sourceArray(source, "TABS_TONES").sort())
})

test("Tabs primitive is the only right-panel tab chrome owner", () => {
  const styles = walkCss(STYLES_ROOT)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")

  expect(styles).not.toMatch(/\.right-panel-tab(?:list)?\b/)
  expect(styles).not.toMatch(/\.file-changes-tab\b/)
})
