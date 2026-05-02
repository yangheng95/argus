import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const REPO_ROOT = join(OVERLAY_ROOT, "..", "..")
const GOD_CSS_ARCHIVE_DIR = join(REPO_ROOT, "docs/archive/overlay-god-css")
const THIS_FILE = join(import.meta.dir, "overlay-architecture-guards.test.ts")

function readText(path: string): string {
  return readFileSync(path, "utf8")
}

function walkFiles(dir: string, predicate: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walkFiles(path, predicate))
    else if (predicate(path)) out.push(path)
  }
  return out
}

function count(pattern: RegExp, text: string): number {
  return Array.from(text.matchAll(pattern)).length
}

const THEME_LAYOUT_PROPERTIES =
  /^(?:display|position|inset|top|right|bottom|left|z-index|overflow|box-sizing|grid(?:-.+)?|flex(?:-.+)?|align-.+|justify-.+|place-.+|gap|row-gap|column-gap|margin(?:-.+)?|padding(?:-.+)?|width|height|min-width|min-height|max-width|max-height|border(?:-.+)?|border-radius|box-shadow|transform|translate|scale)$/
const THEME_CHROME_TOKEN =
  /^--(?:oc-)?(?:radius|space|spacing|size|height|width|shadow|border|layout|motion|duration|easing|font|type|z|gap|inset|padding|margin)(?:-|$)/
const LEGACY_BUTTON_CLASSES = [
  "btn",
  "btn-primary",
  "chat-send",
  "chat-interrupt",
  "titlebar-btn",
  "sidebar-btn",
  "sidebar-tool",
  "workspace-toggle",
  "right-panel-tab",
  "executor-chip",
  "chat-toolbar-btn",
  "titlebar-menubar-trigger",
  "titlebar-status-icon",
]
const LEGACY_BUTTON_CALLER_LIMITS: Record<string, number> = {
  btn: 0,
  "btn-primary": 0,
  "chat-send": 0,
  "chat-interrupt": 0,
  "titlebar-btn": 0,
  "sidebar-btn": 0,
  "sidebar-tool": 0,
  "workspace-toggle": 0,
  "right-panel-tab": 3,
  "executor-chip": 0,
  "chat-toolbar-btn": 0,
  "titlebar-menubar-trigger": 0,
  "titlebar-status-icon": 0,
}

function countThemeLayoutOverrides(css: string): number {
  let total = 0
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1] ?? ""
    if (!/body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)) continue
    const body = match[2] ?? ""
    for (const declaration of body.split(/;|\n/)) {
      const prop = declaration.match(/^\s*([a-zA-Z-]+)\s*:/)?.[1]
      if (prop && THEME_LAYOUT_PROPERTIES.test(prop)) total += 1
    }
  }
  return total
}

