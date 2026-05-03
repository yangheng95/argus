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
  for (const match of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
    const card = readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css"))

    expect(count(/!important\b/g, styles + "\n" + card)).toBeLessThanOrEqual(125)
    expect(count(/body\[data-theme/g, styles)).toBeLessThanOrEqual(62)
  })

  test("card stylesheet duplicate selector debt cannot increase", () => {
    const card = readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css"))

    expect(countDuplicateSelectors(card)).toBeLessThanOrEqual(6)
  })

  test("legacy theme selectors cannot keep gaining layout and chrome overrides", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    expect(countThemeLayoutOverrides(styles)).toBeLessThanOrEqual(28)
  })

  test("titlebar status pill and status-icon are owned by surfaces/titlebar.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    expect(styles).not.toMatch(/^\.titlebar-task-status\b/m)
    expect(styles).not.toMatch(/^\.status-icon\b/m)
    expect(titlebarSurface).toMatch(/\.titlebar-task-status\s*\{/)
    expect(titlebarSurface).toMatch(/\.titlebar-task-status\[data-status="active"\]/)
    expect(titlebarSurface).toMatch(/\.status-icon\s*\{/)
    expect(titlebarSurface).toMatch(/\.status-icon\[data-status="completed"\]/)
    expect(titlebarSurface).toContain("var(--oc-titlebar-status-radius)")
    expect(titlebarSurface).toContain("var(--oc-titlebar-status-icon)")
  })

  test("titlebar status chip and setup CTA are owned by surfaces/titlebar.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    expect(styles).not.toMatch(/^\.titlebar-status-chip\b/m)
    expect(styles).not.toMatch(/^\.titlebar-setup-cta\b/m)
    expect(styles).not.toMatch(/^\.titlebar-status-label\b/m)
    expect(styles).not.toMatch(/^\.titlebar-status-value\b/m)
    expect(titlebarSurface).toMatch(/\.titlebar-status-chip\s*\{/)
    expect(titlebarSurface).toMatch(/\.titlebar-setup-cta\s*\{/)
    expect(titlebarSurface).toMatch(/\.titlebar-status-label\s*\{/)
    expect(titlebarSurface).toMatch(/\.titlebar-status-value\s*\{/)
  })

  test("composer icon column is owned by surfaces/composer.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of ["chat-icon-col"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(composerSurface).toMatch(/\.chat-icon-col\[data-disabled="true"\]/)
    expect(composerSurface).toMatch(/\.chat-icon-col \.oc-button\[data-ui="chat-toolbar-button"\]/)
  })

  test("composer icon column chrome is not controlled by legacy theme selectors", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/\.chat-icon-col(?=$|[\s:{.#\[,>+~])/)
    }
  })

  test("sidebar task-row-mini + badge family are owned by surfaces/sidebar.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const sidebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css"))

    for (const className of [
      "task-row-mini",
      "task-row-drag-handle",
      "task-row-main",
      "task-row-head",
      "task-row-meta",
      "task-row-stamp",
      "task-row-badge",
      "task-row-badge-text",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(sidebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(sidebarSurface).toMatch(/\.task-row-badge::before\s*\{/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="active"\]/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="queued"\]/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="completed"\]/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="failed"\]/)
    expect(sidebarSurface).toMatch(
      /\.task-row-mini\[data-draggable="true"\]:hover \.task-row-drag-handle/,
    )
  })

  test("sidebar body + list family are owned by surfaces/sidebar.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const sidebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css"))

    for (const className of [
      "sidebar-body",
      "sidebar-footer",
      "sidebar-list",
      "task-list-panel",
      "sidebar-list-group",
      "sidebar-list-heading",
      "sidebar-list-cluster",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(sidebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(sidebarSurface).toMatch(/\.sidebar-footer a:hover\s*\{/)
    expect(sidebarSurface).toMatch(/\.sidebar-list\.session-list-panel\s*\{/)
  })

  test("sidebar shell + tool family are owned by surfaces/sidebar.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const sidebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of [
      "sidebar",
      "sidebar-toolset",
      "sidebar-tool",
      "sidebar-title",
      "sidebar-subtitle",
      "sidebar-header-actions",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(sidebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(sidebarSurface).toMatch(/\.sidebar\[data-collapsed="true"\]\s*\{/)
    expect(sidebarSurface).toMatch(/\.sidebar\[data-collapsed="true"\] \.sidebar-toggle svg/)

    const sidebarAt = html.indexOf('href="styles/surfaces/sidebar.css"')
    const stylesAt = html.indexOf('href="styles.css"')
    expect(sidebarAt).toBeGreaterThan(-1)
    expect(sidebarAt).toBeLessThan(stylesAt)
  })

  test("inspector right panel shell is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of [
      "sections",
      "sections-title",
      "sections-stack",
      "sections-tab-body",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(/\.sections-tab-body\[data-active="false"\]/)
    expect(inspectorSurface).toMatch(/\.sections-tab-body\[data-panel-tab="inspector"\]/)
    expect(inspectorSurface).toContain("var(--inspector-surface)")

    const inspectorAt = html.indexOf('href="styles/surfaces/inspector.css"')
    const stylesAt = html.indexOf('href="styles.css"')
    expect(inspectorAt).toBeGreaterThan(-1)
    expect(inspectorAt).toBeLessThan(stylesAt)
  })

  test("inspector preview tab + section icon button are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "section-icon-btn",
      "frontend-preview",
      "frontend-preview-toolbar",
      "frontend-preview-url",
      "frontend-preview-frame",
      "frontend-preview-empty",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(/\.section-icon-btn:hover,\s*\.section-icon-btn:focus-visible\s*\{/)
    expect(inspectorSurface).toMatch(/\.frontend-preview-empty\[data-kind="error"\]\s*\{/)
    expect(inspectorSurface).toContain("background: white")
    expect(inspectorSurface).toContain("var(--oc-border-width)")
  })

  test("section content rails (icon, title, badge, body, caret) are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "section-icon",
      "section-title",
      "section-badge",
      "section-head-action",
      "section-body",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(styles).not.toMatch(/(^|\n)\.section-head::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.section-head::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.section\[open\] > \.section-head::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.section-badge\[data-tone="(?:good|bad|warn|accent)"\](?:::before)?\s*\{/)
    expect(inspectorSurface).toMatch(/\.section-badge\[data-variant="metric"\]/)
    expect(inspectorSurface).toContain("var(--oc-radius-pill)")
  })

  test("section shell + head baseline are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const selector of ["section", "section-head"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${selector}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${selector}\\s*\\{`))
    }

    expect(styles).not.toMatch(/(^|\n)\.section:last-child\s*\{/)
    expect(inspectorSurface).toMatch(/\.section:last-child\s*\{/)
    expect(inspectorSurface).toMatch(/\.section-head::-webkit-details-marker\s*\{/)
    expect(inspectorSurface).toMatch(/\.section-head:hover\s*\{/)
    expect(inspectorSurface).toContain("color-mix(in srgb, white 3%, transparent)")
  })

  test("gwg actions + chevron + body + objective are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-action-btn",
      "gwg-chevron",
      "gwg-body",
      "gwg-objective",
      "gwg-objective-label",
      "gwg-objective-text",
      "gwg-done-definition",
      "gwg-done-definition-label",
      "gwg-done-definition-text",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(/\.gwg:hover \.gwg-action-btn,/)
    expect(inspectorSurface).toMatch(/\.gwg-action-delete:hover\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg--expanded \.gwg-chevron\s*\{/)
    expect(inspectorSurface).toContain("color-mix(in srgb, white 1.5%, transparent)")
  })

  test("task dir bar (TaskDirBar) is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    for (const className of [
      "task-meta",
      "task-cwd",
      "task-dir",
      "task-workspace",
      "task-workspace-row",
      "vcs-badge",
      "vcs-badge-icon",
      "vcs-badge-branch",
      "task-dir-shell",
      "task-cwd-dropdown",
      "task-cwd-caret",
      "task-dir-actions",
      "task-dir-path",
      "task-dir-tool",
      "task-dir-node",
      "task-dir-step",
      "task-dir-empty",
      "task-dir-editor",
      "task-dir-tool-label",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const tone of ["good", "warn", "bad"]) {
      expect(conversationSurface).toMatch(new RegExp(`\\.vcs-badge\\[data-tone="${tone}"\\]\\s*\\{`))
    }
    expect(conversationSurface).toMatch(/\.task-cwd-dropdown:hover,\s*\.task-cwd-dropdown:focus-visible\s*\{/)
    expect(conversationSurface).toMatch(/\.task-cwd-dropdown\[data-open="true"\]\s*\{/)
    expect(conversationSurface).toMatch(/\.task-dir-tool\.danger:hover\s*\{/)
    expect(conversationSurface).not.toMatch(/#94a3b8/)
    expect(conversationSurface).not.toMatch(/#e5e7eb/)
    expect(conversationSurface).not.toMatch(/rgba\(248,\s*113,\s*113/)
  })

  test("task bar, task status, task flag, and recent dir panel are owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    for (const className of [
      "task-bar",
      "task-bar-main",
      "task-status",
      "status-label",
      "task-flag",
      "recent-dir-panel",
      "recent-dir-row",
      "recent-dir-label",
      "recent-dir-path",
      "recent-dir-state",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    // task-bar must not appear in any theme selector in styles.css
    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue
      expect(selector).not.toMatch(/\.task-bar\b/)
    }

    // Canonical properties must use tokens, not raw values
    expect(conversationSurface).toContain("var(--oc-border-width)")
    expect(conversationSurface).toContain("var(--oc-radius-pill)")
    expect(conversationSurface).not.toMatch(/border-radius:\s*999px/)
    expect(conversationSurface).not.toMatch(/rgba\(116,\s*133,\s*184/)
    expect(conversationSurface).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.62\)/)

    expect(conversationSurface).toMatch(/\.task-bar:hover,\s*\.task-bar:focus-within\s*\{/)
    expect(conversationSurface).toMatch(/body\[data-theme="light"\] \.task-bar\s*\{/)
    expect(conversationSurface).toMatch(/body:is\(\[data-theme="dark"\][^)]*\) \.task-bar\s*\{/)
    expect(conversationSurface).toMatch(/\.recent-dir-panel::-webkit-scrollbar\s*\{/)
    expect(conversationSurface).toMatch(/\.recent-dir-row:hover\s*\{/)
    expect(conversationSurface).toMatch(/\.recent-dir-row\[data-active="true"\]\s*\{/)
  })

  test("executor chip and selector family are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "executor-selector",
      "executor-chip",
      "executor-chip-label",
      "executor-chip-sep",
      "executor-chip-model",
      "executor-chip-caret",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    // executor-chip must not appear in any theme selector in styles.css
    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue
      expect(selector).not.toMatch(/\.executor-chip\b/)
    }

    // Canonical properties must use tokens
    expect(composerSurface).toContain("var(--oc-border-width)")
    expect(composerSurface).toContain("var(--oc-radius-pill)")
    expect(composerSurface).not.toMatch(/border-radius:\s*999px/)

    expect(composerSurface).toMatch(/\.executor-chip:hover\s*\{/)
    expect(composerSurface).toMatch(/\.executor-selector\[data-open="true"\] \.executor-chip\s*\{/)
    expect(composerSurface).toMatch(/\.executor-chip-model\[data-source="executor"\]::before\s*\{/)
  })

  test("workspace panel, diff preview, and file view are owned by surfaces/workspace.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const workspaceSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of [
      "workspace-toggle",
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
      "diff-preview-panel",
      "diff-preview-head",
      "diff-preview-copy",
      "diff-preview-scope",
      "diff-preview-path",
      "diff-preview-meta",
      "diff-preview-body",
      "diff-preview-empty",
      "file-view-panel",
      "file-view-head",
      "file-view-path",
      "file-view-body",
      "file-view-empty",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(workspaceSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(styles).not.toMatch(/(^|\n)\.pane-resizer\.pane-resizer-workspace\s*\{/)
    expect(workspaceSurface).toMatch(/\.pane-resizer\.pane-resizer-workspace\s*\{/)
    expect(styles).not.toMatch(/(^|\n)code \.file-link\s*\{/)
    expect(workspaceSurface).toMatch(/code \.file-link\s*\{/)

    expect(workspaceSurface).toContain("var(--oc-border-width)")
    expect(workspaceSurface).toContain("var(--oc-radius-pill)")
    expect(workspaceSurface).not.toMatch(/border-radius:\s*999px/)
    expect(workspaceSurface).not.toMatch(/rgba\(/)
    expect(workspaceSurface).not.toMatch(/var\(--accent,\s*#/)

    const workspaceAt = html.indexOf('href="styles/surfaces/workspace.css"')
    const stylesAt = html.indexOf('href="styles.css"')
    expect(workspaceAt).toBeGreaterThan(-1)
    expect(workspaceAt).toBeLessThan(stylesAt)

    expect(workspaceSurface).toMatch(/\.workspace-toggle:hover\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-toggle\[aria-pressed="true"\]\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-mount\[hidden\]\s*\{/)
    expect(workspaceSurface).toMatch(/\.pane-resizer\.pane-resizer-workspace::before\s*\{/)
    expect(workspaceSurface).toMatch(/\.pane-resizer\.pane-resizer-workspace:hover::before/)
    expect(workspaceSurface).toMatch(/\.workspace-tabs::-webkit-scrollbar\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-tab:hover\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-tab\[data-active="true"\]\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-close:hover\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-view\[data-active="false"\]\s*\{/)
    expect(workspaceSurface).toMatch(/\.file-view-body pre\s*\{/)
    expect(workspaceSurface).toMatch(/code \.file-link:hover\s*\{/)
  })

  test("conn-banner cross-surface notification primitive routes through palette tokens", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    const block = styles.match(
      /\.conn-banner\s*\{[\s\S]*?\.conn-banner__action:focus-visible\s*\{[^}]*\}/,
    )?.[0]
    expect(block).toBeTruthy()
    const body = block ?? ""

    expect(body).toContain("var(--oc-radius-pill)")
    expect(body).toContain("var(--oc-border-width)")
    expect(body).not.toMatch(/border-radius:\s*999px/)
    expect(body).not.toMatch(/border:\s*1px solid/)
    expect(body).not.toMatch(/rgba\(0,\s*0,\s*0/)

    // Status variants must remain.
    expect(body).toMatch(/\.conn-banner\[data-status="connecting"\]\s*\{/)
    expect(body).toMatch(/\.conn-banner__dot\s*\{/)
    expect(body).toMatch(/@keyframes conn-banner-pulse\s*\{/)
  })

  test("shared .verdict-pill primitive routes verdict tones through palette tokens", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))

    const verdictBlock = styles.match(
      /\.verdict-pill\s*\{[\s\S]*?\.verdict-pill\[data-verdict="empty"\]\s*\{[^}]*\}/,
    )?.[0]
    expect(verdictBlock).toBeTruthy()

    const block = verdictBlock ?? ""
    expect(block).toContain("var(--oc-radius-pill)")
    expect(block).toContain("var(--oc-border-width)")

    expect(block).not.toMatch(/rgba\(95,\s*173,\s*86/)
    expect(block).not.toMatch(/rgba\(217,\s*158,\s*79/)
    expect(block).not.toMatch(/rgba\(247,\s*84,\s*100/)
    expect(block).not.toMatch(/rgba\(99,\s*162,\s*255/)
    expect(block).not.toMatch(/#63a2ff/)
    expect(block).not.toMatch(/border-radius:\s*999px/)

    for (const variant of [
      "pass",
      "accepted",
      "concerns",
      "needs_correction",
      "rejected",
      "inflight",
      "empty",
    ]) {
      expect(block).toContain(`data-verdict="${variant}"`)
    }
  })

  test("executor menu dropdown is owned by surfaces/composer.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "executor-menu",
      "executor-menu-group",
      "executor-menu-row",
      "executor-menu-current",
      "executor-menu-models",
      "executor-menu-model",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(composerSurface).toMatch(/\.executor-menu::-webkit-scrollbar\s*\{/)
    expect(composerSurface).toMatch(/\.executor-menu-row:hover:not\(:disabled\)\s*\{/)
    expect(composerSurface).toMatch(/\.executor-menu-group\[data-active="true"\] \> \.executor-menu-row\s*\{/)
    expect(composerSurface).toMatch(/\.executor-menu-model\[data-active="true"\]\s*\{/)
    expect(composerSurface).not.toMatch(/rgba\(146,\s*184,\s*252/)
    expect(composerSurface).not.toMatch(/rgba\(86,\s*126,\s*196/)
    expect(composerSurface).not.toMatch(/rgba\(196,\s*215,\s*252/)
  })

  test("prompt catalog is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "prompt-grid",
      "prompt-card",
      "prompt-card-copy",
      "prompt-textarea",
      "prompt-diff-details",
      "prompt-diff-summary",
      "prompt-preview-card",
      "prompt-preview-body",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).toMatch(/\.prompt-card-head,\s*\.prompt-toolbar\s*\{/)
    expect(settingsSurface).toMatch(/\.prompt-card-copy span,\s*\.prompt-card-copy small,\s*\.prompt-preview-head\s*\{/)
    expect(settingsSurface).toMatch(/\.prompt-diff-details\[open\] \> \.prompt-diff-summary::before\s*\{/)
    expect(settingsSurface).toMatch(/\.prompt-preview-card--default\s*\{/)
    expect(settingsSurface).toMatch(/\.prompt-preview-card--attached\s*\{/)
  })

  test("config-status-box and about panel are owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    // .config-status-box appears in a cross-surface multi-class
    // typography rule that shares font-size with .field-label /
    // .change-subline / .knowledge-item-meta — only assert it
    // lives in the surface, not that it's absent from styles.
    for (const className of [
      "about-body",
      "about-section",
      "about-section-title",
      "about-author-card",
      "about-author-avatar",
      "about-author-info",
      "about-author-name",
      "about-author-link",
      "about-info-grid",
      "about-info-label",
      "about-info-value",
      "about-links",
      "about-link",
      "about-shortcut-grid",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
    expect(settingsSurface).toMatch(/(^|\n)\.config-status-box\s*\{/)
    expect(() => soloRuleBody(styles, ".config-status-box")).toThrow()

    for (const status of ["active", "warn", "error"]) {
      expect(settingsSurface).toMatch(
        new RegExp(`\\.config-status-box\\[data-status="${status}"\\]\\s*\\{`),
      )
    }
    expect(settingsSurface).toMatch(/\.about-author-link:hover\s*\{/)
    expect(settingsSurface).toMatch(/\.about-link:hover\s*\{/)
    expect(settingsSurface).toMatch(/\.about-shortcut-grid kbd\s*\{/)
    expect(settingsSurface).toMatch(/\.about-shortcut-grid span\s*\{/)
  })

  test("settings section + subsection collapsibles are owned by surfaces/settings.css", () => {
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "config-section",
      "config-section-head",
      "config-section-body",
      "config-subsection",
      "config-subsection-head",
      "config-subsection-body",
      "ext-group",
      "ext-group-body",
    ]) {
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).toMatch(/\.config-section\[open\]\s*\{/)
    expect(settingsSurface).toMatch(/\.config-section:hover,\s*\.config-section:focus-within\s*\{/)
    expect(settingsSurface).toMatch(/\.config-section-head::before\s*\{/)
    expect(settingsSurface).toMatch(/\.config-section\[open\] \> \.config-section-head::before\s*\{/)
    expect(settingsSurface).toMatch(/\.config-subsection\[open\] \> \.config-subsection-head::before\s*\{/)
    expect(settingsSurface).toMatch(/\.ext-group \+ \.ext-group\s*\{/)
    expect(settingsSurface).not.toMatch(/rgba\(91,\s*141,\s*239/)
    // The `.config-section-head::before` chevron must use the
    // CSS-drawn border-right/border-bottom approach, not the
    // legacy "▸" Unicode glyph. Probe the rule body specifically.
    const sectionChevron = settingsSurface.match(
      /\.config-section-head::before\s*\{([^}]*)\}/,
    )?.[1] ?? ""
    expect(sectionChevron).not.toMatch(/content:\s*"▸"/)
    expect(sectionChevron).toContain('content: ""')

    // The solo `.config-section { border: 0 / radius / surface-inset }`
    // and its hover/[open] state rules must NOT also appear in
    // styles.css. We probe via soloRuleBody — the helper requires
    // the selector to start at column 0, which excludes multi-class
    // typography rules like `.dialog-title, .config-section-head`.
    expect(() => soloRuleBody(readText(join(OVERLAY_ROOT, "src/styles.css")), ".config-section")).toThrow()
    expect(() => soloRuleBody(readText(join(OVERLAY_ROOT, "src/styles.css")), ".config-subsection")).toThrow()
  })

  test("settings content panel + resizer are owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "config-content",
      "config-tab-panel",
      "config-resizer",
      "config-nav-spacer",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).toMatch(/\.config-tab-panel\.active\s*\{/)
    expect(settingsSurface).toMatch(/\.config-tab-panel \> \.config-section-body\s*\{/)
    expect(settingsSurface).toMatch(/\.config-content \.config-subsection\s*\{/)
    expect(settingsSurface).toMatch(
      /\.config-content \.extension-head,\s*\.config-content \.knowledge-toolbar\s*\{/,
    )
    expect(settingsSurface).toMatch(/\.config-resizer::before\s*\{/)
    expect(settingsSurface).toMatch(
      /\.config-resizer:hover::before,\s*\.config-resizer\[data-active="true"\]::before\s*\{/,
    )
  })

  test("settings dialog shell + sidebar nav are owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "config-dialog-form",
      "config-dialog-head",
      "config-close-btn",
      "config-sidebar",
      "config-nav-item",
      "config-nav-icon",
      "config-nav-badge",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).toMatch(/(^|\n)\.config-dialog-layout\s*\{/)
    const layoutBody =
      settingsSurface.match(/(^|\n)\.config-dialog-layout\s*\{([^}]*)\}/)?.[2] ?? ""
    expect(layoutBody).toContain("display: flex")
    expect(layoutBody).toContain("flex: 1")
    expect(layoutBody).toContain("overflow: hidden")

    expect(settingsSurface).toMatch(/\.config-close-btn:hover\s*\{/)
    expect(settingsSurface).toMatch(/\.config-nav-item\.active\s*\{/)
    expect(settingsSurface).toMatch(/\.config-nav-item\.active::before\s*\{/)
    expect(settingsSurface).toMatch(/\.config-nav-item\.active \.config-nav-icon\s*\{/)
    expect(settingsSurface).toMatch(/\.config-nav-item\.active \.config-nav-badge\s*\{/)
    expect(settingsSurface).not.toMatch(/rgba\(84,\s*138,\s*247,\s*0\.15\)/)
    expect(settingsSurface).not.toMatch(/rgba\(84,\s*138,\s*247,\s*0\.2\)/)
  })

  test("log viewer is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "log-level-select",
      "log-viewer",
      "log-path",
      "log-line",
      "log-line-head",
      "log-level",
      "log-level-debug",
      "log-level-info",
      "log-level-warn",
      "log-level-error",
      "log-ts",
      "log-delta",
      "log-service",
      "log-msg",
      "log-fields",
      "log-chip",
      "log-detail",
      "log-detail-title",
      "log-detail-pre",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).toMatch(/\.log-detail-block \+ \.log-detail-block\s*\{/)
    expect(settingsSurface).toMatch(/\.log-detail \> summary\s*\{/)
    expect(settingsSurface).not.toMatch(/var\(--good,\s*#3fb950\)/)
    expect(settingsSurface).not.toMatch(/var\(--accent,\s*#58a6ff\)/)
    expect(settingsSurface).not.toMatch(/var\(--warn,\s*#d29922\)/)
    expect(settingsSurface).not.toMatch(/var\(--bad,\s*#f85149\)/)
    expect(settingsSurface).not.toMatch(/var\(--border-subtle,\s*rgba/)
  })

  test("channel docs + market cards are owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "channel-row-actions",
      "channel-doc-card",
      "channel-doc-copy",
      "channel-doc-title",
      "channel-doc-credit",
      "market-card",
      "market-card-main",
      "market-card-actions",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(styles).not.toMatch(/(^|\n)#channelFields\s*\{/)
    expect(settingsSurface).toMatch(/#channelFields\s*\{/)
    expect(settingsSurface).toMatch(/\.market-card \+ \.market-card\s*\{/)
    expect(settingsSurface).toMatch(/\.market-card-main strong\s*\{/)
    expect(settingsSurface).toMatch(/\.market-card-main span,\s*\.market-card-main small\s*\{/)

    const channelDocBody =
      settingsSurface.match(/(^|\n)\.channel-doc-card\s*\{([^}]*)\}/)?.[2] ?? ""
    expect(channelDocBody).toContain("transition:")
    expect(channelDocBody).toContain("border: 0")

    const marketCardBody = settingsSurface.match(/(^|\n)\.market-card\s*\{([^}]*)\}/)?.[2] ?? ""
    expect(marketCardBody).not.toMatch(/border:/)
    expect(marketCardBody).not.toMatch(/border-radius:/)
    expect(marketCardBody).not.toMatch(/background:/)
  })

  test("extensions panel block + row is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "extension-block",
      "extension-head",
      "extension-list",
      "extension-row",
      "extension-row-main",
      "extension-row-actions",
      "extension-policy",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).toMatch(/\.extension-head:hover,\s*\.extension-head:focus-within\s*\{/)
    expect(settingsSurface).toMatch(/\.extension-block \+ \.extension-block\s*\{/)
    expect(settingsSurface).toMatch(/\.extension-row span,\s*\.extension-row small\s*\{/)
    expect(settingsSurface).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.04\)/)
  })

  test("knowledge / memory panel is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "knowledge-toolbar",
      "knowledge-search",
      "knowledge-list",
      "knowledge-item",
      "knowledge-item-main",
      "knowledge-item-title",
      "knowledge-item-meta",
      "knowledge-item-actions",
      "knowledge-delete",
      "knowledge-scope",
      "memory-detail-meta",
      "memory-detail-content",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).toMatch(/\.knowledge-toolbar:hover,\s*\.knowledge-toolbar:focus-within\s*\{/)
    expect(settingsSurface).toMatch(/\.knowledge-search:focus\s*\{/)
    expect(settingsSurface).toMatch(/\.knowledge-search::placeholder\s*\{/)
    expect(settingsSurface).toMatch(/\.knowledge-item\[data-mode="search"\]/)
    for (const variant of ["global", "session"]) {
      expect(settingsSurface).toMatch(
        new RegExp(`\\.knowledge-scope\\[data-scope="${variant}"\\]`),
      )
    }
    expect(settingsSurface).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.04\)/)
  })

  test("permissions panel is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of [
      "perm-panel",
      "perm-panel-intro",
      "perm-list",
      "perm-row",
      "perm-row-info",
      "perm-row-label",
      "perm-row-desc",
      "perm-row-actions",
      "perm-action-btn",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const action of ["allow", "ask", "deny"]) {
      expect(settingsSurface).toMatch(
        new RegExp(`\\.perm-action-btn\\[data-active="true"\\]\\[data-action="${action}"\\]\\s*\\{`),
      )
    }

    expect(settingsSurface).toMatch(/\.perm-action-btn:focus-visible\s*\{/)
    expect(settingsSurface).toContain("var(--oc-border-width)")

    const settingsAt = html.indexOf('href="styles/surfaces/settings.css"')
    const stylesAt = html.indexOf('href="styles.css"')
    expect(settingsAt).toBeGreaterThan(-1)
    expect(settingsAt).toBeLessThan(stylesAt)
  })

  test("architect panel is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "arch-panel",
      "arch-overview",
      "arch-summary",
      "arch-count",
      "arch-count-label",
      "arch-categories",
      "arch-cat-badge",
      "arch-detail",
      "arch-decisions",
      "arch-decision",
      "arch-decision-head",
      "arch-decision-key",
      "arch-decision-goal",
      "arch-decision-value",
      "arch-decision-reason",
      "arch-generating",
      "arch-generating-label",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
  })

  test("integrity panel is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "integrity",
      "integrity__header",
      "integrity__attempts",
      "integrity__summary",
      "integrity__section",
      "integrity__section-title",
      "integrity__list",
      "integrity__dimension",
      "integrity__dimension-name",
      "integrity__dimension-counts",
      "integrity__issue-desc",
      "integrity__tag",
      "integrity__correction-head",
      "integrity__correction-reason",
      "integrity__goal-id",
      "integrity__diff",
      "integrity__missing-title",
      "integrity__missing-objective",
      "integrity__missing-reason",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const verdict of ["pass", "concerns", "needs_correction"]) {
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.integrity__dimension\\[data-verdict="${verdict}"\\]\\s*\\{`),
      )
    }

    for (const action of ["modify", "split", "remove"]) {
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.integrity__tag\\[data-action="${action}"\\]\\s*\\{`),
      )
    }

    expect(inspectorSurface).toMatch(/\.integrity__diff dt\s*\{/)
    expect(inspectorSurface).toMatch(/\.integrity__diff dd\s*\{/)
  })

  test("requirements panel is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "req-panel",
      "req-list",
      "req-item",
      "req-item-main",
      "req-index",
      "req-item-meta",
      "req-desc",
      "req-priority",
      "req-streaming",
      "req-streaming-indicator",
      "req-streaming-label",
      "req-streaming-messages",
      "req-spec-detail",
      "req-spec-content",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const variant of ["explicit", "inferred", "system"]) {
      expect(inspectorSurface).toMatch(new RegExp(`\\.req-type--${variant}\\s*\\{`))
    }
    for (const variant of ["passed", "failed", "pending"]) {
      expect(inspectorSurface).toMatch(new RegExp(`\\.req-status--${variant}\\s*\\{`))
    }
    expect(inspectorSurface).toMatch(/\.req-spec-detail \> summary\s*\{/)
    expect(inspectorSurface).toMatch(/\.req-streaming-messages::-webkit-scrollbar\s*\{/)
  })

  test("gwg checks list is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-checks",
      "gwg-check",
      "gwg-check-icon",
      "gwg-check-name",
      "gwg-check-evidence",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const status of ["passed", "failed", "pending"]) {
      expect(styles).not.toMatch(
        new RegExp(`(^|\\n)\\.gwg-check--${status}(?:\\s+\\.gwg-check-(?:icon|name))?\\s*\\{`),
      )
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.gwg-check--${status}(?:\\s+\\.gwg-check-(?:icon|name))?\\s*\\{`),
      )
    }

    expect(inspectorSurface).toMatch(/\.gwg-check \+ \.gwg-check\s*\{/)
    expect(inspectorSurface).not.toMatch(/clamp\([^,]*,\s*calc\(10px/)
  })

  test("gwg step body, plan nodes, diff stats, verdict are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-step-body",
      "gwg-plan-nodes",
      "gwg-plan-node",
      "gwg-plan-node-title",
      "gwg-plan-node-brief",
      "gwg-changed-files",
      "gwg-diff-stats",
      "gwg-diff-additions",
      "gwg-diff-deletions",
      "gwg-changed-file",
      "gwg-open-session",
      "gwg-open-session-btn",
      "gwg-verdict",
      "gwg-eval-summary",
      "gwg-step-messages",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const variant of ["accepted", "rejected", "inconclusive"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.gwg-verdict--${variant}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`\\.gwg-verdict--${variant}\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(/\.gwg-plan-node::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg-step-messages::-webkit-scrollbar\s*\{/)
    expect(inspectorSurface).not.toMatch(/rgba\(95,\s*173,\s*86/)
    expect(inspectorSurface).not.toMatch(/rgba\(212,\s*167,\s*44/)
  })

  test("gwg step row family is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-step",
      "gwg-step-icon",
      "gwg-step-label",
      "gwg-step-summary",
      "gwg-step-status",
      "gwg-step-detail",
      "gwg-step-count",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const status of ["pending", "running", "done", "failed", "skipped"]) {
      expect(styles).not.toMatch(
        new RegExp(`(^|\\n)\\.gwg-step--${status}(?:\\s+\\.gwg-step-(?:icon|label|status))?\\s*\\{`),
      )
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.gwg-step--${status}(?:\\s+\\.gwg-step-(?:icon|label|status))?\\s*\\{`),
      )
    }

    expect(inspectorSurface).toMatch(/\.gwg-step-detail \> \.gwg-step:hover\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg-step-detail \> \.gwg-step::-webkit-details-marker,/)
    expect(inspectorSurface).not.toMatch(/clamp\(10px,/)
    expect(inspectorSurface).not.toMatch(/rgba\(84,\s*138,\s*247,\s*0\.4\)/)
    expect(inspectorSurface).not.toMatch(/rgba\(247,\s*84,\s*100,\s*0\.35\)/)
  })

  test("gwg header + status icon are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-header",
      "gwg-title-row",
      "gwg-header-actions",
      "gwg-status-icon",
      "gwg-title",
      "gwg-revision",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(/\.gwg-header:focus-visible\s*\{/)
    for (const variant of ["passed", "failed", "running"]) {
      expect(styles).not.toMatch(
        new RegExp(`(^|\\n)\\.gwg--${variant} \\.gwg-status-icon\\s*\\{`),
      )
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.gwg--${variant} \\.gwg-status-icon\\s*\\{`),
      )
    }
    expect(inspectorSurface).not.toMatch(/clamp\(10px,/)
    expect(inspectorSurface).toMatch(
      /\.gwg-revision[\s\S]*?border-radius:\s*var\(--oc-radius-pill\)/,
    )
  })

  test("gwg shell + status modifiers are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    expect(styles).not.toMatch(/(^|\n)\.gwg\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.gwg::before\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.gwg:hover\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg:hover\s*\{/)

    for (const modifier of ["expanded", "passed", "failed", "running"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.gwg--${modifier}(?:::before)?\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`\\.gwg--${modifier}(?:::before)?\\s*\\{`))
    }

    expect(inspectorSurface).not.toMatch(/#c3d2ee/)
    expect(inspectorSurface).toMatch(/\.gwg--passed::before[\s\S]*?var\(--text-soft\)/)
    expect(inspectorSurface).toContain("color-mix(in srgb, black 12%, transparent)")
  })

  test("criteria group baseline is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "criteria-group",
      "criteria-group-head",
      "criteria-group-icon",
      "criteria-group-title",
      "criteria-group-count",
      "criteria-group-list",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(/\.criteria-group-icon svg\s*\{/)
  })

  test("delivery panel chrome is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    expect(styles).not.toMatch(/(^|\n)\.delivery-panel\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.delivery-panel::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.delivery-panel\s*\{/)
    expect(inspectorSurface).toMatch(/\.delivery-panel::before\s*\{/)

    for (const verdict of ["accepted", "rejected", "inflight", "empty"]) {
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.delivery-panel\\[data-verdict="${verdict}"\\]`),
      )
    }

    expect(inspectorSurface).toMatch(/--delivery-panel-accent: var\(--good\)/)
    expect(inspectorSurface).toMatch(/--delivery-panel-accent: var\(--bad\)/)
    expect(inspectorSurface).not.toMatch(/#63a2ff/)
  })

  test("eval error + summary chrome is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "eval-error",
      "eval-error-name",
      "eval-error-meta",
      "eval-error-detail",
      "eval-summary",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(/\.eval-error \+ \.eval-error\s*\{/)
    expect(inspectorSurface).not.toMatch(/rgba\(224,\s*106,\s*99/)
    expect(inspectorSurface).toContain("color-mix(in srgb, var(--bad)")
  })

  test("section phase-state variants are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const variant of ["related", "active"]) {
      expect(styles).not.toMatch(new RegExp(`\\.section\\[data-phase-state="${variant}"\\]\\s*\\{`))
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.section\\[data-phase-state="${variant}"\\]\\s*\\{`),
      )
    }

    expect(inspectorSurface).toMatch(
      /\.section\[data-phase-state="active"\] \.section-badge:not\(:empty\)::before\s*\{/,
    )
    expect(inspectorSurface).toContain("color-mix(in srgb, black 10%, transparent)")
    expect(inspectorSurface).not.toMatch(/rgba\(91,\s*141,\s*239/)
    expect(inspectorSurface).not.toMatch(/rgba\(10,\s*16,\s*24/)
  })

  test("conversation goals strip is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    for (const className of ["chat-goals-strip", "goal-chip"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(conversationSurface).toMatch(/\.chat-goals-strip:empty\s*\{/)
    expect(conversationSurface).toMatch(/\.goal-chip\[data-status="passed"\]/)
    expect(conversationSurface).toMatch(/\.goal-chip\[data-status="failed"\]/)
    expect(conversationSurface).toMatch(/\.goal-chip\[data-status="in_progress"\]/)
  })

  test("conversation header + task-switch progress are owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    for (const className of [
      "task-switch-progress",
      "chat-header-main",
      "chat-title",
      "chat-header-status",
      "chat-task-status",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(conversationSurface).toMatch(/@keyframes task-switch-progress-slide/)
    expect(conversationSurface).toMatch(/\.task-switch-progress::before/)
    expect(conversationSurface).toMatch(/\.chat-header-meta\s*\{/)
    expect(conversationSurface).toMatch(/\.chat-count\s*\{/)
  })

  test("conversation chat-scroll is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    expect(styles).not.toMatch(/(^|\n)\.chat-scroll\s*\{/)
    expect(conversationSurface).toMatch(/(^|\n)\.chat-scroll\s*\{/)
    expect(conversationSurface).toMatch(/\.chat-scroll > \.card,\n\.chat-scroll > \.interaction-card/)
    expect(conversationSurface).toMatch(/@media \(max-width: 900px\)/)
  })

  test("conversation chat-empty task-children are owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    for (const className of [
      "chat-empty-marker",
      "chat-empty-copy",
      "chat-empty-kicker",
      "chat-empty-title",
      "chat-empty-meta",
      "chat-empty-status",
      "chat-empty-path",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(conversationSurface).toMatch(/\.chat-empty-status::before\s*\{/)
    expect(conversationSurface).toMatch(/\.chat-empty-status\[data-status="queued"\]/)
    expect(conversationSurface).toMatch(
      /\.chat-empty--task \.chat-empty-marker \.chat-empty-icon\s*\{/,
    )
  })

  test("conversation chat-empty placeholder is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of ["chat-empty", "chat-empty-icon", "chat-empty-text", "chat-follow-label"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(html).toContain('href="styles/surfaces/conversation.css"')
    const conversationAt = html.indexOf('href="styles/surfaces/conversation.css"')
    const stylesAt = html.indexOf('href="styles.css"')
    expect(conversationAt).toBeGreaterThan(-1)
    expect(stylesAt).toBeGreaterThan(-1)
    expect(conversationAt).toBeLessThan(stylesAt)
  })

  test("composer build/version row and reflow are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "chat-build",
      "chat-version",
      "chat-version-link",
      "chat-version-sep",
      "chat-compose-tip",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(composerSurface).toMatch(/@container \(max-width: 520px\)/)
    expect(composerSurface).toMatch(/@media \(max-width: 700px\)/)
    expect(composerSurface).toMatch(/\.chat-send-icon svg\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.chat-send-icon svg\s*\{/)
  })

  test("composer attachments and compose row/meta are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "chat-attachments",
      "chat-attachment-item",
      "chat-attachment-thumb",
      "chat-attachment-icon",
      "chat-attachment-name",
      "chat-attachment-remove",
      "chat-compose-row",
      "chat-compose-meta",
      "chat-compose-meta-left",
      "chat-compose-meta-right",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(composerSurface).toMatch(/\.chat-attachment-remove:hover\s*\{/)
    expect(composerSurface).toMatch(/\.chat-input\[data-dragover\]\s+\.chat-compose-row\s*\{/)
    expect(composerSurface).toMatch(/\.chat-compose-meta-left a:hover\s*\{/)
  })

  test("composer chat-send and chat-interrupt are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of ["chat-send", "chat-interrupt", "chat-send-icon", "chat-send-label"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(styles).not.toMatch(/(^|\n)\.chat-send:hover\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.chat-send:disabled\s*\{/)
    expect(styles).not.toMatch(/body\[data-theme="light"\] \.chat-send\b/)
    expect(styles).not.toMatch(/body:is\([^)]*\) \.chat-send\b/)
    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.chat-send\b/.test(selector)) continue

      expect(selector).not.toMatch(/\.chat-send\b/)
    }
    expect(composerSurface).toMatch(/\.chat-send:hover\s*\{/)
    expect(composerSurface).toMatch(/\.chat-send:disabled\s*\{/)
    expect(composerSurface).toMatch(/\.chat-send:focus-visible\s*\{/)
    expect(composerSurface).toMatch(/\.chat-interrupt:hover\s*\{/)
  })

  test("composer chat-textarea family is owned by surfaces/composer.css", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "chat-textarea",
      "chat-textarea-wrap",
      "chat-placeholder-float",
      "chat-placeholder-text",
      "chat-placeholder-caret",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(styles).not.toMatch(/(^|\n)\.chat-textarea:focus\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.chat-textarea\[data-expanded="true"\]\s*\{/)
    expect(styles).not.toMatch(/body\[data-theme="light"\] \.chat-textarea\b/)
    expect(styles).not.toMatch(/body:is\([^)]*\) \.chat-textarea\b/)
    expect(composerSurface).toMatch(/\.chat-textarea:focus\s*\{/)
    expect(composerSurface).toMatch(/\.chat-textarea\[data-expanded="true"\]\s*\{/)
    expect(composerSurface).toMatch(/\.chat-textarea::placeholder\s*\{/)
  })

  test("composer chat-input shell is owned by surfaces/composer.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    expect(styles).not.toMatch(/(^|\n)\.chat-input\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.chat-input:focus-within\s*\{/)
    expect(composerSurface).toMatch(/(^|\n)\.chat-input\s*\{/)
    expect(composerSurface).toMatch(/\.chat-input:focus-within\s*\{/)
  })

  test("dead static composer toolbar button classes stay retired", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const composerSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css")),
    )
    const combined = `${styles}\n${composerSurface}`

    expect(combined).not.toMatch(/(^|\n)\.chat-toolbar-btn\b/)
    expect(combined).not.toMatch(/(^|\n)\.chat-cancel-btn\b/)
  })

  test("titlebar theme picker is owned by surfaces/titlebar.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))
    const tokenText = readText(join(OVERLAY_ROOT, "src/styles/tokens/design-language.css"))

    for (const className of [
      "titlebar-theme-options",
      "titlebar-theme-option",
      "titlebar-theme-option-label",
      "titlebar-theme-option-swatch",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(titlebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const swatch of ["dark", "light", "vscode-dark", "system"]) {
      expect(titlebarSurface).toMatch(
        new RegExp(`\\.titlebar-theme-option-swatch\\[data-theme="${swatch}"\\]`),
      )
      expect(tokenText).toMatch(new RegExp(`--oc-theme-swatch-${swatch}\\s*:`))
    }
  })

  test("brand-guide family is owned by surfaces/titlebar.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of [
      "brand-guide",
      "brand-guide-card",
      "brand-guide-kicker",
      "brand-guide-section",
      "brand-guide-title",
      "brand-guide-copy",
      "brand-guide-steps",
      "brand-guide-step",
      "brand-guide-step-index",
      "brand-guide-step-copy",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(titlebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(titlebarSurface).toMatch(/\.brand-guide-card::before\s*\{/)
    expect(titlebarSurface).toMatch(/\.brand-guide-card::after\s*\{/)
    expect(titlebarSurface).toMatch(/var\(--oc-radius-pill\)/)
  })

  test("titlebar layout containers and connection badge are owned by surfaces/titlebar.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of [
      "titlebar-nav",
      "titlebar-nav-group",
      "titlebar-utility",
      "titlebar-actions",
      "titlebar-status-cluster",
      "titlebar-window-controls",
      "conn-badge",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(titlebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
  })

  test("dead static titlebar window button classes stay retired", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const titlebarSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")),
    )
    const combined = `${styles}\n${titlebarSurface}`

    expect(combined).not.toMatch(/(^|\n)\.titlebar-btn\b/)
    expect(combined).not.toMatch(/(^|\n)\.titlebar-close\b/)
  })

  test("titlebar shell and brand layout are owned by surfaces/titlebar.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of [
      "titlebar",
      "titlebar-left",
      "titlebar-brand",
      "titlebar-spacer",
      "brand-logo",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(titlebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(titlebarSurface).toMatch(/\.titlebar::after\s*\{/)
  })

  test("migrated titlebar chrome is not controlled by legacy theme selectors", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const migratedTitlebarClasses = [
      "titlebar",
      "titlebar-menubar-trigger",
      "titlebar-status-chip",
      "titlebar-setup-cta",
      "titlebar-status-icon",
      "titlebar-task-status",
      "brand-guide",
    ]

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector) continue

      for (const className of migratedTitlebarClasses) {
        expect(selector).not.toMatch(
          new RegExp(`\\.${className}(?=$|[\\s:{.#\\[,>+~])`),
        )
      }
    }
  })

  test("titlebar menubar family is owned by surfaces/titlebar.css", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of [
      "titlebar-menubar",
      "titlebar-menubar-slot",
      "titlebar-menubar-trigger",
      "titlebar-menubar-panel",
      "titlebar-menubar-group",
      "titlebar-menubar-group-title",
      "titlebar-menubar-item",
      "titlebar-menubar-toggle",
      "titlebar-menubar-range",
      "titlebar-menubar-note",
      "titlebar-menubar-item-title",
      "titlebar-menubar-item-meta",
      "titlebar-menubar-range-copy",
      "titlebar-theme-options-menubar",
    ]) {
      expect(styles).not.toMatch(new RegExp(`^\\.${className}\\b`, "m"))
      expect(titlebarSurface).toMatch(new RegExp(`\\.${className}\\b`))
    }
  })

  test("bold font-weight declarations cannot increase across overlay stylesheets", () => {
    const sources = [
      readText(join(OVERLAY_ROOT, "src/styles.css")),
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/primitives"), (path) =>
        path.endsWith(".css"),
      ).map(readText),
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/surfaces"), (path) =>
        path.endsWith(".css"),
      ).map(readText),
    ]
    const text = sources.join("\n")
    const boldDecls = count(/font-weight\s*:\s*(?:700|720|750|760|780|800|900|bold)\b/g, text)
    expect(boldDecls).toBeLessThanOrEqual(37)
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
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/delivery-panel/)
    }

    expect(inspectorSurface).toMatch(
      /\.delivery-panel::before\s*\{[^}]*background:\s*var\(--delivery-panel-accent\)/,
    )
    expect(inspectorSurface).not.toMatch(/\.delivery-panel\s*\{[^}]*border-left\s*:/)
  })

  test("evaluation errors keep semantic error chrome outside theme resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/eval-error/)
    }

    const evalErrorBody = inspectorSurface.match(/\.eval-error\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(evalErrorBody).toContain("background:")
    expect(evalErrorBody).toContain("linear-gradient")
    expect(evalErrorBody).toContain("color-mix(in srgb, var(--bad)")
    expect(evalErrorBody).toContain("border: 0")
  })

  test("settings document/detail cards do not rely on theme chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const source of [styles, settingsSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
        if (!isThemeSelector) continue

        expect(selector).not.toMatch(/(?:channel-doc-card|detail-card)/)
      }
    }

    const channelDocBody =
      settingsSurface.match(/\.channel-doc-card\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(channelDocBody).toContain("background: var(--surface-inset)")
    expect(channelDocBody).toContain("border: 0")

    const detailCardBody = styles.match(/\.detail-card\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(detailCardBody).toContain("background: var(--surface-inset)")
    expect(detailCardBody).toContain("border: 0")
  })

  test("settings extension rows do not rely on theme or local important chrome resets", () => {
    const styles = readText(join(OVERLAY_ROOT, "src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const source of [styles, settingsSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
    }

    const body = settingsSurface.match(/\.extension-row\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(body).toContain("background: var(--surface-inset)")
    expect(body).toContain("border: 0")
  })

  test("settings config containers do not rely on theme or local important chrome resets", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const settingsSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css")))

    for (const source of [styles, settingsSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const hasConfigContainer = /(?:^|\s|:is\([^)]*)\.config-(?:section|subsection)(?:\b|[:.[#])/.test(
          selector,
        )
        if (!hasConfigContainer) continue

        const isThemeSelector =
          /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
        const usesChromeImportant =
          /(background|border|border-color|border-radius|box-shadow):\s*[^;]*!important/.test(body)

        expect(isThemeSelector).toBe(false)
        expect(usesChromeImportant).toBe(false)
      }
    }

    for (const selector of [".config-section", ".config-subsection"]) {
      const body = soloRuleBody(settingsSurface, selector)
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

    const composerSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css")),
    )
    const body = soloRuleBody(composerSurface, ".chat-input")
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
    const titlebarSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")))

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

    expect(styles).not.toMatch(/(^|\n)\.titlebar\s*\{/)
    const body = soloRuleBody(titlebarSurface, ".titlebar")
    for (const declaration of [
      "gap: calc(2px * var(--ui-scale))",
      "margin: 0",
      "padding: calc(2px * var(--ui-scale)) calc(4px * var(--ui-scale))",
      "border: var(--oc-border-width) solid var(--border)",
      "border-left: 0",
      "border-right: 0",
      "border-radius: 0",
      "box-shadow: none",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("directory, sidebar, and workspace controls are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const surfaceTexts = [
      "src/styles/surfaces/conversation.css",
      "src/styles/surfaces/sidebar.css",
      "src/styles/surfaces/workspace.css",
    ].map((path) => withoutComments(readText(join(OVERLAY_ROOT, path))))

    for (const source of [styles, ...surfaceTexts]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
          selector,
        )
        const hasHeaderControl =
          /\.(?:task-dir-shell|task-cwd-dropdown|sidebar-toolset|sidebar-tool|workspace-toggle)\b/.test(selector)
        if (!isThemeSelector || !hasHeaderControl) continue

        expect(selector).not.toMatch(
          /\.(?:task-dir-shell|task-cwd-dropdown|sidebar-toolset|sidebar-tool|workspace-toggle)\b/,
        )
      }
    }

    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("gap: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("padding: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("border: var(--oc-border-width) solid var(--oc-control-border)")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("border-radius: var(--oc-radius-control)")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("background: var(--oc-control-bg)")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell.task-cwd-dropdown")).toContain(
      "padding-inline: calc(2px * var(--ui-scale))",
    )
    expect(soloRuleBody(conversationSurface, ".task-dir-shell.task-cwd-dropdown")).toContain(
      "padding-block: calc(2px * var(--ui-scale))",
    )
    const sidebarSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css")),
    )
    expect(soloRuleBody(sidebarSurface, ".sidebar-toolset")).toContain("gap: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(sidebarSurface, ".sidebar-toolset")).toContain("padding: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(sidebarSurface, ".sidebar-toolset")).toContain("border: var(--oc-border-width) solid var(--oc-control-border)")
    expect(soloRuleBody(sidebarSurface, ".sidebar-toolset")).toContain("border-radius: var(--oc-radius-control)")
    expect(soloRuleBody(sidebarSurface, ".sidebar-toolset")).toContain("background: var(--oc-control-bg)")
    expect(soloRuleBody(sidebarSurface, ".sidebar-tool")).toContain("border-radius: var(--oc-radius-control)")
    expect(soloRuleBody(sidebarSurface, ".sidebar-tool")).toContain("border: var(--oc-border-width) solid transparent")
    const workspaceSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))
    expect(soloRuleBody(workspaceSurface, ".workspace-toggle")).toContain("border-radius: var(--oc-radius-control)")
    expect(soloRuleBody(workspaceSurface, ".workspace-toggle")).toContain("border: var(--oc-border-width) solid transparent")
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
    const conversationSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")),
    )

    // No theme selector in styles.css may set layout/chrome on .task-bar
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

    // Canonical .task-bar rule must live in conversation.css
    expect(styles).not.toMatch(/(^|\n)\.task-bar\s*\{/)
    const body = soloRuleBody(conversationSurface, ".task-bar")
    for (const declaration of [
      "margin: 0",
      "padding: 0 calc(6px * var(--ui-scale))",
      "border-bottom:",
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

    const sidebarSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css")),
    )
    const inspectorSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css")),
    )
    for (const [selector, source] of [
      [".sidebar", sidebarSurface],
      [".chat", styles],
      [".sections", inspectorSurface],
    ] as const) {
      const body = soloRuleBody(source, selector)
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
    const inspectorSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css")),
    )

    for (const source of [styles, inspectorSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
          selector,
        )
        if (!isThemeSelector || !/\.(?:workspace-main|sections-stack)\b/.test(selector)) continue

        expect(body).not.toMatch(/\b(?:gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:/)
      }
    }

    const workspaceBodies = Array.from(styles.matchAll(/(^|\n)\.workspace-main\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const workspaceBody = workspaceBodies.at(-1) ?? ""
    for (const declaration of ["gap: 0", "margin: 0", "padding: 0"]) {
      expect(workspaceBody).toContain(declaration)
    }

    const sectionsBodies = Array.from(
      inspectorSurface.matchAll(/(^|\n)\.sections-stack\s*\{([^{}]*)\}/g),
    ).map((match) => match[2] ?? "")
    const sectionsBody = sectionsBodies.at(-1) ?? ""
    expect(sectionsBody).toContain("gap: calc(4px * var(--ui-scale))")
    expect(sectionsBody).toContain("padding: calc(4px * var(--ui-scale))")
  })

  test("right panel card radius and body padding are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const inspectorSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css")),
    )

    for (const source of [styles, inspectorSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
    }

    expect(soloRuleBody(inspectorSurface, ".section")).toContain(
      "border-radius: calc(5px * var(--ui-scale))",
    )
    expect(soloRuleBody(inspectorSurface, ".gwg")).toContain(
      "border-radius: calc(5px * var(--ui-scale))",
    )

    expect(soloRuleBody(inspectorSurface, ".section-body")).toContain(
      "padding: 0 calc(6px * var(--ui-scale)) calc(6px * var(--ui-scale))",
    )
    expect(soloRuleBody(inspectorSurface, ".gwg-body")).toContain(
      "padding: 0 calc(6px * var(--ui-scale)) calc(6px * var(--ui-scale))",
    )
  })

  test("board intro density and typography are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const card = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css")))

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
    const conversationSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")),
    )

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.chat-scroll\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:padding(?:-[a-z]+)?|background|border(?:-[a-z]+)?|box-shadow)\s*:/)
    }

    const bodies = Array.from(
      conversationSurface.matchAll(/(^|\n)\.chat-scroll\s*\{([^{}]*)\}/g),
    ).map((match) => match[2] ?? "")
    const body = bodies.at(-1) ?? ""
    expect(body).toContain(
      "padding: calc(18px * var(--ui-scale)) calc(22px * var(--ui-scale)) calc(20px * var(--ui-scale))",
    )
  })

  test("conversation auxiliary surfaces keep chrome out of theme selectors", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const workspaceSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")),
    )

    for (const source of [styles, workspaceSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
          selector,
        )
        if (!isThemeSelector || !/\.(?:chat-goals-strip|workspace-mount)\b/.test(selector)) continue

        expect(body).not.toMatch(/\b(?:background|border(?:-[a-z]+)?|box-shadow)\s*:/)
      }
    }

    expect(soloRuleBody(workspaceSurface, ".workspace-mount")).toContain("background: var(--surface-inset)")
  })

  test("chat task-switch progress overlays the header instead of creating a hidden gap", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const conversationSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")),
    )
    const chatBody = soloRuleBody(styles, ".chat")
    const progressBody = soloRuleBody(conversationSurface, ".task-switch-progress")

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
      "--oc-titlebar-status-radius",
      "--oc-titlebar-status-icon",
    ]) {
      expect(tokenText).toContain(token)
    }
  })

  test("icon button padding is canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const titlebarSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")),
    )
    const composerSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css")),
    )
    const combined = `${styles}\n${titlebarSurface}\n${composerSurface}`
    const iconButtonClasses = [".titlebar-status-icon"]

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
        combined.matchAll(new RegExp(`(^|[\\n,])\\s*${escaped}[^{},]*\\{([^{}]*)\\}`, "g")),
      ).map((match) => match[2] ?? "")
      const bodyText = ruleBodies.join("\n")
      expect(bodyText).toContain("padding: 0")
    }
  })

  test("titlebar layout container gaps are canonical, not theme scoped", () => {
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles.css")))
    const titlebarSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")),
    )
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
      let body: string | null = null
      try {
        body = soloRuleBody(styles, selector)
      } catch {
        body = soloRuleBody(titlebarSurface, selector)
      }
      expect(body).toContain("gap: var(--oc-titlebar-gap)")
    }
  })

  test("shared header background resolves from root palette tokens, not legacy body palette", () => {
    const tokenText = readText(join(OVERLAY_ROOT, "src/styles/tokens/design-language.css"))
    const headerText = readText(join(OVERLAY_ROOT, "src/styles/surfaces/header.css"))

    expect(tokenText).toMatch(/--oc-header-bg:\s*var\(--oc-color-surface-strong\)/)
    expect(tokenText).toMatch(/--oc-titlebar-menu-text:\s*var\(--oc-color-text-strong\)/)
    expect(tokenText).not.toMatch(/--oc-titlebar-menu-text:\s*#[0-9a-fA-F]+/)
    expect(tokenText).not.toMatch(/--oc-header-bg:\s*var\(--surface-strong\)/)
    expect(headerText).toMatch(/background:\s*var\(--oc-header-bg\)/)
  })

  test("new surface style files do not introduce raw color or unscaled pixel literals", () => {
    const files = walkFiles(join(OVERLAY_ROOT, "src/styles/surfaces"), (path) => path.endsWith(".css"))
    const rawColorValue = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i
    const pxLiteral = /(?<![\w-])-?\d+(?:\.\d+)?px\b/g
    const mediaBreakpoint = /\(\s*(?:min|max)-(?:width|height)\s*:\s*-?\d+(?:\.\d+)?px\s*\)/g

    for (const file of files) {
      const text = withoutComments(readText(file))
      expect(text).not.toMatch(rawColorValue)

      const breakpointPxOffsets = new Set<number>()
      for (const match of text.matchAll(mediaBreakpoint)) {
        const start = match.index ?? 0
        for (const inner of match[0].matchAll(pxLiteral)) {
          breakpointPxOffsets.add(start + (inner.index ?? 0))
        }
      }

      for (const match of text.matchAll(pxLiteral)) {
        const start = match.index ?? 0
        if (breakpointPxOffsets.has(start)) continue
        const window = text.slice(Math.max(0, start - 80), start + match[0].length + 80)
        expect(window).toMatch(/calc\([^)]*\bvar\(--ui-scale[^)]*\)[^)]*\)/)
      }
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
