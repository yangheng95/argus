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

function countDuplicateSelectors(css: string): number {
  const selectorCounts = new Map<string, number>()
  for (const match of withoutComments(css).matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const head = (match[1] ?? "").trim()
    if (head.includes("@")) continue
    for (const selector of head
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      selectorCounts.set(selector, (selectorCounts.get(selector) ?? 0) + 1)
    }
  }
  return Array.from(selectorCounts.values()).filter((value) => value > 1).length
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function soloRuleBody(css: string, selector: string): string {
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const raw = chunk.slice(0, openIdx)
    const head = raw.trim()
    if (head !== selector) continue
    const lastNewline = raw.lastIndexOf("\n")
    const lastLine = raw.slice(lastNewline + 1)
    if (lastLine !== lastLine.trimStart()) continue
    return chunk.slice(openIdx + 1)
  }
  throw new Error(`solo ${selector} not found`)
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
  "right-panel-tab": 0,
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

    expect(count(/!important\b/g, styles + "\n" + card)).toBeLessThanOrEqual(183)
    expect(count(/body\[data-theme/g, styles)).toBeLessThanOrEqual(125)
  })

  test("card stylesheet duplicate selector debt cannot increase", () => {
    const card = readText(join(OVERLAY_ROOT, "src/styles/card.css"))

    expect(countDuplicateSelectors(card)).toBeLessThanOrEqual(52)
  })

  test("legacy theme selectors cannot keep gaining layout and chrome overrides", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    expect(countThemeLayoutOverrides(styles)).toBeLessThanOrEqual(84)
  })

  test("right-panel inner headers do not rely on theme reset chrome", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    expect(styles).not.toMatch(/body[^{]*(?:delivery-panel-header|criteria-group-head)[^{]*\{/)
  })

  test("right-panel primary headers do not rely on theme spacing resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    expect(styles).not.toMatch(/body[^{]*(?:section-head|gwg-header)[^{]*\{[^}]*\b(?:min-height|gap|padding)\s*:/)
  })

  test("right-panel primary and config headers do not rely on theme chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/(?:section-head|gwg-header|config-section-head|config-subsection-head)/)
    }
  })

  test("criteria groups do not rely on theme layout or chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/criteria-group(?:-list)?/)
    }
  })

  test("delivery panel keeps verdict accent outside theme chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/delivery-panel/)
    }

    expect(styles).toMatch(/\.delivery-panel::before\s*\{[^}]*background:\s*var\(--delivery-panel-accent\)/)
    expect(styles).not.toMatch(/\.delivery-panel\s*\{[^}]*border-left\s*:/)
  })

  test("evaluation errors keep semantic error chrome outside theme resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/eval-error/)
    }

    const evalErrorBody = styles.match(/\.eval-error\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(evalErrorBody).toContain("background: linear-gradient")
    expect(evalErrorBody).toContain("rgba(224, 106, 99")
    expect(evalErrorBody).toContain("border: 0")
  })

  test("settings document/detail cards do not rely on theme chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/(?:channel-doc-card|detail-card)/)
    }

    for (const selector of [".channel-doc-card", ".detail-card"]) {
      const body = styles.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? ""
      expect(body).toContain("background: var(--surface-inset)")
      expect(body).toContain("border: 0")
    }
  })

  test("settings extension rows do not rely on theme or local important chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const hasExtensionRow = /(?:^|\s|:is\([^)]*)\.extension-row(?:\b|[:.[#])/.test(selector)
      if (!hasExtensionRow) continue

      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const usesChromeImportant =
        /(background|border|border-color|border-radius|box-shadow):\s*[^;]*!important/.test(body)

      expect(isThemeSelector).toBe(false)
      expect(usesChromeImportant).toBe(false)
    }

    const body = styles.match(/\.extension-row\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(body).toContain("background: var(--surface-inset)")
    expect(body).toContain("border: 0")
  })

  test("settings config containers do not rely on theme or local important chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const hasConfigContainer = /(?:^|\s|:is\([^)]*)\.config-(?:section|subsection)(?:\b|[:.[#])/.test(
        selector,
      )
      if (!hasConfigContainer) continue

      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const usesChromeImportant =
        /(background|border|border-color|border-radius|box-shadow):\s*[^;]*!important/.test(body)

      expect(isThemeSelector).toBe(false)
      expect(usesChromeImportant).toBe(false)
    }

    for (const selector of [".config-section", ".config-subsection"]) {
      const body = soloRuleBody(styles, selector)
      expect(body).toContain("background: var(--surface-inset)")
      expect(body).toContain("border: 0")
    }
  })

  test("composer shell does not rely on theme chrome resets", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const hasChatInput = /(?:^|\s|:is\([^)]*)\.chat-input(?:\b|[:.[#])/.test(selector)
      if (!hasChatInput) continue

      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const usesChromeImportant =
        /(margin|padding|gap|background|border|border-color|border-radius|box-shadow):\s*[^;]*!important/.test(
          body,
        )

      expect(isThemeSelector).toBe(false)
      expect(usesChromeImportant).toBe(false)
    }

    const body = soloRuleBody(styles, ".chat-input")
    expect(body).toContain("margin: 0")
    expect(body).toContain("padding: calc(4px * var(--ui-scale))")
    expect(body).toContain("gap: calc(2px * var(--ui-scale))")
    expect(body).toContain("border-radius: 0")
  })

  test("panel shell padding is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/(?:^|[\s>+~,])\.panel(?:$|[\s:{.#\[,>+~])/.test(selector)) continue

      expect(body).not.toMatch(/\bpadding(?:-[a-z]+)?\s*:/)
    }

    const body = soloRuleBody(styles, ".panel")
    expect(body).toContain("padding: 0")
  })

  test("titlebar shell layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/(?:^|[\s>+~,])\.titlebar(?:$|[\s:{.#\[,>+~])/.test(selector)) continue

      expect(body).not.toMatch(
        /\b(?:gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|border|border-left|border-right|border-radius|box-shadow)\s*:/,
      )
    }

    const body = soloRuleBody(styles, ".titlebar")
    for (const declaration of [
      "gap: calc(2px * var(--ui-scale))",
      "margin: 0",
      "padding: calc(2px * var(--ui-scale)) calc(4px * var(--ui-scale))",
      "border: 1px solid var(--border)",
      "border-left: 0",
      "border-right: 0",
      "border-radius: 0",
      "box-shadow: none",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("directory and sidebar toolset spacing are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.(?:task-dir-shell|task-cwd-dropdown|sidebar-toolset)\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:gap|padding(?:-[a-z]+)?)\s*:/)
    }

    expect(soloRuleBody(styles, ".task-dir-shell")).toContain("gap: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(styles, ".task-dir-shell")).toContain("padding: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(styles, ".task-dir-shell.task-cwd-dropdown")).toContain(
      "padding-inline: calc(2px * var(--ui-scale))",
    )
    expect(soloRuleBody(styles, ".task-dir-shell.task-cwd-dropdown")).toContain(
      "padding-block: calc(2px * var(--ui-scale))",
    )
    expect(soloRuleBody(styles, ".sidebar-toolset")).toContain("gap: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(styles, ".sidebar-toolset")).toContain("padding: calc(2px * var(--ui-scale))")
  })

  test("right-panel empty hint density is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const hasRightPanelEmptyHint =
        /\.section-body\s*>\s*\.empty-hint\b/.test(selector) ||
        /#solidChangesPanel\s*>\s*\.empty-hint\b/.test(selector)
      if (!isThemeSelector || !hasRightPanelEmptyHint) continue

      expect(body).not.toMatch(/\b(?:gap|padding(?:-[a-z]+)?|border(?:-[a-z]+)?|border-radius)\s*:/)
    }

    const body = soloRuleBody(styles, ".section-body > .empty-hint,\n#solidChangesPanel > .empty-hint")
    for (const declaration of [
      "gap: calc(4px * var(--ui-scale))",
      "padding: calc(6px * var(--ui-scale))",
      "border: 0",
      "border-radius: calc(4px * var(--ui-scale))",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow panel shell is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-panel\b/.test(selector)) continue

      expect(selector).not.toMatch(/\.agent-workflow-panel\b/)
    }

    const panelBody = soloRuleBody(styles, ".agent-workflow-panel")
    for (const declaration of [
      "isolation: isolate",
      "display: flex",
      "flex-direction: column",
      "gap: 0",
      "padding: 0",
      "overflow: hidden",
      "background: color-mix(in srgb, var(--surface-inset) 92%, var(--surface))",
    ]) {
      expect(panelBody).toContain(declaration)
    }

    const beforeBody = soloRuleBody(styles, ".agent-workflow-panel::before")
    for (const declaration of [
      'content: ""',
      "position: absolute",
      "inset: 0",
      "z-index: -1",
      "opacity: 0.18",
      "background-size: calc(26px * var(--ui-scale)) calc(26px * var(--ui-scale))",
      "mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 84%, transparent)",
    ]) {
      expect(beforeBody).toContain(declaration)
    }
  })

  test("workflow canvas layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-canvas\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:display|gap|padding(?:-[a-z]+)?)\s*:/)
    }

    const body = soloRuleBody(styles, ".agent-workflow-canvas")
    for (const declaration of [
      "display: block",
      "flex: 1 1 0",
      "min-height: 0",
      "overflow-y: auto",
      "padding: calc(18px * var(--ui-scale)) calc(14px * var(--ui-scale)) calc(38px * var(--ui-scale))",
      "calc(10px * var(--ui-scale))",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow row geometry is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-row\b/.test(selector)) continue

      expect(body).not.toMatch(
        /\b(?:--lane-shift|grid-template-columns|gap|min-height|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:/,
      )
    }

    const body = soloRuleBody(styles, ".agent-workflow-row")
    for (const declaration of [
      "--lane-shift: calc(var(--workflow-depth, 0) * 20px * var(--ui-scale))",
      "display: grid",
      "grid-template-columns: calc(34px * var(--ui-scale)) minmax(0, 1fr)",
      "gap: calc(10px * var(--ui-scale))",
      "min-height: calc(104px * var(--ui-scale))",
      "margin-left: var(--lane-shift)",
      "margin-bottom: calc(14px * var(--ui-scale))",
      "padding-left: 0",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow rail geometry is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-rail\b/.test(selector)) continue

      expect(body).not.toMatch(
        /\b(?:position|display|place-items|width|min-height|background(?:-[a-z]+)?)\s*:/,
      )
    }

    const body = soloRuleBody(styles, ".agent-workflow-rail")
    for (const declaration of [
      "position: relative",
      "display: grid",
      "place-items: start center",
      "width: auto",
      "min-height: calc(104px * var(--ui-scale))",
      "background: transparent",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow stack layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-stack\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:position|display|gap|min-width|padding(?:-[a-z]+)?)\s*:/)
    }

    const body = soloRuleBody(styles, ".agent-workflow-stack")
    for (const declaration of [
      "position: relative",
      "display: grid",
      "gap: 0",
      "min-width: 0",
      "padding-bottom: calc(var(--stack-pad, 0) + 8px)",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow card chrome and tones are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const hasWorkflowCard = /(?:^|[\s>+~,])\.agent-workflow-card(?![-\w])/.test(selector)
      if (!isThemeSelector || !hasWorkflowCard) continue

      expect(selector).not.toMatch(/\.agent-workflow-card(?![-\w])/)
    }

    const cardBody = soloRuleBody(styles, ".agent-workflow-card")
    for (const declaration of [
      "--workflow-tone: var(--accent)",
      "min-height: calc(94px * var(--ui-scale))",
      "gap: calc(7px * var(--ui-scale))",
      "padding: calc(11px * var(--ui-scale)) calc(12px * var(--ui-scale)) calc(10px * var(--ui-scale))",
      "overflow: hidden",
      "border: 1px solid color-mix(in srgb, var(--workflow-tone) 28%, var(--border))",
      "border-radius: calc(10px * var(--ui-scale))",
      "background: color-mix(in srgb, var(--surface) 88%, var(--workflow-tone) 4%)",
    ]) {
      expect(cardBody).toContain(declaration)
    }

    expect(soloRuleBody(styles, '.agent-workflow-card[data-status="running"]')).toContain(
      "border-style: dashed",
    )
    expect(soloRuleBody(styles, '.agent-workflow-card[data-status="completed"]')).toContain(
      "--workflow-tone: var(--good)",
    )
    expect(soloRuleBody(styles, '.agent-workflow-card[data-status="error"]')).toContain(
      "--workflow-tone: var(--bad)",
    )
    expect(soloRuleBody(styles, '.agent-workflow-card[data-status="idle"]')).toContain(
      "--workflow-tone: var(--warn)",
    )

    const hoverBody = soloRuleBody(styles, ".agent-workflow-card:hover,\n.agent-workflow-card:focus-visible")
    expect(hoverBody).toContain("border-color: color-mix(in srgb, var(--workflow-tone) 58%, var(--border))")
    expect(hoverBody).toContain(
      "transform: translate(var(--stack-offset, 0), calc(var(--stack-offset, 0) - 1px))",
    )
  })

  test("workflow card text density is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const hasWorkflowCardText = /\.(?:agent-workflow-agent|agent-workflow-card-body)\b/.test(selector)
      if (!isThemeSelector || !hasWorkflowCardText) continue

      expect(body).not.toMatch(/\b(?:min-height|color|font-size|font-weight|line-height)\s*:/)
    }

    const agentBody = soloRuleBody(styles, ".agent-workflow-agent")
    expect(agentBody).toContain("font-size: var(--ui-font-small)")
    expect(agentBody).toContain("font-weight: 780")

    const cardBody = soloRuleBody(styles, ".agent-workflow-card-body")
    for (const declaration of [
      "min-height: calc(34px * var(--ui-scale))",
      "color: var(--text-base)",
      "font-size: var(--ui-font-control)",
      "line-height: 1.4",
    ]) {
      expect(cardBody).toContain(declaration)
    }
  })

  test("workflow attempt chip chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-attempt\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:border|background|color)\s*:/)
    }

    const body = soloRuleBody(styles, ".agent-workflow-attempt")
    for (const declaration of [
      "border: 1px solid color-mix(in srgb, var(--workflow-tone) 38%, transparent)",
      "border-radius: calc(999px * var(--ui-scale))",
      "padding: 0 calc(6px * var(--ui-scale))",
      "background: color-mix(in srgb, var(--workflow-tone) 13%, transparent)",
      "color: color-mix(in srgb, var(--workflow-tone) 82%, var(--text-strong))",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow report shell chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const hasReportShell =
        /\.agent-workflow-report-popover\b/.test(selector) ||
        /\.agent-workflow-report(?![-\w])/.test(selector)
      if (!isThemeSelector || !hasReportShell) continue

      expect(body).not.toMatch(
        /\b(?:align-items|padding(?:-[a-z]+)?|background|border|border-radius|box-shadow)\s*:/,
      )
    }

    const popoverBody = soloRuleBody(styles, ".agent-workflow-report-popover")
    for (const declaration of [
      "align-items: flex-end",
      "padding: calc(14px * var(--ui-scale))",
      "background: color-mix(in srgb, var(--dialog-backdrop) 44%, transparent)",
    ]) {
      expect(popoverBody).toContain(declaration)
    }

    const reportBody = soloRuleBody(styles, ".agent-workflow-report")
    for (const declaration of [
      "border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border))",
      "border-radius: calc(14px * var(--ui-scale))",
      "background: var(--dialog-bg)",
      "box-shadow: 0 calc(14px * var(--ui-scale)) calc(30px * var(--ui-scale)) rgba(0, 0, 0, 0.24)",
    ]) {
      expect(reportBody).toContain(declaration)
    }
  })

  test("workflow report dividers are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const hasReportDivider =
        /\.agent-workflow-report-head\b/.test(selector) ||
        /\.agent-workflow-report-section\b/.test(selector)
      if (!isThemeSelector || !hasReportDivider) continue

      expect(body).not.toMatch(/\bborder(?:-[a-z]+)?\s*:/)
    }

    expect(soloRuleBody(styles, ".agent-workflow-report-head")).toContain(
      "border-bottom: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border))",
    )
    expect(soloRuleBody(styles, ".agent-workflow-report-section")).toContain(
      "border-bottom: 1px solid color-mix(in srgb, var(--border) 58%, transparent)",
    )
  })

  test("workflow refresh button chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-refresh\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:border|border-radius|background|box-shadow|color)\s*:/)
    }

    const body = soloRuleBody(styles, ".agent-workflow-refresh")
    for (const declaration of [
      "border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
      "border-radius: calc(999px * var(--ui-scale))",
      "padding: 0 calc(10px * var(--ui-scale))",
      "background: color-mix(in srgb, var(--accent) 8%, var(--surface-strong))",
      "box-shadow: none",
      "color: var(--text-strong)",
    ]) {
      expect(body).toContain(declaration)
    }

    expect(soloRuleBody(styles, ".agent-workflow-refresh:hover")).toContain(
      "background: color-mix(in srgb, var(--accent) 12%, var(--surface-strong))",
    )
  })

  test("workflow report close button chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-report-close\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:border|background|box-shadow|color)\s*:/)
    }

    const body = soloRuleBody(styles, ".agent-workflow-report-close")
    for (const declaration of [
      "width: calc(28px * var(--ui-scale))",
      "padding: 0",
      "border: 0",
      "background: transparent",
      "box-shadow: none",
      "color: var(--text-soft)",
    ]) {
      expect(body).toContain(declaration)
    }

    expect(soloRuleBody(styles, ".agent-workflow-report-close:hover")).toContain(
      "background: color-mix(in srgb, var(--accent) 10%, transparent)",
    )
  })

  test("panel body shell chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.panel-body\b/.test(selector)) continue

      expect(body).not.toMatch(
        /\b(?:gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|border(?:-[a-z]+)?|border-radius|box-shadow)\s*:/,
      )
    }

    const bodies = Array.from(styles.matchAll(/(^|\n)\.panel-body\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const body = bodies.at(-1) ?? ""
    for (const declaration of [
      "gap: 0",
      "padding: 0",
      "margin: 0",
      "border: 0",
      "border-radius: 0",
      "box-shadow: none",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("task bar shell layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/(?:^|[\s>+~,])\.task-bar(?:$|[\s:{.#\[,>+~])/.test(selector)) continue

      expect(body).not.toMatch(
        /\b(?:margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|border-width|border-left|border-right|border-radius)\s*:/,
      )
    }

    const bodies = Array.from(styles.matchAll(/(^|\n)\.task-bar\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const body = bodies.at(-1) ?? ""
    for (const declaration of [
      "margin: 0",
      "padding: 0 calc(6px * var(--ui-scale))",
      "border-width: 0 0 1px",
      "border-radius: 0",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("primary column shell chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const columnClass = String.raw`(?:sidebar|chat|sections)`

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector) continue
      if (!new RegExp(`(?:^|[\\s>+~,])\\.${columnClass}(?:$|[\\s:{.#\\[,>+~])`).test(selector)) {
        continue
      }

      expect(body).not.toMatch(/\b(?:border(?:-[a-z]+)?|border-radius|box-shadow|backdrop-filter)\s*:/)
    }

    for (const selector of [".sidebar", ".chat", ".sections"]) {
      const body = soloRuleBody(styles, selector)
      for (const declaration of [
        "border: 0",
        "border-radius: 0",
        "box-shadow: none",
        "backdrop-filter: none",
      ]) {
        expect(body).toContain(declaration)
      }
    }
  })

  test("workspace and inspector stack spacing are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.(?:workspace-main|sections-stack)\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:/)
    }

    const workspaceBodies = Array.from(styles.matchAll(/(^|\n)\.workspace-main\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const workspaceBody = workspaceBodies.at(-1) ?? ""
    for (const declaration of ["gap: 0", "margin: 0", "padding: 0"]) {
      expect(workspaceBody).toContain(declaration)
    }

    const sectionsBodies = Array.from(styles.matchAll(/(^|\n)\.sections-stack\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const sectionsBody = sectionsBodies.at(-1) ?? ""
    expect(sectionsBody).toContain("gap: calc(4px * var(--ui-scale))")
    expect(sectionsBody).toContain("padding: calc(4px * var(--ui-scale))")
  })

  test("right panel card radius and body padding are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (
        !isThemeSelector ||
        !/(?:^|[\s>+~,])\.(?:section|gwg|section-body|gwg-body)(?:$|[\s:{.#\[,>+~])/.test(selector)
      ) {
        continue
      }

      expect(body).not.toMatch(/\b(?:border-radius|padding(?:-[a-z]+)?)\s*:/)
    }

    for (const selector of [".section", ".gwg"]) {
      const body = soloRuleBody(styles, selector)
      expect(body).toContain("border-radius: calc(5px * var(--ui-scale))")
    }

    for (const selector of [".section-body", ".gwg-body"]) {
      const body = soloRuleBody(styles, selector)
      expect(body).toContain("padding: 0 calc(6px * var(--ui-scale)) calc(6px * var(--ui-scale))")
    }
  })

  test("board intro density and typography are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const card = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/card.css")))

    expect(card).not.toMatch(/\.board-intro(?:__|\b)/)

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.board-intro(?:__|\b)/.test(selector)) continue
      if (/\.board-intro__cta-action\b/.test(selector)) continue

      expect(body).not.toMatch(
        /\b(?:display|gap|grid-template-columns|overflow|-webkit-line-clamp|-webkit-box-orient|font-size|line-height|letter-spacing|text-transform|padding(?:-[a-z]+)?|border|border-radius)\s*:/,
      )
    }

    expect(soloRuleBody(styles, ".board-intro")).toContain("gap: calc(1px * var(--ui-scale))")
    expect(soloRuleBody(styles, ".board-intro")).toContain("padding: calc(1px * var(--ui-scale))")
    expect(soloRuleBody(styles, ".board-intro__title")).toContain("font-size: var(--ui-font-body)")
    expect(soloRuleBody(styles, ".board-intro__section")).toContain("border-radius: calc(4px * var(--ui-scale))")
    expect(soloRuleBody(styles, ".board-intro__section")).toContain("border: 0")
    expect(soloRuleBody(styles, ".board-intro__modes")).toContain(
      "grid-template-columns: repeat(auto-fit, minmax(calc(128px * var(--ui-scale)), 1fr))",
    )
    expect(soloRuleBody(styles, ".board-intro__cta")).toContain("border-radius: calc(3px * var(--ui-scale))")
    expect(soloRuleBody(styles, ".board-intro__mode-desc,\n.board-intro__agent-desc")).toContain(
      "-webkit-line-clamp: 2",
    )
  })

  test("chat scroll layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.chat-scroll\b/.test(selector)) continue

      expect(body).not.toMatch(/\bpadding(?:-[a-z]+)?\s*:/)
    }

    const bodies = Array.from(styles.matchAll(/(^|\n)\.chat-scroll\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const body = bodies.at(-1) ?? ""
    expect(body).toContain(
      "padding: calc(18px * var(--ui-scale)) calc(22px * var(--ui-scale)) calc(20px * var(--ui-scale))",
    )
  })

  test("chat task-switch progress overlays the header instead of creating a hidden gap", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const chatBody = soloRuleBody(styles, ".chat")
    const progressBody = soloRuleBody(styles, ".task-switch-progress")

    expect(chatBody).toContain("position: relative")
    expect(progressBody).toContain("position: absolute")
    expect(progressBody).toContain("inset-block-start: 0")
    expect(progressBody).toContain("inset-inline: 0")
    expect(progressBody).not.toContain("flex-shrink")
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
      "--oc-header-title-line-height",
      "--oc-titlebar-menu-text",
      "--oc-radius-panel",
      "--oc-radius-card",
      "--oc-radius-control",
      "--oc-radius-pill",
      "--oc-density-control-height",
      "--oc-density-icon-button",
      "--oc-titlebar-gap",
    ]) {
      expect(tokenText).toContain(token)
    }
  })

  test("icon button padding is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const iconButtonClasses = [".titlebar-btn", ".titlebar-status-icon", ".chat-toolbar-btn"]

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const targetsIconButton = iconButtonClasses.some((cls) =>
        new RegExp(`\\${cls}\\b`).test(selector),
      )
      if (!isThemeSelector || !targetsIconButton) continue

      expect(body).not.toMatch(/\bpadding(?:-[a-z]+)?\s*:/)
    }

    for (const className of iconButtonClasses) {
      const escaped = className.replace(".", "\\.")
      const ruleBodies = Array.from(
        styles.matchAll(new RegExp(`(^|[\\n,])\\s*${escaped}[^{},]*\\{([^{}]*)\\}`, "g")),
      ).map((match) => match[2] ?? "")
      const bodyText = ruleBodies.join("\n")
      expect(bodyText).toContain("padding: 0")
    }
  })

  test("titlebar layout container gaps are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const containerSelectors = [
      ".titlebar-left",
      ".titlebar-brand",
      ".titlebar-nav",
      ".titlebar-nav-group",
      ".titlebar-utility",
      ".titlebar-actions",
      ".titlebar-status-cluster",
      ".titlebar-window-controls",
    ]

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const targetsTitlebarLayout = containerSelectors.some((cls) =>
        new RegExp(`\\${cls}\\b`).test(selector),
      )
      if (!isThemeSelector || !targetsTitlebarLayout) continue

      expect(body).not.toMatch(/\bgap\s*:/)
    }

    for (const selector of containerSelectors) {
      const body = soloRuleBody(styles, selector)
      expect(body).toContain("gap: var(--oc-titlebar-gap)")
    }
  })

  test("shared header background resolves from root palette tokens, not legacy body palette", () => {
    const tokenText = readText(join(OVERLAY_ROOT, "src/styles/tokens/design-language.css"))
    const headerText = readText(join(OVERLAY_ROOT, "src/styles/surfaces/header.css"))

    expect(tokenText).toMatch(/--oc-header-bg:\s*var\(--oc-color-surface-strong\)/)
    expect(tokenText).toMatch(/--oc-titlebar-menu-text:\s*#000000/)
    expect(tokenText).not.toMatch(/--oc-header-bg:\s*var\(--surface-strong\)/)
    expect(headerText).toMatch(/background:\s*var\(--oc-header-bg\)/)
  })

  test("new surface style files do not introduce raw color or pixel literals", () => {
    const files = walkFiles(join(OVERLAY_ROOT, "src/styles/surfaces"), (path) => path.endsWith(".css"))
    const rawValue = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|(?<![\w-])-?\d+(?:\.\d+)?px\b/i
    for (const file of files) {
      expect(readText(file)).not.toMatch(rawValue)
    }
  })

  test("shared header surface is loaded after legacy styles while God CSS retires", () => {
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))
    const legacyAt = html.indexOf('href="styles.css"')
    const headerAt = html.indexOf('href="styles/surfaces/header.css"')
    expect(legacyAt).toBeGreaterThan(-1)
    expect(headerAt).toBeGreaterThan(legacyAt)

    for (const className of ["sidebar-header", "chat-header", "sections-header"]) {
      expect(html).toContain(`${className} oc-surface-header`)
    }

    const skillMarket = readText(join(OVERLAY_ROOT, "src/components/settings/SkillMarketPanel.tsx"))
    expect(count(/<SurfaceHeader/g, skillMarket)).toBe(3)

    const generalPanel = readText(join(OVERLAY_ROOT, "src/components/settings/GeneralPanel.tsx"))
    expect(count(/<SurfaceHeader/g, generalPanel)).toBe(2)
    expect(generalPanel).not.toContain("config-panel-group-title")

    const agentModelsPanel = readText(join(OVERLAY_ROOT, "src/components/settings/AgentModelsPanel.tsx"))
    expect(count(/<SurfaceHeader/g, agentModelsPanel)).toBe(1)
    expect(agentModelsPanel).not.toContain("config-panel-group-head")
    expect(agentModelsPanel).not.toContain("config-panel-group-title")

    const providersPanel = readText(join(OVERLAY_ROOT, "src/components/settings/ProvidersPanel.tsx"))
    expect(count(/<SurfaceHeader/g, providersPanel)).toBe(1)
    expect(providersPanel).not.toContain("config-panel-group-title")

    const agentWorkflowPanel = readText(join(OVERLAY_ROOT, "src/components/AgentWorkflowPanel.tsx"))
    expect(count(/<SurfaceHeader/g, agentWorkflowPanel)).toBe(1)
    expect(agentWorkflowPanel).not.toContain("agent-workflow-toolbar")
    expect(agentWorkflowPanel).not.toContain("agent-workflow-heading")
    expect(agentWorkflowPanel).not.toContain("agent-workflow-title")
  })

  test("config writers do not re-fetch config after updateConfig writes through the store", () => {
    const providersPanel = withoutComments(readText(join(OVERLAY_ROOT, "src/components/settings/ProvidersPanel.tsx")))
    const channelsPanel = withoutComments(readText(join(OVERLAY_ROOT, "src/components/settings/ChannelsPanel.tsx")))
    expect(providersPanel).not.toContain('apiJson("config")')
    expect(providersPanel).not.toContain('setAppStore("config"')
    expect(channelsPanel).not.toContain('apiJson("config")')
    expect(channelsPanel).not.toContain("loadConfigInfo")
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
    expect(Object.values(counts).reduce((total, value) => total + value, 0)).toBeLessThanOrEqual(0)
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