function countLegacyButtonClassCallers(): Record<string, number> {
  const counts = Object.fromEntries(LEGACY_BUTTON_CLASSES.map((className) => [className, 0]))
  const files = walkFiles(join(OVERLAY_ROOT, "src"), (path) => path.endsWith(".tsx"))
  for (const file of files) {
    const text = readText(file)
    for (const match of text.matchAll(/(?:class|className)=\{?["']([^"']+)["']/g)) {
      const tokens = new Set(match[1]!.split(/\s+/).filter(Boolean))
      for (const className of LEGACY_BUTTON_CLASSES) {
        if (tokens.has(className)) counts[className] += 1
      }
    }
  }
  return counts
}

describe("overlay architecture guards", () => {
  test("Phase 1 directories and single-root shell exist", () => {
    for (const dir of [
      "src/styles/tokens",
      "src/styles/primitives",
      "src/styles/surfaces",
      "src/styles/themes",
      "src/components/ui",
      "src/components/surfaces",
    ]) {
      expect(existsSync(join(OVERLAY_ROOT, dir))).toBe(true)
    }
    expect(existsSync(join(OVERLAY_ROOT, "src/components/App.tsx"))).toBe(true)
  })

  test("God CSS archive is reference-only and isolated from the runtime graph", () => {
    expect(existsSync(GOD_CSS_ARCHIVE_DIR)).toBe(true)

    const runtimeFiles = [
      ...walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:css|ts|tsx|js|jsx|mjs|cjs)$/.test(path)),
      ...walkFiles(join(OVERLAY_ROOT, "test"), (path) => {
        if (path === THIS_FILE) return false
        return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path)
      }),
      ...["index.html", "vite.config.ts", "package.json"]
        .map((file) => join(OVERLAY_ROOT, file))
        .filter((path) => existsSync(path)),
    ]
    const archiveReference = /docs[\\/]+archive[\\/]+overlay-god-css|overlay-god-css|god-css-archive/i
    const cssImport = /(?:@import\s+|import\s+(?:"[^"]+\.css"|'[^']+\.css')|import\s+[^'"]+from\s+["'][^"']+\.css["'])/

    for (const file of runtimeFiles) {
      const text = readText(file)
      expect(text).not.toMatch(archiveReference)
      expect(text).not.toMatch(new RegExp(`${cssImport.source}[\\s\\S]*${archiveReference.source}`, "i"))
    }

    const archivedCssUnderSource = walkFiles(join(OVERLAY_ROOT, "src"), (path) =>
      /(?:archive|legacy|god).*\.css$/i.test(path),
    )
    expect(archivedCssUnderSource).toEqual([])
  })

  test("legacy style debt cannot increase while migration is in progress", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const card = readText(join(OVERLAY_ROOT, "src/styles/card.css"))

    expect(count(/!important\b/g, styles + "\n" + card)).toBeLessThanOrEqual(381)
    expect(count(/body\[data-theme/g, styles)).toBeLessThanOrEqual(262)
  })

  test("legacy theme selectors cannot keep gaining layout and chrome overrides", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    expect(countThemeLayoutOverrides(styles)).toBeLessThanOrEqual(278)
  })

  test("new theme files only write root-scoped tokens", () => {
    const files = walkFiles(join(OVERLAY_ROOT, "src/styles/themes"), (path) => path.endsWith(".css"))
    for (const file of files) {
      const css = readText(file).replace(/\/\*[\s\S]*?\*\//g, "")
      const selectors = Array.from(css.matchAll(/([^{}@]+)\{/g)).map((match) => match[1]!.trim())
      for (const selector of selectors) {
        for (const item of selector
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)) {
          expect(item).toMatch(/^:root(?:\[[^\]]+\])?$/)
        }
      }
    }
  })

  test("new theme files are palette-only and never define chrome tokens", () => {
    const files = walkFiles(join(OVERLAY_ROOT, "src/styles/themes"), (path) => path.endsWith(".css"))
    for (const file of files) {
      const css = readText(file).replace(/\/\*[\s\S]*?\*\//g, "")
      for (const declaration of css.split(/;|\n/)) {
        const match = declaration.match(/^\s*(--[a-zA-Z0-9-]+)\s*:/)
        if (!match) continue
        const prop = match[1]!
        expect(prop).toMatch(/^--oc-color-/)
        expect(prop).not.toMatch(THEME_CHROME_TOKEN)
      }
    }
  })

  test("new token files stay root-scoped and keep design-language contracts explicit", () => {
    const files = walkFiles(join(OVERLAY_ROOT, "src/styles/tokens"), (path) => path.endsWith(".css"))
    expect(files.length).toBeGreaterThan(0)
    const tokenText = files.map(readText).join("\n")

    for (const file of files) {
      const css = readText(file).replace(/\/\*[\s\S]*?\*\//g, "")
      const selectors = Array.from(css.matchAll(/([^{}@]+)\{/g)).map((match) => match[1]!.trim())
      for (const selector of selectors) {
        for (const item of selector
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)) {
          expect(item).toBe(":root")
        }
      }
      expect(css).not.toMatch(/data-theme|body\[|body:is\(/)
    }

    for (const token of [
      "--oc-header-height",
      "--oc-header-padding-x",
      "--oc-header-gap",
      "--oc-radius-panel",
      "--oc-radius-card",
      "--oc-radius-control",
      "--oc-radius-pill",
      "--oc-density-control-height",
      "--oc-density-icon-button",
    ]) {
      expect(tokenText).toContain(token)
    }
  })

  test("new surface style files do not introduce raw color or pixel literals", () => {
    const files = walkFiles(join(OVERLAY_ROOT, "src/styles/surfaces"), (path) => path.endsWith(".css"))
    const rawValue = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?<![\w-])-?\d+(?:\.\d+)?px\b/i
    for (const file of files) {
      expect(readText(file)).not.toMatch(rawValue)
    }
  })

  test("new primitive style files use data attributes for variants and never use important", () => {
    const files = walkFiles(join(OVERLAY_ROOT, "src/styles/primitives"), (path) => path.endsWith(".css"))
    expect(files.length).toBeGreaterThan(0)
    const primitiveText = files.map(readText).join("\n")
    const rawValue = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?<![\w-])-?\d+(?:\.\d+)?px\b/i
    expect(primitiveText).toContain("[data-variant=")
    expect(primitiveText).toContain("[data-size=")
    expect(primitiveText).toContain("[data-tone=")

    for (const file of files) {
      const css = readText(file)
      expect(css).not.toMatch(/!important\b/)
      expect(css).not.toMatch(/body\[|body:is\(|data-theme/)
      expect(css).not.toMatch(rawValue)
    }
  })

  test("legacy button class callers cannot increase during primitive migration", () => {
    const counts = countLegacyButtonClassCallers()
    for (const className of LEGACY_BUTTON_CLASSES) {
      expect(counts[className]).toBeLessThanOrEqual(LEGACY_BUTTON_CALLER_LIMITS[className]!)
    }
    expect(Object.values(counts).reduce((total, value) => total + value, 0)).toBeLessThanOrEqual(3)
  })

  test("new component modules stay below the split threshold", () => {
    const files = [
      ...walkFiles(join(OVERLAY_ROOT, "src/components/ui"), (path) => path.endsWith(".tsx")),
      ...walkFiles(join(OVERLAY_ROOT, "src/components/surfaces"), (path) => path.endsWith(".tsx")),
    ]
    for (const file of files) {
      const lines = readText(file).split(/\r?\n/).length
      expect(lines).toBeLessThanOrEqual(300)
    }
  })
})
