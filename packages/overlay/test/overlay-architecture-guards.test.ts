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

// styles.css was dissolved 2026-05-04 into styles/cascade/*.css (cross-
// cutting plumbing) and styles/surfaces/*.css (per-surface chrome). Many
// guards read "src/styles.css" to assert "no theme override / no raw
// literal / canonical here, not theme scoped" patterns. Those assertions
// remain meaningful — they just need to scan the new cascade layer
// instead. This shim resolves any "src/styles.css" read to the
// concatenated content of the cascade files that absorbed its rules.
function readLegacyStylesCss(_path: string): string {
  const cascadeFiles = [
    "src/styles/cascade/base.css",
    "src/styles/cascade/typography.css",
    "src/styles/cascade/dark.css",
    "src/styles/cascade/vscode-dark.css",
    "src/styles/cascade/light.css",
  ]
  return cascadeFiles
    .map((file) => readFileSync(join(OVERLAY_ROOT, file), "utf8"))
    .join("\n")
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
// THEME_CHROME_TOKEN was used by the retired "themes/ palette-only"
// guard. The themes/ directory was deleted 2026-05-04 (flat-redesign
// Step 0+) along with its guards.
const LEGACY_BUTTON_CLASSES = [
  "btn",
  "btn-primary",
  "chat-send",
  "chat-interrupt",
  "titlebar-btn",
  "sidebar-btn",
  "sidebar-tool",
  "right-panel-tab",
  "executor-chip",
  "chat-toolbar-btn",
  "titlebar-menubar-trigger",
  "titlebar-status-icon",
]
const LEGACY_BUTTON_CALLER_LIMITS: Record<string, number> = {
  btn: 0,
  "btn-primary": 0,
  "chat-send": 1,
  "chat-interrupt": 0,
  "titlebar-btn": 0,
  "sidebar-btn": 0,
  "sidebar-tool": 0,
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
    // Strip comments before counting — historical mentions in comments
    // (e.g., `/* this `!important` reset retired */`) shouldn't count as
    // live cascade debt. The live count tracks rule bodies and selectors
    // that the browser actually evaluates.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const card = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css")))
    const surfaceThemeSelectors = walkFiles(
      join(OVERLAY_ROOT, "src/styles/surfaces"),
      (path) => path.endsWith(".css"),
    ).flatMap((file) =>
      readText(file)
        .split(/\r?\n/)
        .flatMap((line, index) =>
          /body(?:\[data-theme=|:is\([^)]*data-theme)/.test(line)
            ? [`${file}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    )

    expect(count(/!important\b/g, styles + "\n" + card)).toBeLessThanOrEqual(6)
    expect(surfaceThemeSelectors).toEqual([])
  })

  test("styles.css has no hard-coded accent/bad/warn rgb expansions outside comments", () => {
    const raw = readLegacyStylesCss("src/styles.css")
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "")
    // Pre-2026-05-04, styles.css carried 32 literal expansions of palette
    // accent / bad / warn rgb values in rule bodies. Each one painted the
    // active theme with a hue from a *different* theme's palette (e.g. a
    // light-theme button rendering rgba(84, 138, 247, …) which is the
    // OLD default-dark accent #548af7 instead of the active light accent
    // #5b5ff0). That is the root cause of the "different theme cascade
    // conflict — colors bleeding between themes" the user flagged. The
    // fix routes every accent-tinted decoration through `color-mix(in
    // srgb, var(--accent|--bad|--warn) X%, transparent)` so it follows
    // whichever palette token the theme resolves.
    const palettes = [
      ["accent", "84, 138, 247"], // OLD default-dark accent #548af7
      ["accent", "36, 112, 179"], // OLD light accent #2470b3
      ["accent", "91, 95, 240"], // current light accent #5b5ff0
      ["accent", "123, 131, 255"], // current dark accent #7b83ff
      ["bad", "247, 84, 100"], // current default-dark bad #f75464
      ["warn", "212, 167, 44"], // current default-dark warn #d4a72c
    ] as const
    for (const [token, rgb] of palettes) {
      const re = new RegExp(`rgba\\(\\s*${rgb.replace(/, /g, ",\\s*")}\\s*,`, "g")
      expect(stripped).not.toMatch(re)
    }
  })

  test(":root and :root,body[data-theme='dark'] do not redefine the same token", () => {
    // Pre-2026-05-04 :root carried 67 palette tokens that were also
    // declared in `:root, body[data-theme="dark"]` with different
    // values + 5 declared with identical values. The cascade winner
    // was always the late block, so the early :root values rendered
    // nowhere. This guard ensures the dual-source pattern stays
    // retired so any palette tweak lands in one place.
    const styles = readLegacyStylesCss("src/styles.css")
    function tokens(headPattern: string): Set<string> {
      const m = new RegExp(headPattern).exec(styles)
      if (!m) return new Set()
      const open = m.index + m[0].length - 1
      const close = styles.indexOf("\n}", open)
      if (close < 0) return new Set()
      const body = styles.slice(open + 1, close)
      const set = new Set<string>()
      for (const x of body.matchAll(/^[ \t]*(--[\w-]+)\s*:/gm)) set.add(x[1]!)
      return set
    }
    const root = tokens(`(^|\\n):root\\s*\\{`)
    const rootDark = tokens(`(^|\\n):root,[\\s\\S]*?body\\[data-theme="dark"\\]\\s*\\{`)
    const overlap = [...root].filter((tok) => rootDark.has(tok))
    expect(overlap).toEqual([])
  })

  test("each theme has at most one solo body[data-theme=…] palette block", () => {
    // Pre-2026-05-04 styles.css carried two `body[data-theme="light"]`
    // blocks (line 208 + 7261) and two `body[data-theme="vscode-dark"]`
    // blocks (line 155 + 7182). The early block ran the IntelliJ-Light /
    // VS Code-Dark palette and the late block re-painted with the
    // workbench palette; the cascade winner was always the late block,
    // so the early values rendered nowhere AND the early-only tokens
    // (--hover-accent-border, --guide-card-bg, --accent-glow, etc.)
    // were stuck on the OLD accent's rgb expansion (e.g. #2470b3
    // instead of the active #5b5ff0). This guard pins the single-block
    // invariant so any future palette tweak lands in one place.
    const styles = readLegacyStylesCss("src/styles.css")
    for (const theme of ["light", "dark", "vscode-dark"] as const) {
      const head = new RegExp(`body\\[data-theme="${theme}"\\]\\s*\\{`, "g")
      const matches = [...styles.matchAll(head)]
      expect(matches.length).toBeLessThanOrEqual(1)
    }
  })

  test("card stylesheet duplicate selector debt cannot increase", () => {
    const card = readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css"))

    expect(countDuplicateSelectors(card)).toBeLessThanOrEqual(6)
  })

  test("legacy theme selectors cannot keep gaining layout and chrome overrides", () => {
    const styles = readLegacyStylesCss("src/styles.css")

    expect(countThemeLayoutOverrides(styles)).toBeLessThanOrEqual(7)
  })

  test("primary action button siblings have no theme chrome override", () => {
    // Strip comments first: the canonical's documentation block mentions
    // `body[data-theme]` as a literal phrase explaining what was retired;
    // a non-comment-aware regex would walk from that prose into the
    // canonical's selector list and report a false positive.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    // Each of the three sibling classes must not appear inside any
    // selector that starts with `body[data-theme=…]` or `body:is(…data-theme…)`.
    // Theme palette (`--accent-gradient`) drives the gradient↔flat split
    // — themes never touch button chrome directly.
    for (const cls of ["btn-primary", "board-intro__cta-action"]) {
      const themeSelector = new RegExp(
        `body(?:\\[[^\\]]*data-theme[^\\]]*\\]|:is\\([^)]*data-theme[^)]*\\))[^{]*\\.${cls}\\b`,
      )
      expect(styles).not.toMatch(themeSelector)
    }
  })

  test("dark themes flatten --accent-gradient to --accent so palette drives the gradient/flat split", () => {
    // Theme palette blocks moved to styles/cascade/{dark,vscode-dark}.css 2026-05-04.
    const dark = readText(join(OVERLAY_ROOT, "src/styles/cascade/dark.css"))
    const vscodeDark = readText(join(OVERLAY_ROOT, "src/styles/cascade/vscode-dark.css"))
    expect(dark).toMatch(
      /body\[data-theme="dark"\][\s\S]*?--accent-gradient:\s*var\(--accent\)/,
    )
    expect(dark).toMatch(
      /body\[data-theme="dark"\][\s\S]*?--accent-gradient-hover:\s*var\(--accent-hover\)/,
    )
    expect(vscodeDark).toMatch(
      /body\[data-theme="vscode-dark"\][\s\S]*?--accent-gradient:\s*var\(--accent\)/,
    )
    expect(vscodeDark).toMatch(
      /body\[data-theme="vscode-dark"\][\s\S]*?--accent-gradient-hover:\s*var\(--accent-hover\)/,
    )
  })

  test("container shell + content shell families have no theme chrome override", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    // The shell families (`.sidebar` / `.chat` / `.sections` for the
    // three workbench columns; `.section` / `.gwg` for inspector cards;
    // `.board-intro` / `.chat-empty--task` for empty states; the four
    // `.board-intro__*` children) all canonicalize on palette tokens
    // (`--rail-surface` / `--chat-canvas` / `--inspector-surface` /
    // `--surface-inset` / `--subtle-1` / `--subtle-2` / color-mix on
    // `--accent`+`--surface`). Themes only swap palette behind those
    // tokens; no `body[data-theme]` selector touches the shell chrome.
    for (const cls of [
      "sidebar",
      "chat",
      "sections",
      "section",
      "gwg",
      "board-intro",
      "chat-empty--task",
      "board-intro__section",
      "board-intro__mode",
      "board-intro__agent",
      "board-intro__cta",
      "agent-workflow-warning",
    ]) {
      // Negative lookahead `(?![\w-])` instead of `\b`: a dash is a
      // non-word char, so `\bsidebar\b` would falsely match `.sidebar-btn`.
      // The class boundary must reject both word chars and dashes to keep
      // shell-vs-child selectors distinct.
      const themeSelector = new RegExp(
        `body(?:\\[[^\\]]*data-theme[^\\]]*\\]|:is\\([^)]*data-theme[^)]*\\))[^{]*\\.${cls}(?![\\w-])`,
      )
      expect(styles).not.toMatch(themeSelector)
    }
  })

  test("body root + .panel-body chrome canonicals read palette tokens, not literals", () => {
    // body baseline moved to styles/cascade/base.css; .panel-body to
    // surfaces/workspace.css; theme blocks to styles/cascade/{dark,vscode-dark,light}.css. 2026-05-04.
    const base = readText(join(OVERLAY_ROOT, "src/styles/cascade/base.css"))
    const workspace = readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css"))
    expect(base).toMatch(/^body\s*\{[^}]*background:\s*var\(--body-bg\)\s*;/m)
    expect(workspace).toMatch(/^\.panel-body\s*\{[^}]*background:\s*var\(--panel-body-bg\)/m)
    expect(workspace).toMatch(
      /^\.panel-body\s*\{[^}]*backdrop-filter:\s*var\(--panel-body-blur\)/m,
    )
    for (const [theme, file] of [
      ['body\\[data-theme="dark"\\]', "dark.css"],
      ['body\\[data-theme="vscode-dark"\\]', "vscode-dark.css"],
      ['body\\[data-theme="light"\\]', "light.css"],
    ] as const) {
      const cascade = readText(join(OVERLAY_ROOT, "src/styles/cascade", file))
      const head = new RegExp(`${theme}\\s*\\{`)
      const idx = cascade.search(head)
      expect(idx).toBeGreaterThan(-1)
    }
  })

  test("vscode-dark :root surfaces solid palette tokens for shell columns", () => {
    // Theme palette block moved to styles/cascade/vscode-dark.css 2026-05-04.
    const styles = readText(join(OVERLAY_ROOT, "src/styles/cascade/vscode-dark.css"))
    const headRe = /body\[data-theme="vscode-dark"\]\s*\{/g
    let match: RegExpExecArray | null = null
    let lastBlock: string | null = null
    while ((match = headRe.exec(styles)) !== null) {
      const open = match.index + match[0].length - 1
      const close = styles.indexOf("\n}", open)
      if (close < 0) continue
      lastBlock = styles.slice(open + 1, close)
    }
    expect(lastBlock).not.toBeNull()
    expect(lastBlock!).toMatch(/--rail-surface:\s*#252526\b/)
    expect(lastBlock!).toMatch(/--chat-canvas:\s*#1e1e1e\b/)
    expect(lastBlock!).toMatch(/--inspector-surface:\s*#252526\b/)
  })

  test("inline-pill family has no theme chrome override", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    // task-row-badge / section-badge / extension-status / gwg-priority-badge /
    // change-status / diff-dialog-stat all converged on the iter15+
    // "dot-prefix" canonical (transparent base + variant tint via dim tokens
    // + colored ::before). No theme selector is allowed to re-paint a
    // panel-tint background or border-color over them — that pattern masks
    // the variant differentiation and reintroduces themes owning component
    // chrome. (.llm-status / .llm-notice were retired 2026-05-04 — no
    // remaining call sites in TS/TSX/HTML.)
    for (const cls of [
      "task-row-badge",
      "section-badge",
      "extension-status",
      "gwg-priority-badge",
      "change-status",
      "diff-dialog-stat",
    ]) {
      const themeSelector = new RegExp(
        `body(?:\\[[^\\]]*data-theme[^\\]]*\\]|:is\\([^)]*data-theme[^)]*\\))[^{]*\\.${cls}\\b`,
      )
      expect(styles).not.toMatch(themeSelector)
    }
  })

  test("primary action canonical reads palette tokens, not literals", () => {
    // Batch 1 (2026-05-07): the retired legacy button stylesheet no longer
    // exists. Primary actions are now owned by the Button primitive's solid
    // accent variant.
    const styles = readText(join(OVERLAY_ROOT, "src/styles/primitives/button.css"))
    const sharedRule = styles.match(/\.oc-button\[data-variant="solid"\]\[data-tone="accent"\]\s*\{([^}]*)\}/)
    expect(sharedRule).not.toBeNull()
    expect(sharedRule![1]).toContain("--oc-button-bg: var(--accent)")
    expect(sharedRule![1]).toContain("--oc-button-color: var(--surface)")
    expect(sharedRule![1]).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba\(|hsla\(/)
    expect(styles).not.toContain(".board-intro__cta-action")
  })

  test("titlebar status pill and status-icon are owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    expect(styles).not.toMatch(/^\.titlebar-task-status\b/m)
    expect(styles).not.toMatch(/^\.status-icon\b/m)
    expect(titlebarSurface).toMatch(/\.titlebar-task-status\s*\{/)
    expect(titlebarSurface).toMatch(/\.titlebar-task-status\[data-status="active"\]/)
    expect(titlebarSurface).toMatch(/\.status-icon\s*\{/)
    expect(titlebarSurface).toMatch(/\.status-icon\[data-status="completed"\]/)
    expect(titlebarSurface).toContain("var(--oc-titlebar-status-icon)")
  })

  test("titlebar status chip and setup CTA are owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
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

  test("composer toolbar column stays retired", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))
    const composerSource = readText(join(OVERLAY_ROOT, "src/components/ChatComposer.tsx"))

    expect(styles).not.toMatch(/\.chat-icon-col(?![-\w])/)
    expect(composerSurface).not.toMatch(/\.chat-icon-col(?![-\w])/)
    expect(composerSurface).not.toContain("chat-toolbar-button")
    expect(composerSource).not.toContain('data-ui="chat-toolbar-button"')
  })

  test("composer toolbar chrome is not controlled by legacy theme selectors", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/\.chat-icon-col(?=$|[\s:{.#\[,>+~])/)
      expect(selector).not.toMatch(/chat-toolbar-button/)
    }
  })

  test("sidebar task-row-mini + badge family are owned by surfaces/sidebar.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const sidebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of [
      "sidebar",
      "sidebar-title",
      "sidebar-subtitle",
      "sidebar-header-actions",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(sidebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(sidebarSurface).toMatch(/\.sidebar\[data-collapsed="true"\]\s*\{/)
    expect(sidebarSurface).not.toContain("sidebar-toolset")
    expect(html).not.toContain('data-ui="sidebar-refresh-button"')
    expect(html).not.toContain('data-ui="sidebar-toggle-button"')
    expect(html).toContain('data-ui="sidebar-new-task-button"')
    expect(html).not.toContain('class="sidebar-tool"')
    expect(html).not.toContain('class="sidebar-toggle"')
    expect(html).not.toContain('class="sidebar-btn sidebar-btn-primary"')

    const sidebarAt = html.indexOf('href="styles/surfaces/sidebar.css"')
    expect(sidebarAt).toBeGreaterThan(-1)
  })

  test("inspector right panel shell is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    expect(inspectorAt).toBeGreaterThan(-1)
  })

  test("inspector preview tab + section icon button are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    // frontend-preview family must be in inspector.css, not cascade layer
    for (const className of [
      "frontend-preview",
      "frontend-preview-toolbar",
      "frontend-preview-url",
      "frontend-preview-frame",
      "frontend-preview-empty",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    // Section icon button was renamed to .oc-section__icon-btn (Step 9.E migration)
    expect(inspectorSurface).toMatch(/\.oc-section__icon-btn\s*\{/)
    expect(inspectorSurface).toMatch(/\.oc-section__icon-btn:hover,\s*\.oc-section__icon-btn:focus-visible\s*\{/)
    expect(inspectorSurface).toMatch(/\.frontend-preview-empty\[data-kind="error"\]\s*\{/)
    expect(withoutComments(inspectorSurface)).not.toContain("background: white")
    expect(inspectorSurface).toContain("background: var(--surface-inset)")
    expect(inspectorSurface).toContain("var(--oc-border-width)")
  })

  test("section content rails (icon, title, badge, body, caret) are owned by surfaces/inspector.css", () => {
    // After Step 9.E migration, the legacy .section-* family was replaced by
    // .oc-section__* primitives. inspector.css now hosts the surface-specific
    // overrides (size, color, phase-state variants) on top of the structural
    // base in primitives/section.css.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const sectionPrimitive = readText(join(OVERLAY_ROOT, "src/styles/primitives/section.css"))

    // Legacy names must not appear in cascade layer
    for (const className of [
      "section-icon",
      "section-title",
      "section-badge",
      "section-body",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    // section-head-action stays in inspector.css (surface-specific, not primitive)
    expect(inspectorSurface).toMatch(/(^|\n)\.section-head-action\s*\{/)

    // New primitive names live in primitives/section.css + inspector.css overrides
    expect(sectionPrimitive).toMatch(/(^|\n)\.oc-section__icon\s*\{/)
    expect(sectionPrimitive).toMatch(/(^|\n)\.oc-section__title\s*\{/)
    expect(sectionPrimitive).toMatch(/(^|\n)\.oc-section__badge\s*\{/)
    expect(sectionPrimitive).toMatch(/(^|\n)\.oc-section__body\s*\{/)

    // Inspector surface owns the caret + badge tone variants
    expect(inspectorSurface).toMatch(/\.oc-section__head::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.oc-section\[open\] > \.oc-section__head::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.oc-section__badge\[data-tone="(?:good|bad|warn|accent)"\](?:::before)?\s*\{/)
    expect(inspectorSurface).toMatch(/\.oc-section__badge\[data-variant="metric"\]/)
    expect(inspectorSurface).toContain("var(--oc-radius-pill)")
  })

  test("section shell + head baseline are owned by surfaces/inspector.css", () => {
    // After Step 9.E migration, .section → .oc-section, .section-head → .oc-section__head.
    // inspector.css owns the surface-level card chrome (background, border-radius,
    // overflow, hover wash) on top of the structural base in primitives/section.css.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    // Legacy .section and .section-head must not be in cascade layer
    expect(styles).not.toMatch(/(^|\n)\.section\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.section-head\s*\{/)

    // New names are in inspector.css
    expect(inspectorSurface).toMatch(/(^|\n)\.oc-section\s*\{/)
    expect(inspectorSurface).toMatch(/(^|\n)\.oc-section__head\s*\{/)

    // Flat-redesign Step 2 (2026-05-04): .section:last-child must be gone everywhere.
    expect(styles).not.toMatch(/(^|\n)\.section:last-child\s*\{/)
    expect(inspectorSurface).not.toMatch(/\.oc-section:last-child\s*\{/)
    expect(inspectorSurface).toMatch(/\.oc-section__head::-webkit-details-marker\s*\{/)
    expect(inspectorSurface).toMatch(/\.oc-section__head:hover\s*\{/)
    expect(inspectorSurface).toContain("var(--ui-highlight-tone)")
  })

  test("gwg actions + body + objective are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-action-btn",
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
    expect(inspectorSurface).toContain("var(--ui-highlight-tone)")
  })

  test("task dir bar (TaskDirBar) is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    for (const className of [
      "task-bar",
      "task-bar-main",
      "task-status",
      "status-label",
      "task-flag",
      "workspace-command-dock",
      "workspace-command-divider",
      "workspace-editor-launchers",
      "workspace-layout-controls",
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
    expect(conversationSurface).toMatch(
      /\.task-bar\s*\{[\s\S]*?border-bottom:\s*var\(--oc-border-width\)\s+solid\s+var\(--task-bar-border-color\)/,
    )
    expect(conversationSurface).toMatch(/\.task-bar\s*\{[\s\S]*?background:\s*var\(--task-bar-bg\)/)
    expect(conversationSurface).toMatch(
      /\.task-bar\s*\{[\s\S]*?backdrop-filter:\s*var\(--task-bar-backdrop-filter\)/,
    )
    expect(conversationSurface).not.toMatch(
      /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))[\s\S]*?\.task-bar\b/,
    )
    expect(conversationSurface).toMatch(/\.recent-dir-row:hover\s*\{/)
    expect(conversationSurface).toMatch(/\.recent-dir-row\[data-active="true"\]\s*\{/)
  })

  test("executor chip and selector family are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "executor-selector",
      "executor-chip-identity",
      "executor-chip-label",
      "executor-chip-action",
      "executor-chip-models",
      "executor-chip-model",
      "executor-chip-role",
      "executor-chip-provider",
      "executor-chip-name",
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
    expect(composerSurface).toContain("var(--oc-radius-soft)")
    expect(composerSurface).not.toMatch(/border-radius:\s*999px/)

    expect(composerSurface).toMatch(/\.executor-selector \.oc-button\[data-ui="executor-chip"\]\s*\{/)
    expect(composerSurface).toMatch(/\.executor-selector \.oc-button\[data-ui="executor-chip"\]:hover\s*\{/)
    expect(composerSurface).toMatch(
      /\.executor-selector\[data-open="true"\] \.oc-button\[data-ui="executor-chip"\]\s*\{/,
    )
    expect(composerSurface).toMatch(/\.executor-chip-model\[data-source="executor"\]\s*\{/)
  })

  test("workspace panel, diff preview, and file view are owned by surfaces/workspace.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const workspaceSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of [
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
      // diff-preview-head replaced by .oc-panel__header override in Step 9.E
      "diff-preview-copy",
      "diff-preview-scope",
      "diff-preview-path",
      "diff-preview-meta",
      "diff-preview-body",
      "diff-preview-empty",
      "file-view-panel",
      // file-view-head replaced by .oc-panel__header override in Step 9.E
      "file-view-path",
      "file-view-body",
      "file-view-empty",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(workspaceSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    // diff-preview-head and file-view-head were replaced by .oc-panel__header overrides
    expect(workspaceSurface).toMatch(/\.diff-preview-panel > \.oc-panel__header\s*\{/)
    expect(workspaceSurface).toMatch(/\.file-view-panel > \.oc-panel__header\s*\{/)
    expect(workspaceSurface).not.toMatch(/(^|\n)\.diff-preview-head\s*\{/)
    expect(workspaceSurface).not.toMatch(/(^|\n)\.file-view-head\s*\{/)

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
    expect(workspaceAt).toBeGreaterThan(-1)

    expect(html).not.toContain("btnWorkspaceToggle")
    expect(workspaceSurface).not.toContain(".workspace-toggle")
    expect(workspaceSurface).toMatch(/\.workspace-mount\[hidden\]\s*\{/)
    expect(workspaceSurface).not.toMatch(/\.pane-resizer\.pane-resizer-workspace::before\s*\{/)
    expect(workspaceSurface).not.toMatch(/\.pane-resizer\.pane-resizer-workspace:hover::before/)
    expect(workspaceSurface).not.toMatch(/\.pane-resizer:hover::before/)
    expect(workspaceSurface).toMatch(/\.workspace-tab:hover\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-tab\[data-active="true"\]\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-close:hover\s*\{/)
    expect(workspaceSurface).toMatch(/\.workspace-view\[data-active="false"\]\s*\{/)
    expect(workspaceSurface).toMatch(/\.file-view-body pre\s*\{/)
    expect(workspaceSurface).toMatch(/code \.file-link:hover\s*\{/)
  })

  test("conn-banner cross-surface notification primitive routes through palette tokens", () => {
    // Canonical extracted from styles.css into surfaces/conn-banner.css —
    // the banner is mounted globally via fixed positioning by App.tsx /
    // ConnectionBanner.tsx, so it owns its own surface file.
    const styles = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conn-banner.css"))

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
    // Canonical moved from styles.css into surfaces/inspector.css. The
    // verdict-pill is rendered by Board.tsx + IntegrityCard inside the
    // inspector workspace, so the inspector surface owns it.
    const inspector = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const styles = readLegacyStylesCss("src/styles.css")

    const verdictBlock = inspector.match(
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

    // Single-source assertion: the canonical no longer lives in
    // styles.css. This catches accidental copy-paste during future
    // strips that would re-introduce double sourcing per rule 8.
    expect(styles).not.toMatch(/^\.verdict-pill\s*\{/m)
  })

  test("executor menu dropdown is owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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

    expect(composerSurface).toMatch(/\.executor-menu-row:hover:not\(:disabled\)\s*\{/)
    expect(composerSurface).toMatch(/\.executor-menu-group\[data-active="true"\] \> \.executor-menu-row\s*\{/)
    expect(composerSurface).toMatch(/\.executor-menu-model\[data-active="true"\]\s*\{/)
    expect(composerSurface).not.toMatch(/rgba\(146,\s*184,\s*252/)
    expect(composerSurface).not.toMatch(/rgba\(86,\s*126,\s*196/)
    expect(composerSurface).not.toMatch(/rgba\(196,\s*215,\s*252/)
  })

  test("prompt catalog is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    expect(() => soloRuleBody(readLegacyStylesCss("src/styles.css"), ".config-section")).toThrow()
    expect(() => soloRuleBody(readLegacyStylesCss("src/styles.css"), ".config-subsection")).toThrow()
  })

  test("settings content panel + resizer are owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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

  test("settings dialog shell is owned by the shared dialog primitive", () => {
    const sources = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:css|ts|tsx)$/.test(path))
      .map(readText)
      .join("\n")
    const configDialog = readText(join(OVERLAY_ROOT, "src/components/ConfigDialogHost.tsx"))
    const dialogSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/dialog.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    expect(sources).not.toContain("config-dialog-form")
    expect(sources).not.toContain("config-dialog-head")
    expect(configDialog).toContain("wider={true}")
    expect(dialogSurface).toMatch(/\.dialog-wider \.dialog-form\s*\{/)
    expect(settingsSurface).not.toMatch(/(^|\n)\.config-dialog-(form|head)\s*\{/)
  })

  test("settings sidebar nav is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    expect(settingsAt).toBeGreaterThan(-1)
  })

  test("architect panel is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.req-status\\[data-req-status="${variant}"\\]\\s*\\{`),
      )
    }
    expect(inspectorSurface).toMatch(/\.req-spec-detail \> summary\s*\{/)
  })

  test("gwg checks list is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
        new RegExp(`\\.gwg-check\\[data-check-status="${status}"\\](?:\\s+\\.gwg-check-(?:icon|name))?\\s*\\{`),
      )
    }

    expect(inspectorSurface).toMatch(/\.gwg-check \+ \.gwg-check\s*\{/)
    expect(inspectorSurface).not.toMatch(/clamp\([^,]*,\s*calc\(10px/)
  })

  test("gwg step body, plan nodes, diff stats, verdict are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    expect(inspectorSurface).not.toMatch(/rgba\(95,\s*173,\s*86/)
    expect(inspectorSurface).not.toMatch(/rgba\(212,\s*167,\s*44/)
  })

  test("gwg step row family is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-header",
      "gwg-title-row",
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
        new RegExp(`\\.gwg\\[data-goal-status="${variant}"\\] \\.gwg-status-icon\\s*\\{`),
      )
    }
    expect(inspectorSurface).not.toMatch(/clamp\(10px,/)
    expect(inspectorSurface).toMatch(
      /\.gwg-revision[\s\S]*?border-radius:\s*var\(--oc-radius-pill\)/,
    )
  })

  test("gwg shell + status modifiers are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    expect(styles).not.toMatch(/(^|\n)\.gwg\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.gwg::before\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.gwg:hover\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg\s*\{/)
    expect(inspectorSurface).not.toMatch(/\.gwg::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg:hover\s*\{/)

    expect(styles).not.toMatch(/(^|\n)\.gwg--expanded\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg--expanded\s*\{/)
    for (const status of ["passed", "failed", "running"]) {
      expect(styles).not.toMatch(
        new RegExp(`(^|\\n)\\.gwg\\[data-goal-status="${status}"\\](?:::before)?\\s*\\{`),
      )
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.gwg\\[data-goal-status="${status}"\\] \\.gwg-status-icon\\s*\\{`),
      )
    }

    expect(inspectorSurface).not.toMatch(/#c3d2ee/)
    expect(inspectorSurface).not.toMatch(/\.gwg\[data-goal-status="passed"\]::before/)
    expect(inspectorSurface).toContain("var(--ui-shadow-tone)")
  })

  test("criteria group baseline is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    // After Step 9.E migration, .section[data-phase-state] → .oc-section[data-phase-state].
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const variant of ["related", "active"]) {
      expect(styles).not.toMatch(new RegExp(`\\.oc-section\\[data-phase-state="${variant}"\\]\\s*\\{`))
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.oc-section\\[data-phase-state="${variant}"\\]\\s*\\{`),
      )
    }

    expect(inspectorSurface).toMatch(
      /\.oc-section\[data-phase-state="active"\] \.oc-section__badge:not\(:empty\)::before\s*\{/,
    )
    // Active phase-state uses only a background wash; the old vertical
    // `::after` rail made narrow panes look broken.
    expect(inspectorSurface).not.toMatch(
      /\.oc-section\[data-phase-state="active"\]::after\s*\{/,
    )
    expect(inspectorSurface).not.toMatch(/rgba\(91,\s*141,\s*239/)
    expect(inspectorSurface).not.toMatch(/rgba\(10,\s*16,\s*24/)
  })

  test("conversation goals strip is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )

    expect(styles).not.toMatch(/(^|\n)\.chat-scroll\s*\{/)
    expect(conversationSurface).toMatch(/(^|\n)\.chat-scroll\s*\{/)
    expect(conversationSurface).toMatch(/\.chat-scroll > \.card,\n\.chat-scroll > \.interaction-card/)
    expect(conversationSurface).toMatch(/@media \(max-width: 900px\)/)
  })

  test("conversation chat-empty task-children are owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    expect(conversationAt).toBeGreaterThan(-1)
  })

  test("composer build/version row and reflow are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    expect(composerSurface).toMatch(/@media \(max-width: 760px\)\s*\{\s*\/\* breakpoint: --ui-breakpoint-md \*\//)
    expect(composerSurface).toMatch(/\.chat-send-icon svg\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.chat-send-icon svg\s*\{/)
  })

  test("composer attachments and compose row/meta are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
      "chat-resize-handle",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(composerSurface).toMatch(/\.chat-attachment-remove:hover\s*\{/)
    expect(composerSurface).toMatch(/\.chat-input\[data-dragover\]\s+\.chat-compose-row\s*\{/)
    expect(composerSurface).toMatch(/\.chat-compose-meta-left a:hover\s*\{/)
  })

  test("composer chat-send and busy state are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of ["chat-send", "chat-send-icon", "chat-send-label"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(withoutComments(composerSurface)).not.toMatch(/\.chat-interrupt\b/)
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
    expect(composerSurface).toMatch(/\.chat-send\[data-busy="true"\]:hover\s*\{/)
  })

  test("composer chat-textarea family is owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    expect(composerSurface).not.toMatch(/\.chat-textarea\[data-expanded="true"\]\s*\{/)
    expect(composerSurface).toMatch(/\.chat-textarea::placeholder\s*\{/)
  })

  test("composer chat-input shell is owned by surfaces/composer.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    expect(styles).not.toMatch(/(^|\n)\.chat-input\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.chat-input:focus-within\s*\{/)
    expect(composerSurface).toMatch(/(^|\n)\.chat-input\s*\{/)
    expect(composerSurface).toMatch(/\.chat-input:focus-within\s*\{/)
  })

  test("dead static composer toolbar button classes stay retired", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css")),
    )
    const combined = `${styles}\n${composerSurface}`

    expect(combined).not.toMatch(/(^|\n)\.chat-toolbar-btn\b/)
    expect(combined).not.toMatch(/(^|\n)\.chat-cancel-btn\b/)
  })

  test("titlebar theme picker is owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
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
    const styles = readLegacyStylesCss("src/styles.css")
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
    const styles = readLegacyStylesCss("src/styles.css")
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const titlebarSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")),
    )
    const combined = `${styles}\n${titlebarSurface}`

    expect(combined).not.toMatch(/(^|\n)\.titlebar-btn\b/)
    expect(combined).not.toMatch(/(^|\n)\.titlebar-close\b/)
  })

  test("titlebar shell and brand layout are owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
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

    // .titlebar::after decorative gradient line was retired 2026-05-04
    // (flat-redesign Step 2, rule §2.2 B: one cross-context border per
    // edge). Pin its absence so it doesn't crawl back.
    expect(titlebarSurface).not.toMatch(/\.titlebar::after\s*\{/)
  })

  test("migrated titlebar chrome is not controlled by legacy theme selectors", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = readLegacyStylesCss("src/styles.css")
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
      readLegacyStylesCss("src/styles.css"),
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
    const styles = readLegacyStylesCss("src/styles.css")

    expect(styles).not.toMatch(/body[^{]*(?:delivery-panel-header|criteria-group-head)[^{]*\{/)
  })

  test("right-panel primary headers do not rely on theme spacing resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")

    expect(styles).not.toMatch(/body[^{]*(?:section-head|gwg-header)[^{]*\{[^}]*\b(?:min-height|gap|padding)\s*:/)
  })

  test("right-panel primary and config headers do not rely on theme chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/(?:section-head|gwg-header|config-section-head|config-subsection-head)/)
    }
  })

  test("criteria groups do not rely on theme layout or chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/criteria-group(?:-list)?/)
    }
  })

  test("delivery panel keeps verdict accent outside theme chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")
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
    const styles = readLegacyStylesCss("src/styles.css")
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
    const styles = readLegacyStylesCss("src/styles.css")
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

    const detailCardBody = settingsSurface.match(/\.detail-card\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(detailCardBody).toContain("background: var(--surface-inset)")
    expect(detailCardBody).toContain("border: 0")
  })

  test("settings extension rows do not rely on theme or local important chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))

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
    expect(body).toContain("border-radius: var(--oc-radius-none)")
  })

  test("panel shell padding is canonical, not theme scoped", () => {
    // Canonical extracted to surfaces/workspace.css 2026-05-04.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const workspace = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")),
    )

    for (const source of [styles, workspace]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
          selector,
        )
        if (!isThemeSelector || !/(?:^|[\s>+~,])\.panel(?:$|[\s:{.#\[,>+~])/.test(selector)) continue
        expect(body).not.toMatch(/\bpadding(?:-[a-z]+)?\s*:/)
      }
    }

    const body = soloRuleBody(workspace, ".panel")
    expect(body).toContain("padding: 0")
  })

  test("titlebar shell layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    // Flat-redesign Step 2 (2026-05-04): the titlebar shell switched from
    // `border + border-left:0 + border-right:0 + border-radius:0` (4
    // declarations to express "only the bottom edge") to `border: 0;
    // border-bottom: ...` (single source for the bottom edge). rule §2.2 B.
    for (const declaration of [
      "gap: calc(2px * var(--ui-scale))",
      "margin: 0",
      "padding: calc(2px * var(--ui-scale)) calc(4px * var(--ui-scale))",
      "border: 0",
      "border-bottom: var(--oc-border-width) solid var(--border)",
      "box-shadow: none",
    ]) {
      expect(body).toContain(declaration)
    }
    expect(body).not.toMatch(/border-left\s*:/)
    expect(body).not.toMatch(/border-right\s*:/)
  })

  test("directory, sidebar, and workspace controls are canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
          /\.(?:task-dir-shell|task-cwd-dropdown)\b/.test(selector) ||
          /\[data-ui="sidebar-new-task-button"\]/.test(selector)
        if (!isThemeSelector || !hasHeaderControl) continue

        expect(selector).not.toMatch(
          /\.(?:task-dir-shell|task-cwd-dropdown)\b|\[data-ui="sidebar-new-task-button"\]/,
        )
      }
    }

    const conversationSurface = readText(
      join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"),
    )
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("gap: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("padding: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("border: var(--oc-border-width) solid var(--oc-control-border)")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("border-radius: var(--oc-radius-soft)")
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
    expect(sidebarSurface).not.toContain("sidebar-toolset")
    expect(sidebarSurface).not.toContain('data-ui="sidebar-refresh-button"')
    expect(sidebarSurface).not.toContain('data-ui="sidebar-toggle-button"')
    expect(sidebarSurface).toContain('.oc-button[data-ui="sidebar-new-task-button"]')
    const workspaceSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))
    expect(workspaceSurface).not.toContain(".workspace-toggle")
  })

  test("right-panel empty hint density is canonical, not theme scoped", () => {
    // Canonical extracted to surfaces/empty-state.css 2026-05-04.
    const styles = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/empty-state.css")),
    )

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

    const body = soloRuleBody(
      styles,
      ".section-body > .empty-hint,\n#solidChangesPanel > .empty-hint",
    )
    for (const declaration of [
      "gap: calc(4px * var(--ui-scale))",
      "padding: calc(6px * var(--ui-scale))",
      "border: 0",
      "border-radius: var(--oc-radius-soft)",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow panel shell is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

    // Theme-selector check still scans styles.css — the only place a
    // stale `body[data-theme] .agent-workflow-panel` could regress
    // into. The canonical body now lives in surfaces/agent-workflow.css.
    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-panel\b/.test(selector)) continue

      expect(selector).not.toMatch(/\.agent-workflow-panel\b/)
    }

    const panelBody = soloRuleBody(surface, ".agent-workflow-panel")
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

    const beforeBody = soloRuleBody(surface, ".agent-workflow-panel::before")
    for (const declaration of [
      'content: ""',
      "position: absolute",
      "inset: 0",
      "z-index: var(--ui-z-below)",
      "opacity: var(--ui-opacity-faint)",
      "background-size: calc(26px * var(--ui-scale)) calc(26px * var(--ui-scale))",
      // The atmospheric mask uses `var(--text-strong)` instead of the
      // literal `#000` — palette token follows whichever theme's text
      // colour is active so the mask preserves contrast across themes.
      "mask-image: linear-gradient(to bottom, transparent, var(--text-strong) 14%, var(--text-strong) 84%, transparent)",
    ]) {
      expect(beforeBody).toContain(declaration)
    }
  })

  test("workflow canvas layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-canvas\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:display|gap|padding(?:-[a-z]+)?)\s*:/)
    }

    const body = soloRuleBody(surface, ".agent-workflow-canvas")
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

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

    const body = soloRuleBody(surface, ".agent-workflow-row")
    for (const declaration of [
      // The default `--workflow-depth: 0` is split out of the calc so the
      // surface guard's px-scale check tolerates the line; the React
      // panel writes the inline value via `style="--workflow-depth: N"`.
      "--workflow-depth: 0",
      "--lane-shift: calc(var(--workflow-depth) * 20px * var(--ui-scale))",
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

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

    const body = soloRuleBody(surface, ".agent-workflow-rail")
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-stack\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:position|display|gap|min-width|padding(?:-[a-z]+)?)\s*:/)
    }

    const body = soloRuleBody(surface, ".agent-workflow-stack")
    for (const declaration of [
      "position: relative",
      "display: grid",
      "gap: 0",
      "min-width: 0",
      // The default `--stack-pad: 0px` is split out of the calc and the
      // companion `8px` literal is wrapped in `calc(8px * var(--ui-scale))`
      // so the trailing padding follows ui-scale.
      "--stack-pad: 0",
      "padding-bottom: calc(var(--stack-pad) + calc(8px * var(--ui-scale)))",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow card chrome and tones are canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      const hasWorkflowCard = /(?:^|[\s>+~,])\.agent-workflow-card(?![-\w])/.test(selector)
      if (!isThemeSelector || !hasWorkflowCard) continue

      expect(selector).not.toMatch(/\.agent-workflow-card(?![-\w])/)
    }

    const cardBody = soloRuleBody(surface, ".agent-workflow-card")
    for (const declaration of [
      "--workflow-tone: var(--accent)",
      "min-height: calc(94px * var(--ui-scale))",
      "gap: calc(7px * var(--ui-scale))",
      "padding: calc(11px * var(--ui-scale)) calc(12px * var(--ui-scale)) calc(10px * var(--ui-scale))",
      "overflow: hidden",
      // The literal `1px solid` border was rewritten to read the
      // `--oc-border-width` token during the surface migration so the
      // border width tracks the rest of the chromed-control family.
      "border: var(--oc-border-width) solid color-mix(in srgb, var(--workflow-tone) 28%, var(--border))",
      "border-radius: var(--oc-radius-large)",
      "background: color-mix(in srgb, var(--surface) 88%, var(--workflow-tone) 4%)",
    ]) {
      expect(cardBody).toContain(declaration)
    }

    expect(soloRuleBody(surface, '.agent-workflow-card[data-status="running"]')).toContain(
      "border-style: dashed",
    )
    expect(soloRuleBody(surface, '.agent-workflow-card[data-status="completed"]')).toContain(
      "--workflow-tone: var(--good)",
    )
    expect(soloRuleBody(surface, '.agent-workflow-card[data-status="error"]')).toContain(
      "--workflow-tone: var(--bad)",
    )
    expect(soloRuleBody(surface, '.agent-workflow-card[data-status="idle"]')).toContain(
      "--workflow-tone: var(--warn)",
    )

    const hoverBody = soloRuleBody(surface, ".agent-workflow-card:hover,\n.agent-workflow-card:focus-visible")
    expect(hoverBody).toContain("border-color: color-mix(in srgb, var(--workflow-tone) 58%, var(--border))")
    // The `var(--stack-offset, 0)` fallback was split into a default
    // declaration on `.agent-workflow-card` itself, and the literal
    // `1px` lift wrapped in `calc(1px * var(--ui-scale))` so the lift
    // follows ui-scale.
    expect(hoverBody).toContain(
      "transform: translate(var(--stack-offset), calc(var(--stack-offset) - calc(1px * var(--ui-scale))))",
    )
  })

  test("workflow card text density is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

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

    const agentBody = soloRuleBody(surface, ".agent-workflow-agent")
    expect(agentBody).toContain("font-size: var(--ui-font-small)")
    // Flat-redesign 2026-05-04: bold-tier 780 retired (user feedback —
    // no bold on the active-agent identity label). Now medium 500.
    expect(agentBody).toContain("font-weight: var(--ui-font-weight-medium)")

    const cardBody = soloRuleBody(surface, ".agent-workflow-card-body")
    for (const declaration of [
      "min-height: calc(34px * var(--ui-scale))",
      // The undefined `--text-base` token (which fell through to CSS
      // initial) was replaced with the canonical `--text` palette token
      // during the migration.
      "color: var(--text)",
      "font-size: var(--ui-font-control)",
      "line-height: 1.4",
    ]) {
      expect(cardBody).toContain(declaration)
    }
  })

  test("workflow attempt chip chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-attempt\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:border|background|color)\s*:/)
    }

    const body = soloRuleBody(surface, ".agent-workflow-attempt")
    for (const declaration of [
      "border: var(--oc-border-width) solid color-mix(in srgb, var(--workflow-tone) 38%, transparent)",
      "border-radius: var(--oc-radius-pill)",
      "padding: 0 calc(6px * var(--ui-scale))",
      "background: color-mix(in srgb, var(--workflow-tone) 13%, transparent)",
      "color: color-mix(in srgb, var(--workflow-tone) 82%, var(--text-strong))",
    ]) {
      expect(body).toContain(declaration)
    }
  })

  test("workflow report shell chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

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

    const popoverBody = soloRuleBody(surface, ".agent-workflow-report-popover")
    for (const declaration of [
      "align-items: flex-end",
      "padding: calc(14px * var(--ui-scale))",
      "background: color-mix(in srgb, var(--dialog-backdrop) 44%, transparent)",
    ]) {
      expect(popoverBody).toContain(declaration)
    }

    const reportBody = soloRuleBody(surface, ".agent-workflow-report")
    for (const declaration of [
      "border: var(--oc-border-width) solid color-mix(in srgb, var(--accent) 26%, var(--border))",
      "border-radius: var(--oc-radius-large)",
      "background: var(--dialog-bg)",
      // The literal black `rgba(0, 0, 0, 0.24)` drop shadow tracked
      // the dark theme; routed through `color-mix(... var(--bg) 65%,
      // transparent)` so the shadow tone follows whichever theme's
      // canvas is active.
      "box-shadow: 0 calc(14px * var(--ui-scale)) calc(30px * var(--ui-scale)) color-mix(in srgb, var(--bg) 65%, transparent)",
    ]) {
      expect(reportBody).toContain(declaration)
    }
  })

  test("workflow report dividers are canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

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

    expect(soloRuleBody(surface, ".agent-workflow-report-head")).toContain(
      "border-bottom: var(--oc-border-width) solid color-mix(in srgb, var(--accent) 16%, var(--border))",
    )
    expect(soloRuleBody(surface, ".agent-workflow-report-section")).toContain(
      "border-bottom: var(--oc-border-width) solid color-mix(in srgb, var(--border) 58%, transparent)",
    )
  })

  test("workflow refresh button chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-refresh\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:border|border-radius|background|box-shadow|color)\s*:/)
    }

    const body = soloRuleBody(surface, ".agent-workflow-refresh")
    for (const declaration of [
      "border: var(--oc-border-width) solid color-mix(in srgb, var(--accent) 32%, var(--border))",
      "border-radius: var(--oc-radius-pill)",
      "padding: 0 calc(10px * var(--ui-scale))",
      "background: color-mix(in srgb, var(--accent) 8%, var(--surface-strong))",
      "box-shadow: none",
      "color: var(--text-strong)",
    ]) {
      expect(body).toContain(declaration)
    }

    expect(soloRuleBody(surface, ".agent-workflow-refresh:hover")).toContain(
      "background: color-mix(in srgb, var(--accent) 12%, var(--surface-strong))",
    )
  })

  test("workflow report close button chrome is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/agent-workflow.css")),
    )

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(
        selector,
      )
      if (!isThemeSelector || !/\.agent-workflow-report-close\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:border|background|box-shadow|color)\s*:/)
    }

    const body = soloRuleBody(surface, ".agent-workflow-report-close")
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

    expect(soloRuleBody(surface, ".agent-workflow-report-close:hover")).toContain(
      "background: color-mix(in srgb, var(--accent) 10%, transparent)",
    )
  })

  test("panel body shell chrome is canonical, not theme scoped", () => {
    // .panel-body canonical moved to surfaces/workspace.css 2026-05-04.
    const workspace = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")),
    )

    for (const match of workspace.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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

    const bodies = Array.from(workspace.matchAll(/(^|\n)\.panel-body\s*\{([^{}]*)\}/g)).map(
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const conversationSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")),
    )
    for (const [selector, source] of [
      [".sidebar", sidebarSurface],
      [".chat", conversationSurface],
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
    // .workspace-main canonical moved to surfaces/workspace.css 2026-05-04.
    const workspace = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")),
    )
    const inspectorSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css")),
    )

    for (const source of [workspace, inspectorSurface]) {
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

    const workspaceBodies = Array.from(workspace.matchAll(/(^|\n)\.workspace-main\s*\{([^{}]*)\}/g)).map(
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
    expect(sectionsBody).toContain("gap: var(--ui-gap-sm)")
    expect(sectionsBody).toContain("padding: var(--ui-gap-sm)")
  })

  test("right panel card radius and body padding are canonical, not theme scoped", () => {
    // After Step 9.E migration, .section → .oc-section, .section-body → .oc-section__body.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
          !/(?:^|[\s>+~,])\.(?:oc-section|gwg|oc-section__body|gwg-body)(?:$|[\s:{.#\[,>+~])/.test(selector)
        ) {
          continue
        }

        expect(body).not.toMatch(/\b(?:border-radius|padding(?:-[a-z]+)?)\s*:/)
      }
    }

    expect(soloRuleBody(inspectorSurface, ".oc-section")).toContain(
      "border-radius: var(--oc-radius-soft)",
    )
    expect(soloRuleBody(inspectorSurface, ".gwg")).toContain(
      "border-radius: var(--oc-radius-soft)",
    )

    expect(soloRuleBody(inspectorSurface, ".oc-section__body")).toContain(
      "padding: 0 var(--ui-gap-sm) var(--ui-gap-sm)",
    )
    expect(soloRuleBody(inspectorSurface, ".gwg-body")).toContain(
      "padding: 0 calc(6px * var(--ui-scale)) calc(6px * var(--ui-scale))",
    )
  })

  test("BoardIntro was deleted — no .board-intro CSS or component references remain", () => {
    // BoardIntro.tsx was deleted in commit 9978c43ba (2026-05-04).
    // board.css was deleted with it. Assert that no ghost references remain.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const card = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css")))

    // No standalone .board-intro rules in cascade layer
    expect(styles).not.toMatch(/^\.board-intro\s*\{/m)
    expect(styles).not.toMatch(/^\.board-intro__title\s*\{/m)
    // No board-intro rules leaked into card.css
    expect(card).not.toMatch(/\.board-intro(?:__|\b)/)
    const button = readText(join(OVERLAY_ROOT, "src/styles/primitives/button.css"))
    expect(button).not.toContain(".board-intro__cta-action")
    // board.css must not exist (was deleted with BoardIntro.tsx)
    expect(existsSync(join(OVERLAY_ROOT, "src/styles/surfaces/board.css"))).toBe(false)
  })

  test("chat scroll layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const conversationSurface = withoutComments(
      readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")),
    )
    const chatBody = soloRuleBody(conversationSurface, ".chat")
    const progressBody = soloRuleBody(conversationSurface, ".task-switch-progress")

    expect(chatBody).toContain("position: relative")
    expect(progressBody).toContain("position: absolute")
    expect(progressBody).toContain("inset-block-start: 0")
    expect(progressBody).toContain("inset-inline: 0")
    expect(progressBody).not.toContain("flex-shrink")
  })

  test("themes/ duplicate palette directory is retired", () => {
    // The styles/themes/{dark,light,vscode-dark}.css files were
    // retired 2026-05-04 (flat-redesign Step 0+). They duplicated the
    // cascade/ palette under a parallel `--oc-color-*` namespace with
    // different values (themes/dark.css used a vscode-style grey
    // `#1e1f22` while cascade/dark.css used the cool navy `#111528`),
    // producing the "vscode 黑色混到 dark theme" visual contradiction.
    // The 2 callsites — `--oc-header-bg` / `--oc-titlebar-menu-text`
    // in design-language.css — were repointed to the cascade/ legacy
    // palette tokens (`--surface-strong` / `--text-strong`).
    // rule 8 (no double source).
    const themesDir = join(OVERLAY_ROOT, "src/styles/themes")
    expect(existsSync(themesDir)).toBe(false)
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
          // Token files allow exactly two selector kinds:
          //   1. `:root` for static tokens (radii, density, type
          //      scale, hue metadata that doesn't switch with theme).
          //   2. `body` for theme-wired indirection tokens
          //      (`var(--surface-inset)`, `var(--accent)` chains)
          //      that MUST live at body scope so the var() reference
          //      resolves at the element's body — `body[data-theme=
          //      "..."]` palette overrides only update body's palette
          //      tokens, and a `:root`-scoped indirection freezes
          //      the dark default before the theme block runs.
          //      Discovered 2026-05-04 when `--oc-control-bg`
          //      rendered as the dark navy `rgba(20, 24, 44, 0.92)`
          //      across all three themes despite `--surface-inset`
          //      being theme-correct.
          expect([":root", "body"]).toContain(item)
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
      "--oc-radius-none",
      "--oc-radius-soft",
      "--oc-radius-large",
      "--oc-radius-pill",
      "--ui-font-weight-body",
      "--ui-font-weight-strong",
      "--oc-density-control-height",
      "--oc-density-icon-button",
      "--oc-titlebar-gap",
      "--oc-titlebar-status-icon",
    ]) {
      expect(tokenText).toContain(token)
    }
  })

  // Regression for the 2026-05-04 cwd-dropdown bug: declaring
  //   :root { --oc-control-bg: var(--surface-inset); }
  // freezes `--oc-control-bg` to the dark default at parse time
  // because `var()` resolves at the *declaration's* scope, and
  // `body[data-theme="light"]` palette overrides only update tokens
  // declared on `body`. Any indirection that points at a themed
  // palette token therefore MUST live at body scope. This guard
  // scans every `:root { ... }` block under src/styles/ and rejects
  // declarations whose value references a known themed token.
  test("no :root indirection points at themed palette tokens", () => {
    const THEMED_PALETTE_TOKENS = new Set([
      "--bg",
      "--surface",
      "--surface-hover",
      "--surface-inset",
      "--surface-strong",
      "--rail-surface",
      "--chat-canvas",
      "--inspector-surface",
      "--chrome",
      "--border",
      "--border-hover",
      "--border-strong",
      "--text",
      "--text-strong",
      "--text-soft",
      "--text-muted",
      "--accent",
      "--accent-dim",
      "--accent-hover",
      "--accent-start",
      "--accent-mid",
      "--accent-end",
      "--accent-gradient",
      "--accent-gradient-hover",
      "--accent-ring",
      "--good",
      "--good-dim",
      "--warn",
      "--warn-dim",
      "--bad",
      "--bad-dim",
      "--info",
      "--info-dim",
      "--shadow",
      "--shadow-md",
      "--shadow-lg",
      "--panel-fill",
      "--panel-fill-hover",
      "--card-fill",
      "--card-fill-hover",
      "--menu-panel-bg",
      "--dialog-bg",
      "--chrome",
      "--divider-soft",
    ])

    const cssFiles: string[] = [
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/tokens"), (path) => path.endsWith(".css")),
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/cascade"), (path) => path.endsWith(".css")),
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/surfaces"), (path) => path.endsWith(".css")),
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/components"), (path) => path.endsWith(".css")),
    ]

    const violations: string[] = []
    for (const file of cssFiles) {
      const css = withoutComments(readText(file))
      // Match top-level `:root { ... }` blocks. The architecture
      // guards forbid nested rules so a flat regex is sufficient.
      for (const match of css.matchAll(/(^|\})\s*:root(?:\[[^\]]+\])?\s*\{([^{}]*)\}/g)) {
        const body = match[2] ?? ""
        for (const declaration of body.split(";")) {
          const decl = declaration.trim()
          if (!decl) continue
          const colonIdx = decl.indexOf(":")
          if (colonIdx < 0) continue
          const prop = decl.slice(0, colonIdx).trim()
          const value = decl.slice(colonIdx + 1).trim()
          for (const varMatch of value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
            const ref = varMatch[1]!
            if (THEMED_PALETTE_TOKENS.has(ref)) {
              violations.push(`${file.replace(OVERLAY_ROOT, "")}: :root { ${prop}: ...var(${ref})... }`)
            }
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  test("icon button padding is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
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

  test("shared header background resolves from the cascade palette", () => {
    // Flat-redesign Step 0+ (2026-05-04): the indirection from
    // --oc-header-bg → --oc-color-surface-strong (themes/ palette)
    // was repointed to → --surface-strong (cascade/ palette) when
    // the duplicate themes/ directory was retired. Same for
    // --oc-titlebar-menu-text → --text-strong.
    const tokenText = readText(join(OVERLAY_ROOT, "src/styles/tokens/design-language.css"))
    const headerText = readText(join(OVERLAY_ROOT, "src/styles/surfaces/header.css"))

    expect(tokenText).toMatch(/--oc-header-bg:\s*var\(--surface-strong\)/)
    expect(tokenText).toMatch(/--oc-titlebar-menu-text:\s*var\(--text-strong\)/)
    expect(tokenText).not.toMatch(/--oc-titlebar-menu-text:\s*#[0-9a-fA-F]+/)
    expect(tokenText).not.toMatch(/--oc-header-bg:\s*var\(--oc-color-/)
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
        // --px-exact is an escape-hatch CSS custom property for px values
        // that MUST stay at exactly 1px (visually-hidden / layout-collapse).
        // Use a wider context slice because the property declaration can sit
        // more than 80 chars before the first 1px usage in the same block.
        const ctx = text.slice(Math.max(0, start - 300), start + match[0].length + 80)
        if (ctx.includes("--px-exact")) continue
        if (/styles[\\/]surfaces[\\/]field\.css$/.test(file) && ctx.includes("-webkit-autofill")) continue
        // The window must hold a `calc(...)` scope and a
        // `var(--ui-scale)` reference — proving the px scales with the
        // overlay's ui-scale knob. Earlier the regex matched a single
        // flat `calc(... var(--ui-scale) ...)` shape, but CSS allows
        // nested `var()` calls inside calc (e.g. `calc(var(--workflow
        // -depth) * 20px * var(--ui-scale))` which has a nested paren
        // pair from the inner var); split the assertion so the
        // structural check tolerates nested expressions.
        expect(window).toMatch(/calc\(/)
        expect(window).toMatch(/var\(--ui-scale[\s,)]/)
      }
    }
  })

  test("shared header surface is loaded after legacy styles while God CSS retires", () => {
    // styles.css was deleted 2026-05-04. The cascade now loads (in order):
    // tokens → themes → cascade/* → surfaces/* → header.css → card.css.
    // header.css must still load *after* the cross-cutting cascade layer
    // so its specificity wins. Anchor the assertion to cascade/typography.css
    // which is the last cross-cutting cascade file before per-surface chrome.
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))
    const cascadeAt = html.indexOf('href="styles/cascade/typography.css"')
    const headerAt = html.indexOf('href="styles/surfaces/header.css"')
    expect(cascadeAt).toBeGreaterThan(-1)
    expect(headerAt).toBeGreaterThan(cascadeAt)

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
    const rawColorValue = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i
    const pxLiteral = /(?<![\w-])-?\d+(?:\.\d+)?px\b/g
    expect(primitiveText).toContain("[data-variant=")
    expect(primitiveText).toContain("[data-size=")
    expect(primitiveText).toContain("[data-tone=")

    for (const file of files) {
      const css = withoutComments(readText(file))
      expect(css).not.toMatch(/!important\b/)
      expect(css).not.toMatch(/body\[|body:is\(|data-theme/)
      expect(css).not.toMatch(rawColorValue)

      for (const match of css.matchAll(pxLiteral)) {
        const start = match.index ?? 0
        const window = css.slice(Math.max(0, start - 80), start + match[0].length + 80)
        expect(window).toMatch(/calc\(/)
        expect(window).toMatch(/var\(--ui-scale[\s,)]/)
      }
    }
  })

  test("legacy button class callers cannot increase during primitive migration", () => {
    const counts = countLegacyButtonClassCallers()
    for (const className of LEGACY_BUTTON_CLASSES) {
      expect(counts[className]).toBeLessThanOrEqual(LEGACY_BUTTON_CALLER_LIMITS[className]!)
    }
    const totalLimit = Object.values(LEGACY_BUTTON_CALLER_LIMITS).reduce((total, value) => total + value, 0)
    expect(Object.values(counts).reduce((total, value) => total + value, 0)).toBeLessThanOrEqual(totalLimit)
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
