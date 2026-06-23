import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const REPO_ROOT = join(OVERLAY_ROOT, "..", "..")
const GOD_CSS_ARCHIVE_DIR = join(REPO_ROOT, "docs/archive/overlay-god-css")
const THIS_FILE = join(import.meta.dir, "overlay-architecture-guards.test.ts")
const SURFACE_DUPLICATE_SELECTOR_LIMITS = new Map<string, number>([
  ["activity.css", 21],
  ["card.css", 8],
  ["changes.css", 3],
  ["chat-bubble.css", 0],
  ["cmdk.css", 0],
  ["coding-assistant.css", 0],
  ["composer.css", 0],
  ["conn-banner.css", 0],
  ["conversation.css", 21],
  ["dialog.css", 2],
  ["diff.css", 7],
  ["empty-state.css", 5],
  ["field.css", 3],
  ["header.css", 1],
  ["inline-pill.css", 1],
  ["inspector.css", 6],
  ["markdown.css", 22],
  ["messages.css", 5],
  ["mission.css", 10],
  ["notifications.css", 0],
  ["settings.css", 13],
  ["sidebar.css", 9],
  ["titlebar.css", 11],
  ["workspace-onboarding.css", 4],
  ["workspace.css", 12],
])

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
  return cascadeFiles.map((file) => readFileSync(join(OVERLAY_ROOT, file), "utf8")).join("\n")
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
  const stack: Array<{ kind: "at-rule" | "keyframes" | "rule"; head: string }> = []
  const selectorCounts = new Map<string, number>()
  const text = withoutComments(css)
  let segmentStart = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === "{") {
      const head = text.slice(segmentStart, index).trim()
      if (head.startsWith("@")) {
        stack.push({
          kind: /^@(?:-[\w-]+-)?keyframes\b/.test(head) ? "keyframes" : "at-rule",
          head,
        })
      } else {
        if (!stack.some((item) => item.kind === "keyframes")) {
          const scope = stack
            .filter((item) => item.kind === "at-rule")
            .map((item) => item.head)
            .join(" | ")
          for (const selector of head
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)) {
            const key = `${scope}\0${selector}`
            selectorCounts.set(key, (selectorCounts.get(key) ?? 0) + 1)
          }
        }
        stack.push({ kind: "rule", head })
      }
      segmentStart = index + 1
    } else if (character === "}") {
      stack.pop()
      segmentStart = index + 1
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
  "project-group-heading",
]
const LEGACY_BUTTON_CALLER_LIMITS: Record<string, number> = {
  btn: 0,
  "btn-primary": 0,
  "chat-send": 0,
  "chat-interrupt": 0,
  "titlebar-btn": 0,
  "sidebar-btn": 0,
  "sidebar-tool": 0,
  "right-panel-tab": 0,
  "executor-chip": 0,
  "chat-toolbar-btn": 0,
  "titlebar-menubar-trigger": 0,
  "project-group-heading": 0,
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

  test("God CSS archive is retired and isolated from the runtime graph", () => {
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
    expect(existsSync(GOD_CSS_ARCHIVE_DIR)).toBe(false)
  })

  test("legacy style debt cannot increase while migration is in progress", () => {
    // Strip comments before counting — historical mentions in comments
    // (e.g., `/* this `!important` reset retired */`) shouldn't count as
    // live cascade debt. The live count tracks rule bodies and selectors
    // that the browser actually evaluates.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const card = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css")))
    const surfaceThemeSelectors = walkFiles(join(OVERLAY_ROOT, "src/styles/surfaces"), (path) =>
      path.endsWith(".css"),
    ).flatMap((file) =>
      readText(file)
        .split(/\r?\n/)
        .flatMap((line, index) =>
          /body(?:\[data-theme=|:is\([^)]*data-theme)/.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
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
    // (--hover-accent-border, --accent-glow, etc.)
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

  test("surface stylesheet duplicate selector debt cannot increase", () => {
    const surfaceRoot = join(OVERLAY_ROOT, "src/styles/surfaces")
    const surfaceFiles = walkFiles(surfaceRoot, (path) => path.endsWith(".css"))
      .map((path) => path.slice(surfaceRoot.length + 1).replace(/\\/g, "/"))
      .sort()
    expect(surfaceFiles).toEqual(Array.from(SURFACE_DUPLICATE_SELECTOR_LIMITS.keys()).sort())

    const overBudget: string[] = []
    for (const [file, limit] of SURFACE_DUPLICATE_SELECTOR_LIMITS) {
      const debt = countDuplicateSelectors(readText(join(surfaceRoot, file)))
      if (debt > limit) overBudget.push(`${file}: ${debt} > ${limit}`)
    }
    expect(overBudget).toEqual([])
  })

  test("retired agent-card and ndjson log stylesheets stay out of the runtime graph", () => {
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))
    expect(html).not.toContain('href="styles/surfaces/agent-card.css"')
    expect(existsSync(join(OVERLAY_ROOT, "src/styles/surfaces/agent-card.css"))).toBe(false)
    expect(html).not.toContain('href="styles/surfaces/ndjson-log.css"')
    expect(existsSync(join(OVERLAY_ROOT, "src/styles/surfaces/ndjson-log.css"))).toBe(false)
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
    for (const cls of ["btn-primary"]) {
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
    expect(dark).toMatch(/body\[data-theme="dark"\][\s\S]*?--accent-gradient:\s*var\(--accent\)/)
    expect(dark).toMatch(/body\[data-theme="dark"\][\s\S]*?--accent-gradient-hover:\s*var\(--accent-hover\)/)
    expect(vscodeDark).toMatch(/body\[data-theme="vscode-dark"\][\s\S]*?--accent-gradient:\s*var\(--accent\)/)
    expect(vscodeDark).toMatch(
      /body\[data-theme="vscode-dark"\][\s\S]*?--accent-gradient-hover:\s*var\(--accent-hover\)/,
    )
  })

  test("container shell + content shell families have no theme chrome override", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    // The shell families (`.sidebar` / `.chat` / `.sections` for the
    // three workbench columns; `.section` / `.gwg` for inspector cards;
    // `.chat-empty--task` for empty states) canonicalize on one surface
    // language.
    // Themes only swap palette behind those tokens; no `body[data-theme]`
    // selector touches the shell chrome.
    for (const cls of [
      "sidebar",
      "chat",
      "sections",
      "section",
      "gwg",
      "chat-empty--task",
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
    expect(workspace).toMatch(/^\.panel-body\s*\{[^}]*backdrop-filter:\s*var\(--panel-body-blur\)/m)
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

  test("--body-bg alpha is the single source for window translucency", () => {
    // Window-opacity slider must drive the body background alpha, not a
    // separate `body { opacity }` rule (rule 8 — single source). Each theme
    // file folds --ui-window-opacity into --body-bg via color-mix(); base.css
    // must NOT carry the legacy body-opacity declaration.
    const base = readText(join(OVERLAY_ROOT, "src/styles/cascade/base.css"))
    const bodyBlock = base.match(/^body\s*\{[^}]*\}/m)?.[0] ?? ""
    expect(bodyBlock).not.toMatch(/(?<!-)\bopacity\s*:/)

    for (const file of ["dark.css", "vscode-dark.css", "light.css"] as const) {
      const css = readText(join(OVERLAY_ROOT, "src/styles/cascade", file))
      const decl = css.match(/--body-bg\s*:\s*[^;]+;/)?.[0] ?? ""
      expect(decl).toContain("var(--ui-window-opacity)")
    }
  })

  test("vscode-dark :root surfaces transparent palette tokens for shell columns", () => {
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
    expect(lastBlock!).toMatch(/--rail-surface:\s*color-mix\(in srgb,\s*var\(--surface\)/)
    expect(lastBlock!).toMatch(/--chat-canvas:\s*color-mix\(in srgb,\s*var\(--bg\)/)
    expect(lastBlock!).toMatch(/--inspector-surface:\s*color-mix\(in srgb,\s*var\(--surface\)/)
  })

  test("inline-pill family has no theme chrome override", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    // task-row-badge / section-badge / gwg-priority-badge /
    // change-status / diff-dialog-stat all converged on the iter15+
    // "dot-prefix" canonical (transparent base + variant tint via dim tokens
    // + colored ::before). No theme selector is allowed to re-paint a
    // panel-tint background or border-color over them — that pattern masks
    // the variant differentiation and reintroduces themes owning component
    // chrome. (.llm-status / .llm-notice were retired 2026-05-04 — no
    // remaining call sites in TS/TSX/HTML.)
    expect(readText(join(OVERLAY_ROOT, "src/styles/surfaces/inline-pill.css"))).not.toContain(".extension-status")
    for (const cls of [
      "task-row-badge",
      "section-badge",
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
    expect(sharedRule![1]).toContain("--oc-button-color: var(--text-on-accent)")
    expect(sharedRule![1]).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba\(|hsla\(/)
    expect(styles).not.toContain(".board-intro__cta-action")
  })

  test("retired titlebar status utility shell stays out of titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of [
      "titlebar-status-chip",
      "titlebar-setup-cta",
      "titlebar-status-icon",
      "titlebar-task-status",
      "titlebar-status-label",
      "titlebar-status-value",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|[,{:#.>+~\\[])`))
      expect(titlebarSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|[,{:#.>+~\\[])`))
    }

    expect(styles).not.toMatch(/^\.status-icon\b/m)
    expect(titlebarSurface).toMatch(/\.status-icon\s*\{/)
    expect(titlebarSurface).toMatch(/\.status-icon\[data-status="completed"\]/)
    expect(titlebarSurface).toContain("var(--oc-titlebar-status-icon)")
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
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
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
      "task-row-head",
      "task-row-stamp",
      "task-row-badge",
      "task-row-badge-text",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(sidebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(styles).not.toMatch(/(^|\n)\.task-row-main\s*\{/)
    expect(sidebarSurface).not.toMatch(/(^|\n)\.task-row-main\s*\{/)
    expect(sidebarSurface).toMatch(/(^|\n)\.oc-button\[data-ui="ledger-row-main"\]\s*\{/)
    expect(sidebarSurface).toMatch(/(^|\n)\.oc-button\[data-ui="ledger-row-main"\]\s+strong\s*\{/)
    expect(sidebarSurface).toMatch(/\.task-row-badge::before\s*\{/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="active"\]/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="queued"\]/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="completed"\]/)
    expect(sidebarSurface).toMatch(/\.task-row-badge\[data-status="failed"\]/)
    expect(sidebarSurface).toMatch(/\.task-row-mini\[data-draggable="true"\]:hover \.task-row-drag-handle/)
    expect(sidebarSurface).not.toMatch(/\.task-row-meta\b/)
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
      "sidebar-list-cluster",
      "project-group",
      "project-group-copy",
      "project-group-name",
      "project-group-parent",
      "project-group-body",
      "project-group-show-more",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(sidebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(sidebarSurface).toMatch(/\.sidebar-footer a:hover\s*\{/)
    expect(sidebarSurface).toMatch(/\.sidebar-list\.session-list-panel\s*\{/)
    expect(sidebarSurface).not.toMatch(/\.project-group-heading\b/)
    expect(sidebarSurface).toContain('.project-group .oc-button[data-ui="project-group-toggle"]')
    expect(sidebarSurface).toMatch(/\.project-group-icon\s*\{/)
    expect(sidebarSurface).toMatch(/@keyframes project-group-body-reveal\s*\{/)
    expect(sidebarSurface).not.toMatch(/data-active-project/)
    expect(sidebarSurface).not.toMatch(/\.sidebar-list-heading\b/)
  })

  test("sidebar shell + tool family are owned by surfaces/sidebar.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const sidebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of ["sidebar", "sidebar-title", "sidebar-header-actions"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(sidebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(sidebarSurface).not.toMatch(/\.sidebar-subtitle\b/)
    expect(sidebarSurface).toMatch(/\.sidebar\[data-collapsed="true"\]\s*\{/)
    expect(sidebarSurface).toContain("--ui-collapsed-pane-width")
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

    for (const className of ["sections", "sections-title", "sections-stack", "right-activity-body"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(html).not.toContain("sections-tab-body")
    expect(inspectorSurface).toMatch(/\.right-activity-body\[data-active="false"\]/)
    expect(inspectorSurface).toMatch(/\.right-activity-body\[data-side-activity\]/)
    expect(inspectorSurface).not.toContain("sections-tab-body")
    expect(inspectorSurface).not.toMatch(/\.right-activity-body\[data-panel-tab=/)
    expect(inspectorSurface).toContain("var(--inspector-surface)")
    expect(inspectorSurface).toContain("--ui-collapsed-pane-width")

    const inspectorAt = html.indexOf('href="styles/surfaces/inspector.css"')
    expect(inspectorAt).toBeGreaterThan(-1)
  })

  test("retired inspector section icon button stays removed", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const sectionPrimitive = readText(join(OVERLAY_ROOT, "src/components/primitives/Section.tsx"))

    // Deleted frontend-preview family must not reappear in either layer.
    for (const className of [
      "frontend-preview",
      "frontend-preview-toolbar",
      "frontend-preview-url",
      "frontend-preview-frame",
      "frontend-preview-empty",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(styles).not.toMatch(/\.oc-section__icon-btn\b/)
    expect(inspectorSurface).not.toMatch(/\.oc-section__icon-btn\b/)
    expect(sectionPrimitive).not.toContain("oc-section__icon-btn")
    expect(sectionPrimitive).not.toMatch(/^\s*actions\??:/m)
    expect(sectionPrimitive).not.toContain("local.actions")
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
    for (const className of ["section-icon", "section-title", "section-badge", "section-body"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(inspectorSurface).not.toMatch(/\.section-head-action\b/)
    expect(inspectorSurface).not.toMatch(/\.section-actions\b/)

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
    expect(inspectorSurface).toMatch(/\.oc-section__head:hover,\s*\.oc-section__head:focus-visible\s*\{/)
    expect(inspectorSurface).toMatch(
      /\.oc-section\s*>\s*\.oc-section__head:focus-visible\s*\{[\s\S]*?box-shadow:\s*inset 0 0 0 var\(--oc-border-width\) var\(--accent\);/,
    )
    expect(inspectorSurface).not.toMatch(/\.oc-section[^{}]*\.oc-section__head:focus-visible\s*\{[^}]*outline:\s*none/s)
    expect(inspectorSurface).toContain("var(--ui-highlight-tone)")
  })

  test("gwg body + objective are owned by surfaces/inspector.css without retired action buttons", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
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

    for (const className of ["gwg-action-btn", "gwg-action-delete"]) {
      expect(inspectorSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[|-)`))
    }
    expect(inspectorSurface).toContain("var(--ui-highlight-tone)")
  })

  test("task action buttons keep shared Button primitive dimensions inside inspector", () => {
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const boardSource = readText(join(OVERLAY_ROOT, "src/components/Board.tsx"))

    expect(boardSource).toContain('class="task-actions-buttons"')
    expect(boardSource).toContain("<Button")
    expect(boardSource).toContain('data-task-action="cancel"')
    expect(boardSource).toContain('title={t("task.action.cancel_title")}')
    expect(inspectorSurface).not.toMatch(/\.task-actions-buttons\s+\.oc-button\s*\{/)
    expect(inspectorSurface).not.toMatch(/\.task-actions-buttons\s+\.oc-button::before\s*\{/)
    expect(inspectorSurface).not.toMatch(/\.task-actions-buttons\s+\.oc-button[^{]*--oc-button-height:\s*auto/s)
    expect(inspectorSurface).not.toMatch(/\.task-actions-buttons\s+\.oc-button[^{]*min-height:\s*auto/s)
  })

  test("task dir bar (TaskDirBar) is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))

    for (const className of [
      "task-meta",
      "task-cwd",
      "task-dir",
      "vcs-badge",
      "vcs-badge-icon",
      "vcs-badge-branch",
      "task-dir-shell",
      "task-cwd-dropdown",
      "task-cwd-caret",
      "task-dir-actions",
      "task-dir-menu-actions",
      "task-dir-path",
      "task-dir-tool",
      "task-dir-node",
      "task-dir-step",
      "task-dir-empty",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|,|\\{)`))
    }

    for (const tone of ["good", "warn", "bad"]) {
      expect(conversationSurface).toMatch(new RegExp(`\\.vcs-badge\\[data-tone="${tone}"\\]\\s*\\{`))
    }
    expect(conversationSurface).toMatch(/\.task-cwd-dropdown:hover,\s*\.task-cwd-dropdown:focus-within\s*\{/)
    expect(conversationSurface).toContain('.task-cwd-dropdown:has(.oc-button[data-ui="cwd-recent-trigger"][data-expanded])')
    expect(conversationSurface).toContain(
      '.task-dir-menu-actions .oc-button[data-ui="cwd-recent-trigger"][data-expanded] .task-cwd-caret',
    )
    expect(conversationSurface).not.toContain('.task-cwd-dropdown[data-open="true"]')
    expect(conversationSurface).toMatch(/\.oc-button\[data-ui="project-worktree-dropdown"\]\[data-expanded\]\s*\{/)
    expect(conversationSurface).not.toContain('.oc-button[data-ui="project-worktree-dropdown"][data-open="true"]')
    expect(conversationSurface).toMatch(
      /\.task-dir-menu-actions \.oc-button\[data-ui="cwd-recent-trigger"\]:hover,\s*\.task-dir-menu-actions \.oc-button\[data-ui="cwd-recent-trigger"\]:focus-visible,/,
    )
    expect(conversationSurface).not.toContain('.oc-button[data-ui="cwd-recent-trigger"][data-open="true"]')
    expect(conversationSurface).not.toContain(".task-dir-recent-trigger")
    expect(conversationSurface).toMatch(/\.task-dir-tool\.danger:hover,\s*\.task-dir-tool\.danger:focus-visible\s*\{/)
    expect(conversationSurface).not.toMatch(/#94a3b8/)
    expect(conversationSurface).not.toMatch(/#e5e7eb/)
    expect(conversationSurface).not.toMatch(/rgba\(248,\s*113,\s*113/)
  })

  test("task bar, task status, and recent dir panel are owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))
    const sourceText = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:css|ts|tsx|html)$/.test(path))
      .map((path) => readText(path))
      .join("\n")

    for (const className of ["task-bar-main", "task-cwd-actions", "task-flag"]) {
      expect(sourceText).not.toMatch(new RegExp(`\\b${className}\\b`))
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[)`))
      expect(conversationSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[)`))
    }

    for (const className of [
      "task-bar",
      "task-status",
      "status-label",
      "workspace-command-dock",
      "workspace-command-divider",
      "workspace-editor-launchers",
      "workspace-coding-cli-launchers",
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
    expect(conversationSurface).not.toContain(".workspace-split-launcher-primary")
    expect(conversationSurface).not.toContain(".workspace-split-launcher-menu-button")
    expect(conversationSurface).toContain('.workspace-command-dock .oc-button[data-chrome^="workspace-split"]')
    expect(conversationSurface).toContain('.workspace-command-dock .oc-button[data-chrome="workspace-split-primary"]')
    expect(conversationSurface).toContain('.workspace-command-dock .oc-button[data-chrome="workspace-split-menu"]')
    expect(conversationSurface).toContain('.workspace-command-dock .oc-button[data-chrome="workspace-split-menu"][data-expanded]')
    expect(conversationSurface).not.toContain('.workspace-command-dock .oc-button[data-chrome="workspace-split-menu"][data-open="true"]')
    expect(conversationSurface).not.toMatch(/border-radius:\s*999px/)
    expect(conversationSurface).not.toMatch(/rgba\(116,\s*133,\s*184/)
    expect(conversationSurface).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.62\)/)

    expect(conversationSurface).toMatch(/\.task-bar:hover,\s*\.task-bar:focus-within\s*\{/)
    expect(conversationSurface).toMatch(
      /\.task-bar\s*\{[\s\S]*?border-bottom:\s*var\(--oc-border-width\)\s+solid\s+var\(--task-bar-border-color\)/,
    )
    expect(conversationSurface).toMatch(/\.task-bar\s*\{[\s\S]*?background:\s*var\(--task-bar-bg\)/)
    expect(conversationSurface).toMatch(/\.task-bar\s*\{[\s\S]*?backdrop-filter:\s*var\(--task-bar-backdrop-filter\)/)
    expect(conversationSurface).not.toMatch(
      /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))[\s\S]*?\.task-bar\b/,
    )
    expect(conversationSurface).toMatch(
      /\.recent-dir-row:hover,\s*\.recent-dir-row:focus-within\s*\{/,
    )
    expect(conversationSurface).toMatch(/\.recent-dir-row\[data-active="true"\]\s*\{/)
  })

  test("executor chip and selector family are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "executor-dualbar",
      "executor-chip-slot",
      "executor-chip-copy",
      "executor-chip-label-row",
      "executor-chip-label",
      "executor-chip-value",
      "executor-chip-caret",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const className of [
      "executor-chip-identity",
      "executor-chip-model",
      "executor-chip-provider",
      "executor-chip-name",
    ]) {
      expect(composerSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[)`))
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

    expect(composerSurface).toMatch(/\.executor-chip-slot \.oc-button\[data-ui\^="executor-chip-"\]\s*\{/)
    expect(composerSurface).toMatch(
      /\.executor-chip-slot \.oc-button\[data-ui\^="executor-chip-"\]:hover,\s*\.executor-chip-slot \.oc-button\[data-ui\^="executor-chip-"\]:focus-visible\s*\{/,
    )
    expect(composerSurface).toMatch(/\.executor-chip-slot \.oc-button\[data-ui\^="executor-chip-"\]\[data-expanded\]\s*\{/)
    expect(composerSurface).not.toContain('.executor-chip-slot[data-open="true"] .oc-button[data-ui^="executor-chip-"]')
    expect(composerSurface).toMatch(/\.executor-chip-value\[data-empty="true"\]/)
  })

  test("retired workspace panel shell stays out of surfaces/workspace.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const workspaceSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css"))
    const activitySurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/activity.css"))
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
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(workspaceSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|[\\[{:#.>+~,])`))
    }

    for (const className of [
      "diff-preview-panel",
      // diff-preview-head replaced by .oc-panel__header override in Step 9.E
      "diff-preview-copy",
      "diff-preview-scope",
      "diff-preview-path",
      "diff-preview-meta",
      "diff-preview-body",
      "diff-preview-empty",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(workspaceSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    // diff-preview-head was replaced by a .oc-panel__header override
    expect(workspaceSurface).toMatch(/\.diff-preview-panel > \.oc-panel__header\s*\{/)
    expect(workspaceSurface).not.toMatch(/(^|\n)\.diff-preview-head\s*\{/)
    expect(workspaceSurface).not.toContain("file-view")

    expect(styles).not.toMatch(/(^|\n)\.pane-resizer\.pane-resizer-workspace\s*\{/)
    expect(workspaceSurface).not.toMatch(/\.pane-resizer\.pane-resizer-workspace\s*\{/)
    expect(styles).not.toMatch(/(^|\n)code \.file-link\s*\{/)
    expect(workspaceSurface).toMatch(/code \.file-link\s*\{/)
    expect(readText(join(OVERLAY_ROOT, "src/styles/surfaces/messages.css"))).not.toMatch(
      /(^|\n)\.(?:path-box|path-link)(?:\s|:|\{)/,
    )

    expect(workspaceSurface).toContain("var(--oc-border-width)")
    expect(workspaceSurface).not.toMatch(/border-radius:\s*999px/)
    expect(workspaceSurface).not.toMatch(/rgba\(/)
    expect(workspaceSurface).not.toMatch(/var\(--accent,\s*#/)

    const workspaceAt = html.indexOf('href="styles/surfaces/workspace.css"')
    expect(workspaceAt).toBeGreaterThan(-1)

    expect(html).not.toContain("btnWorkspaceToggle")
    expect(workspaceSurface).not.toContain(".workspace-toggle")
    expect(workspaceSurface).not.toContain(".chat-plugin-activity")
    expect(workspaceSurface).not.toContain(".chat-plugin-outlet")
    expect(activitySurface).not.toContain(".chat-plugin-activity")
    expect(activitySurface).not.toContain(".chat-plugin-outlet")
    expect(workspaceSurface).not.toMatch(/\.pane-resizer\.pane-resizer-workspace::before\s*\{/)
    expect(workspaceSurface).not.toMatch(/\.pane-resizer\.pane-resizer-workspace:hover::before/)
    expect(workspaceSurface).not.toMatch(/\.pane-resizer:hover::before/)
    expect(activitySurface).toMatch(/\.file-changes-diff-header \.oc-button\[data-ui="file-changes-diff-close"\]\s*\{/)
    expect(workspaceSurface).toMatch(/code \.file-link:hover,\s*code \.file-link:focus-visible\s*\{/)
    expect(workspaceSurface).toMatch(
      /code \.file-link:focus-visible\s*\{[\s\S]*outline:\s*var\(--oc-border-width\) solid var\(--accent\);/,
    )
    expect(soloRuleBody(workspaceSurface, "code .file-link:focus-visible")).not.toContain("outline: none")
  })

  test("conn-banner routes action controls through the shared Button primitive", () => {
    // Canonical extracted from styles.css into surfaces/conn-banner.css —
    // the banner is mounted globally via fixed positioning by App.tsx /
    // ConnectionBanner.tsx, so it owns its own surface file.
    const styles = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conn-banner.css"))
    const source = readText(join(OVERLAY_ROOT, "src/components/ConnectionBanner.tsx"))

    const block = styles.match(/\.conn-banner\s*\{[\s\S]*?\.conn-banner__text\s*\{[^}]*\}/)?.[0]
    expect(block).toBeTruthy()
    const body = block ?? ""

    expect(body).toContain("var(--oc-radius-pill)")
    expect(body).toContain("var(--oc-border-width)")
    expect(body).toContain("pointer-events: auto;")
    expect(body).not.toMatch(/border-radius:\s*999px/)
    expect(body).not.toMatch(/border:\s*1px solid/)
    expect(body).not.toMatch(/rgba\(0,\s*0,\s*0/)

    // Status variants must remain.
    expect(body).toMatch(/\.conn-banner\[data-status="connecting"\]\s*\{/)
    expect(body).toMatch(/\.conn-banner__dot\s*\{/)
    expect(body).not.toMatch(/@keyframes conn-banner-pulse\s*\{/)
    expect(styles).not.toContain(".conn-banner__action")
    expect(source).toContain('import { Button } from "./ui/Button"')
    expect(source).toContain('data-ui="connection-banner-setup"')
    expect(source).toContain('data-ui="connection-banner-reload"')
    expect(source).toContain('variant="ghost"')
    expect(source).toContain('size="sm"')
    expect(source).not.toContain('class="conn-banner__action"')
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

    for (const variant of ["pass", "accepted", "concerns", "needs_correction", "rejected", "inflight", "empty"]) {
      expect(block).toContain(`data-verdict="${variant}"`)
    }

    // Single-source assertion: the canonical no longer lives in
    // styles.css. This catches accidental copy-paste during future
    // strips that would re-introduce double sourcing per rule 8.
    expect(styles).not.toMatch(/^\.verdict-pill\s*\{/m)
  })

  test("executor popover surface is owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of [
      "executor-popover",
      "executor-popover-header",
      "executor-popover-title",
      "executor-popover-hint",
      "executor-popover-body",
      "executor-popover-empty",
      "executor-popover-group",
      "executor-model-listbox",
      "executor-model-option",
      "executor-model-option-label",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(composerSurface).toMatch(/\.oc-tabs\[data-ui="executor-popover-tabs"\]\s*\{/)
    expect(composerSurface).toMatch(/\.oc-tab\[data-ui="executor-popover-tab"\]\s*\{/)
    expect(composerSurface).toMatch(/\.oc-tab\[data-ui="executor-popover-tab"\]\[data-selected\]\s*\{/)
    expect(composerSurface).toMatch(/\.executor-model-option\[data-selected\]\s*\{/)
    expect(composerSurface).toMatch(/\.executor-model-option\[data-highlighted\]\s*\{/)
    expect(composerSurface).not.toContain(".executor-model-option[data-focused]")
    expect(composerSurface).not.toMatch(/rgba\(146,\s*184,\s*252/)
    expect(composerSurface).not.toMatch(/rgba\(86,\s*126,\s*196/)
    expect(composerSurface).not.toMatch(/rgba\(196,\s*215,\s*252/)
  })

  test("prompt catalog profile preview is owned by surfaces/settings.css without retired editor chrome", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of ["prompt-preview-card", "prompt-preview-body"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const className of [
      "prompt-grid",
      "prompt-card",
      "prompt-card-copy",
      "prompt-editor",
      "prompt-editor-head",
      "prompt-editor-actions",
      "prompt-textarea",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).not.toMatch(/\.prompt-card-head\s*\{/)
    expect(settingsSurface).not.toMatch(/\.prompt-card-copy span,\s*\.prompt-card-copy small\s*\{/)
    expect(settingsSurface).not.toMatch(/\.prompt-preview-head\s*\{/)
    expect(settingsSurface).not.toMatch(/\.oc-tabs\[data-ui="prompt-view-tabs"\]\s*\{/)
    expect(settingsSurface).not.toMatch(/\.oc-tab\[data-ui="prompt-view-tab"\]\s*\{/)
    expect(settingsSurface).not.toMatch(/\.oc-tab\[data-ui="prompt-view-tab"\]\[data-active="true"\]\s*\{/)
    expect(settingsSurface).not.toMatch(/\.prompt-diff-details\s*\{/)
    expect(settingsSurface).not.toMatch(/\.prompt-diff-summary\s*\{/)
    expect(settingsSurface).not.toMatch(/\.prompt-preview-card--default\s*\{/)
    expect(settingsSurface).toMatch(/\.prompt-preview-card--attached\s*\{/)
  })

  test("config-status-box and about panel are owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    // .config-status-box appears in a cross-surface multi-class
    // typography rule that shares font-size with .field-label /
    // .knowledge-item-meta — only assert it lives in the surface,
    // not that it's absent from styles.
    for (const className of [
      "about-body",
      "about-section",
      "about-section-title",
      "about-author-card",
      "about-author-avatar",
      "about-author-info",
      "about-author-name",
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
    expect(settingsSurface).not.toMatch(/(^|\n)\.about-author-link(?:\s|:|\{)/)
    expect(readText(join(OVERLAY_ROOT, "src/components/ConfigDialogHost.tsx"))).not.toContain("about-author-link")
    expect(settingsSurface).toMatch(/(^|\n)\.config-status-box\s*\{/)
    expect(() => soloRuleBody(styles, ".config-status-box")).toThrow()

    for (const status of ["active", "warn", "error"]) {
      expect(settingsSurface).toMatch(new RegExp(`\\.config-status-box\\[data-status="${status}"\\]\\s*\\{`))
    }
    expect(settingsSurface).toMatch(/\.about-link:hover\s*\{/)
    expect(settingsSurface).toMatch(
      /\.about-link:focus-visible\s*\{[\s\S]*outline:\s*var\(--oc-border-width\) solid var\(--accent\);/,
    )
    expect(soloRuleBody(settingsSurface, ".about-link:focus-visible")).not.toContain("outline: none")
    expect(settingsSurface).toMatch(/\.about-shortcut-grid kbd\s*\{/)
    expect(settingsSurface).toMatch(/\.about-shortcut-grid span\s*\{/)
  })

  test("about panel links target distinct project destinations", () => {
    const configDialog = readText(join(OVERLAY_ROOT, "src/components/ConfigDialogHost.tsx"))

    expect(configDialog).toContain("const ABOUT_LINKS")
    expect(configDialog).toContain('href: "https://github.com/yangheng95"')
    expect(configDialog).toContain('href: "https://github.com/yangheng95/opencorvus/issues"')
    expect(configDialog).toContain('{t("about.links")}')
    expect(configDialog).toContain('label: () => t("about.issues")')
    expect(configDialog).toContain('<For each={ABOUT_LINKS}>')
    expect(configDialog).not.toContain('href="https://github.com/yangheng95"')
  })

  test("retired settings section + subsection shells stay removed from settings.css", () => {
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of ["config-section-body", "extension-settings-body"]) {
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
    expect(settingsSurface).toMatch(/(^|\n)\.extension-settings-group(?:\s|\[|\+|\.)/)

    for (const className of [
      "config-section",
      "config-section-head",
      "config-section-head-text",
      "config-subsection",
      "config-subsection-head",
      "config-subsection-body",
      "ext-group",
      "ext-group-body",
    ]) {
      expect(settingsSurface).not.toMatch(new RegExp(`(^|[\\n,{])\\s*\\.${className}(?:\\s|[,>{:+~.#\\[]|$)`, "m"))
    }

    expect(settingsSurface).toMatch(/\.extension-settings-group \+ \.extension-settings-group\s*\{/)
    expect(settingsSurface).not.toMatch(/rgba\(91,\s*141,\s*239/)

    expect(() => soloRuleBody(readLegacyStylesCss("src/styles.css"), ".config-section")).toThrow()
    expect(() => soloRuleBody(readLegacyStylesCss("src/styles.css"), ".config-subsection")).toThrow()
  })

  test("settings content panel + resizer are owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of ["config-content", "config-tab-panel", "config-resizer"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(settingsSurface).not.toMatch(/\.config-tab-panel\.active\s*\{/)
    expect(settingsSurface).toMatch(/\.config-tab-panel\s*\{/)
    expect(settingsSurface).toMatch(/\.config-tab-panel \> \.config-section-body\s*\{/)
    expect(settingsSurface).not.toMatch(/\.config-content \.config-subsection/)
    expect(settingsSurface).toMatch(/\.config-content \.extension-head,\s*\.config-content \.knowledge-toolbar\s*\{/)
    expect(settingsSurface).toMatch(/\.config-resizer::before\s*\{/)
    expect(settingsSurface).toMatch(
      /\.config-resizer:hover::before,\s*\.config-resizer:focus-visible::before,\s*\.config-resizer\[data-active="true"\]::before\s*\{/,
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

  test("settings sidebar nav is owned by the shared Tabs primitive and surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))
    const configDialog = readText(join(OVERLAY_ROOT, "src/components/ConfigDialogHost.tsx"))

    for (const className of ["config-sidebar", "config-nav-icon", "config-nav-badge"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
    expect(configDialog).toContain('import { Button } from "./ui/Button"')
    expect(configDialog).toContain("<Button")
    expect(configDialog).toContain('data-ui="config-dialog-close"')
    expect(configDialog).toContain('id="btnCloseConfigDialog"')
    expect(configDialog).not.toContain('class="config-close-btn"')
    expect(settingsSurface).not.toMatch(/(^|\n)\.config-close-btn\b/)
    expect(settingsSurface).toMatch(/\.dialog-header-actions \.oc-button\[data-ui="config-dialog-close"\]\s*\{/)
    for (const className of ["config-nav-item", "config-nav-spacer"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(configDialog).not.toContain(className)
    }

    expect(settingsSurface).toMatch(/(^|\n)\.config-dialog-layout\s*\{/)
    const layoutBody = settingsSurface.match(/(^|\n)\.config-dialog-layout\s*\{([^}]*)\}/)?.[2] ?? ""
    expect(layoutBody).toContain("display: flex")
    expect(layoutBody).toContain("flex: 1")
    expect(layoutBody).toContain("overflow: hidden")

    expect(settingsSurface).toMatch(
      /\.dialog-header-actions \.oc-button\[data-ui="config-dialog-close"\]:hover,\s*\.dialog-header-actions \.oc-button\[data-ui="config-dialog-close"\]:focus-visible\s*\{/,
    )
    const sidebarBody = settingsSurface.match(/(^|\n)\.config-sidebar\s*\{([^}]*)\}/)?.[2] ?? ""
    expect(sidebarBody).toContain("background: transparent")
    expect(configDialog).toContain('import { Tab, TabList, TabPanel, Tabs } from "./ui/Tabs"')
    expect(configDialog).toContain("<Tabs")
    expect(configDialog).toContain("<TabList")
    expect(configDialog).toContain("<TabPanel")
    expect(configDialog).toContain("onValueChange={switchConfigTab}")
    expect(configDialog).toContain('orientation="vertical"')
    expect(settingsSurface).toMatch(/\.config-sidebar \.oc-tabs\s*\{/)
    expect(settingsSurface).toMatch(/\.config-sidebar \.oc-tab\s*\{/)
    expect(settingsSurface).toMatch(/\.config-sidebar \.oc-tab\[data-selected\]\s*\{/)
    expect(settingsSurface).toMatch(/\.config-sidebar \.oc-tab\[data-selected\]::before\s*\{/)
    expect(settingsSurface).toMatch(/\.config-sidebar \.oc-tab\[data-selected\] \.config-nav-icon\s*\{/)
    expect(settingsSurface).toMatch(/\.config-sidebar \.oc-tab\[data-selected\] \.config-nav-badge\s*\{/)
    expect(settingsSurface).not.toMatch(/rgba\(84,\s*138,\s*247,\s*0\.15\)/)
    expect(settingsSurface).not.toMatch(/rgba\(84,\s*138,\s*247,\s*0\.2\)/)
  })

  test("log viewer is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const className of [
      "log-viewer",
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

    const channelDocBody = settingsSurface.match(/(^|\n)\.channel-doc-card\s*\{([^}]*)\}/)?.[2] ?? ""
    expect(channelDocBody).toContain("transition:")
    expect(channelDocBody).toContain("border: 0")

    const marketCardBody = settingsSurface.match(/(^|\n)\.market-card\s*\{([^}]*)\}/)?.[2] ?? ""
    expect(marketCardBody).toContain("background: transparent")
    expect(marketCardBody).toContain("border: 0")
    expect(marketCardBody).toContain("border-radius: 0")
    expect(settingsSurface).toMatch(/\.market-card:hover,\s*\.market-card:focus-within\s*\{/)
  })

  test("extensions panel block + row is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))
    const sourceText = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:css|ts|tsx|html)$/.test(path))
      .map((path) => readText(path))
      .join("\n")

    for (const className of ["extension-block", "extension-policy"]) {
      expect(sourceText).not.toMatch(new RegExp(`\\b${className}\\b`))
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const className of ["extension-head", "extension-list"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
    for (const className of ["extension-settings-row", "extension-settings-actions"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|\\{)`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|\\{)`))
    }
    for (const className of ["extension-row", "extension-row-main", "extension-row-actions"]) {
      expect(sourceText).not.toMatch(new RegExp(`\\b${className}\\b`))
      expect(settingsSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\{|\\.)`))
    }

    expect(settingsSurface).toMatch(/\.extension-head:hover,\s*\.extension-head:focus-within\s*\{/)
    expect(settingsSurface).toMatch(/\.extension-settings-row \.s-row-desc,\s*\.extension-settings-row \.s-row-meta\s*\{/)
    const titleBody = soloRuleBody(settingsSurface, ".extension-settings-row .s-row-title")
    expect(titleBody).toContain("display: inline-flex")
    expect(titleBody).toContain("gap: calc(6px * var(--ui-scale))")
    expect(titleBody).toContain("min-width: 0")
    expect(settingsSurface).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.04\)/)
  })

  test("knowledge / memory panel is owned by surfaces/settings.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))
    const activitySurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/activity.css"))
    const memoryPanelSource = readText(join(OVERLAY_ROOT, "src/components/MemoryPanel.tsx"))
    const sourceText = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:css|ts|tsx|html)$/.test(path))
      .map((path) => readText(path))
      .join("\n")

    for (const className of ["knowledge-item-actions", "knowledge-delete", "knowledge-search"]) {
      expect(sourceText).not.toMatch(new RegExp(`\\b${className}\\b`))
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(activitySurface).not.toMatch(new RegExp(`(^|\\n)\\.sidebar-tool-panel\\s+\\.${className}(?:\\s|,|\\{)`))
    }

    for (const className of [
      "knowledge-toolbar",
      "knowledge-list",
      "knowledge-item",
      "knowledge-item-main",
      "knowledge-item-title",
      "knowledge-item-meta",
      "knowledge-item-meta-row",
      "knowledge-scope",
      "memory-inline-detail",
      "memory-detail-meta",
      "memory-detail-content",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(memoryPanelSource).toContain('class="memory-search search-field"')
    expect(memoryPanelSource).toContain('class="memory-search-input search-field-input"')
    expect(memoryPanelSource).toContain('data-ui="memory-search-clear"')
    expect(settingsSurface).toMatch(/\.knowledge-toolbar \.memory-search\s*\{/)
    expect(settingsSurface).toMatch(/\.knowledge-toolbar:hover,\s*\.knowledge-toolbar:focus-within\s*\{/)
    expect(settingsSurface).toMatch(/\.memory-panel\[data-compact="true"\] \.knowledge-toolbar\s*\{/)
    expect(settingsSurface).toMatch(/\.memory-panel\[data-compact="true"\] \.knowledge-list\s*\{/)
    expect(settingsSurface).toMatch(/\.memory-panel\[data-compact="true"\] \.knowledge-item\s*\{/)
    expect(settingsSurface).toMatch(/\.memory-panel\[data-compact="true"\] \.memory-inline-detail\s*\{/)
    expect(settingsSurface).toMatch(/\.knowledge-item\[data-mode="search"\]/)
    for (const variant of ["global", "session"]) {
      expect(settingsSurface).toMatch(new RegExp(`\\.knowledge-scope\\[data-scope="${variant}"\\]`))
    }
    for (const className of [
      "memory-panel",
      "knowledge-list",
      "knowledge-item",
      "knowledge-item-row",
      "knowledge-item-main",
      "knowledge-item-title",
      "knowledge-item-meta",
      "knowledge-item-meta-row",
      "knowledge-scope",
      "memory-inline-detail",
      "memory-detail-meta",
      "memory-detail-content",
    ]) {
      expect(activitySurface).not.toMatch(new RegExp(`\\.sidebar-tool-panel\\s+\\.${className}\\b`))
    }
    expect(settingsSurface).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.04\)/)
  })

  test("permissions panel uses the .s-* settings primitives", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))
    const panelSource = readText(join(OVERLAY_ROOT, "src/components/settings/PermissionsPanel.tsx"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    // Legacy perm-* class family was deleted on 2026-05-26 when the
    // panel migrated onto the primitives. The guard now asserts the
    // *absence* of the old classes anywhere, plus that the panel uses
    // the new primitive components.
    for (const legacy of [
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
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${legacy}\\s*\\{`))
      expect(settingsSurface).not.toMatch(new RegExp(`(^|\\n)\\.${legacy}\\s*\\{`))
      expect(panelSource).not.toContain(`class="${legacy}`)
      expect(panelSource).not.toContain(`"${legacy}"`)
    }

    // Primitive ownership: the .s-* contract lives in settings.css and
    // the panel imports the matching Solid components.
    for (const primitive of [
      "s-panel",
      "s-group",
      "s-group-head",
      "s-group-body",
      "s-row",
      "s-row-main",
      "s-row-title",
      "s-row-desc",
      "s-row-actions",
      "s-pill",
      "s-segmented",
      "s-segmented-btn",
    ]) {
      expect(settingsSurface).toMatch(new RegExp(`(^|\\n)\\.${primitive}\\s*[\\[\\{,:+>~]`))
    }
    for (const component of ["SettingsPanel", "SettingsGroup", "SettingsRow", "SettingsSegmented"]) {
      expect(panelSource).toContain(component)
    }

    // Segmented tone wiring stays semantic — allow/ask/deny still route
    // through good/warn/bad via data-tone, just on the primitive class.
    for (const tone of ["ok", "warn", "bad"]) {
      expect(settingsSurface).toMatch(
        new RegExp(`\\.s-segmented-btn\\[data-pressed\\]\\[data-tone="${tone}"\\]\\s*\\{`),
      )
    }

    expect(settingsSurface).toMatch(/\.s-segmented-btn:focus-visible\s*\{/)
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

    const architectPanel = readText(join(OVERLAY_ROOT, "src/components/ArchitectPanel.tsx"))
    expect(architectPanel).toContain('import { Badge } from "./ui/Badge"')
    expect(architectPanel).toContain('data-ui="architect-category-badge"')
    expect(architectPanel).not.toContain("arch-cat-badge")
    expect(inspectorSurface).not.toMatch(/(^|\n)\.arch-cat-badge(?:\s|\.|:|\{|,|\[|-)/)
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
      "integrity__reviewer-list",
      "integrity__reviewer",
      "integrity__reviewer-head",
      "integrity__reviewer-title",
      "integrity__reviewer-name",
      "integrity__reviewer-summary",
      "integrity__reviewer-meta",
      "integrity__manifest-meta",
      "integrity__issue-body",
      "integrity__issue-desc",
      "integrity__issue-title",
      "integrity__correction-head",
      "integrity__correction-reason",
      "integrity__missing-title",
      "integrity__missing-reason",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const verdict of ["pass", "concerns", "needs_correction"]) {
      expect(inspectorSurface).toMatch(new RegExp(`\\.integrity__reviewer\\[data-verdict="${verdict}"\\]\\s*\\{`))
    }

    for (const className of [
      "integrity__dimension",
      "integrity__dimension-name",
      "integrity__dimension-counts",
      "integrity__goal-id",
      "integrity__diff",
      "integrity__missing-objective",
      "integrity__chips",
      "integrity__chip",
    ]) {
      expect(inspectorSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[|-)`))
    }

    const integrityCard = readText(join(OVERLAY_ROOT, "src/components/IntegrityCard.tsx"))
    expect(integrityCard).toContain('import { Badge } from "./ui/Badge"')
    expect(integrityCard).toContain('data-ui="integrity-reviewer-chip"')
    expect(integrityCard).toContain('data-ui="integrity-issue-tag"')
    expect(integrityCard).toContain('data-ui="integrity-repair-tag"')
    expect(integrityCard).not.toContain("integrity__reviewer-chip")
    expect(integrityCard).not.toContain("integrity__tag")
    expect(inspectorSurface).not.toMatch(/(^|\n)\.integrity__reviewer-chip(?:\s|\.|:|\{|,|\[|-)/)
    expect(inspectorSurface).not.toMatch(/(^|\n)\.integrity__tag(?:\s|\.|:|\{|,|\[|-)/)
    expect(inspectorSurface).not.toMatch(/\.integrity__tag\[data-action=/)
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
      expect(inspectorSurface).toMatch(new RegExp(`\\.req-status\\[data-req-status="${variant}"\\]\\s*\\{`))
    }
    expect(inspectorSurface).toMatch(/\.req-spec-detail \> summary\s*\{/)
  })

  test("gwg checks list is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of ["gwg-checks", "gwg-check", "gwg-check-icon", "gwg-check-name", "gwg-check-evidence"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const status of ["passed", "failed", "pending"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.gwg-check--${status}(?:\\s+\\.gwg-check-(?:icon|name))?\\s*\\{`))
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.gwg-check\\[data-check-status="${status}"\\](?:\\s+\\.gwg-check-(?:icon|name))?\\s*\\{`),
      )
    }

    expect(inspectorSurface).toMatch(/\.gwg-check \+ \.gwg-check\s*\{/)
    expect(inspectorSurface).not.toMatch(/clamp\([^,]*,\s*calc\(10px/)
  })

  test("gwg payload plan nodes, checks, and verdict are owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-plan-nodes",
      "gwg-plan-node",
      "gwg-plan-node-title",
      "gwg-plan-node-brief",
      "gwg-verdict",
      "gwg-eval-summary",
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

  test("retired gwg step row family stays removed from surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const className of [
      "gwg-step-body",
      "gwg-changed-files",
      "gwg-diff-stats",
      "gwg-diff-additions",
      "gwg-diff-deletions",
      "gwg-changed-file",
      "gwg-open-session",
      "gwg-open-session-btn",
      "gwg-step-messages",
      "gwg-step",
      "gwg-step-icon",
      "gwg-step-label",
      "gwg-step-summary",
      "gwg-step-status",
      "gwg-step-detail",
      "gwg-step-count",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[)`))
    }

    for (const status of ["pending", "running", "done", "failed", "skipped"]) {
      expect(styles).not.toMatch(
        new RegExp(`(^|\\n)\\.gwg-step--${status}(?:\\s+\\.gwg-step-(?:icon|label|status))?\\s*\\{`),
      )
      expect(inspectorSurface).not.toMatch(
        new RegExp(`\\.gwg-step--${status}(?:\\s+\\.gwg-step-(?:icon|label|status))?\\s*\\{`),
      )
    }

    expect(inspectorSurface).not.toMatch(/\.gwg-step-detail \> \.gwg-step:hover\s*\{/)
    expect(inspectorSurface).not.toMatch(/\.gwg-step-detail \> \.gwg-step::-webkit-details-marker,/)
    expect(inspectorSurface).not.toMatch(/clamp\(10px,/)
    expect(inspectorSurface).not.toMatch(/rgba\(84,\s*138,\s*247,\s*0\.4\)/)
    expect(inspectorSurface).not.toMatch(/rgba\(247,\s*84,\s*100,\s*0\.35\)/)
  })

  test("gwg header + status icon are owned by Button primitive plus surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const goalWorkflowGroup = readText(join(OVERLAY_ROOT, "src/components/GoalWorkflowGroup.tsx"))

    for (const className of ["gwg-title-row", "gwg-status-icon", "gwg-title", "gwg-revision"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(goalWorkflowGroup).toContain("<Button")
    expect(goalWorkflowGroup).toContain('type="button"')
    expect(goalWorkflowGroup).toContain('data-ui="gwg-header"')
    expect(goalWorkflowGroup).toContain('variant="ghost"')
    expect(goalWorkflowGroup).toContain('size="mini"')
    expect(goalWorkflowGroup).toContain('tone="neutral"')
    expect(goalWorkflowGroup).not.toContain('class="gwg-header"')
    expect(goalWorkflowGroup).toContain("aria-expanded={expanded()}")
    expect(goalWorkflowGroup).not.toContain('role="button"')
    expect(goalWorkflowGroup).not.toContain('tabindex="0"')
    expect(goalWorkflowGroup).not.toContain("onKeyDown={(e) =>")
    expect(inspectorSurface).not.toMatch(/(^|\n)\.gwg-header(?:\s|:|\{|,)/)
    expect(inspectorSurface).toMatch(/\.gwg > \.oc-button\[data-ui="gwg-header"\]\s*\{/)
    expect(inspectorSurface).toMatch(
      /\.gwg > \.oc-button\[data-ui="gwg-header"\]\s*\{[\s\S]*?--oc-button-height:\s*auto;/,
    )
    expect(inspectorSurface).toMatch(
      /\.gwg > \.oc-button\[data-ui="gwg-header"\]\s*\{[\s\S]*?--oc-button-bg:\s*var\(--oc-header-bg\);/,
    )
    expect(inspectorSurface).toMatch(
      /\.gwg > \.oc-button\[data-ui="gwg-header"\]:focus-visible\s*\{[\s\S]*?outline-offset:\s*calc\(-2px \* var\(--ui-scale\)\);/,
    )
    for (const variant of ["passed", "failed", "running"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.gwg--${variant} \\.gwg-status-icon\\s*\\{`))
      expect(inspectorSurface).toMatch(
        new RegExp(`\\.gwg\\[data-goal-status="${variant}"\\] \\.gwg-status-icon\\s*\\{`),
      )
    }
    expect(inspectorSurface).not.toMatch(/clamp\(10px,/)
    expect(inspectorSurface).toMatch(/\.gwg-revision[\s\S]*?border-radius:\s*var\(--oc-radius-pill\)/)
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
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.gwg\\[data-goal-status="${status}"\\](?:::before)?\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`\\.gwg\\[data-goal-status="${status}"\\] \\.gwg-status-icon\\s*\\{`))
    }

    expect(inspectorSurface).not.toMatch(/#c3d2ee/)
    expect(inspectorSurface).not.toMatch(/\.gwg\[data-goal-status="passed"\]::before/)
    expect(inspectorSurface).toContain("var(--ui-shadow-tone)")
  })

  test("retired criteria DOM and CSS selectors stay removed", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const domSource = readText(join(OVERLAY_ROOT, "src/dom.ts"))
    const sectionSource = readText(join(OVERLAY_ROOT, "src/utils/section.ts"))
    const boardSource = readText(join(OVERLAY_ROOT, "src/components/Board.tsx"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const messagesSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/messages.css"))
    const fieldSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/field.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))

    for (const className of [
      "criteria-group",
      "criteria-group-head",
      "criteria-group-icon",
      "criteria-group-title",
      "criteria-group-count",
      "criteria-group-list",
      "criteria-list",
      "criteria-grid",
      "criteria-check",
      "criteria-result",
      "goal-criteria",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(messagesSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}[,\\s]`))
    }

    expect(inspectorSurface).not.toMatch(/\.criteria-group-icon svg\s*\{/)
    expect(domSource).not.toContain("criteriaSection")
    expect(domSource).not.toContain("criteriaBadge")
    expect(domSource).not.toContain("criteriaList")
    expect(domSource).not.toContain("#criteriaSection")
    expect(domSource).not.toContain("#criteriaBadge")
    expect(domSource).not.toContain("#criteriaList")
    expect(sectionSource).not.toContain("evaluation: dom.criteriaSection")
    expect(fieldSurface).not.toContain(".criteria-list")
    expect(conversationSurface).not.toContain(".criteria-list")
    expect(boardSource).not.toContain("EvaluationCriteriaPanel")
    expect(boardSource).not.toContain("criteriaResults")
    expect(boardSource).not.toContain("evaluationCriteriaSection")
    expect(existsSync(join(OVERLAY_ROOT, "src/components/EvaluationCriteriaPanel.tsx"))).toBe(false)
    expect(existsSync(join(OVERLAY_ROOT, "src/utils/criteria.ts"))).toBe(false)
  })

  test("acceptance panel chrome is owned by surfaces/inspector.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))
    const messagesSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/messages.css"))
    const boardSource = readText(join(OVERLAY_ROOT, "src/components/Board.tsx"))

    expect(styles).not.toMatch(/(^|\n)\.acceptance-panel\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.acceptance-panel::before\s*\{/)
    expect(inspectorSurface).toMatch(/\.acceptance-panel\s*\{/)
    expect(inspectorSurface).toMatch(/\.acceptance-panel::before\s*\{/)
    expect(inspectorSurface).toContain('.acceptance-panel .oc-button[data-ui="acceptance-summary-toggle"]')
    expect(inspectorSurface).toContain('.acceptance-panel .oc-button[data-ui="acceptance-files-link"]')
    expect(inspectorSurface).toContain('.acceptance-panel .oc-button[data-ui="acceptance-evidence-goal-pill"]')
    expect(boardSource).toContain('data-ui="acceptance-summary-toggle"')
    expect(boardSource).toContain('data-ui="acceptance-files-link"')
    expect(boardSource).toContain('data-ui="acceptance-evidence-goal-pill"')
    expect(boardSource).toContain('attr:data-has-pill={row.goalRunID ? "true" : undefined}')

    for (const verdict of ["accepted", "rejected", "inflight", "empty"]) {
      expect(inspectorSurface).toMatch(new RegExp(`\\.acceptance-panel\\[data-verdict="${verdict}"\\]`))
    }

    expect(inspectorSurface).toMatch(/--acceptance-panel-accent: var\(--good\)/)
    expect(inspectorSurface).toMatch(/--acceptance-panel-accent: var\(--bad\)/)
    for (const retiredOwnerSelector of [
      "acceptance-panel-meta",
      "acceptance-summary",
      "acceptance-summary-toggle",
      "acceptance-files-link",
    ]) {
      expect(settingsSurface).not.toContain(retiredOwnerSelector)
    }
    for (const retiredOverflowSelector of ["acceptance-panel", "acceptance-summary", "acceptance-files-link"]) {
      expect(messagesSurface).not.toContain(retiredOverflowSelector)
    }
    expect(inspectorSurface).not.toMatch(/#63a2ff/)
  })

  test("retired eval shell DOM and CSS selectors stay removed", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const domSource = readText(join(OVERLAY_ROOT, "src/dom.ts"))
    const sectionSource = readText(join(OVERLAY_ROOT, "src/utils/section.ts"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const messagesSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/messages.css"))
    const fieldSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/field.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))

    for (const className of ["eval-error", "eval-error-name", "eval-error-meta", "eval-error-detail", "eval-summary"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(inspectorSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,)`))
      expect(messagesSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,)`))
    }

    expect(domSource).not.toContain("evalBody")
    expect(domSource).not.toContain("#evalBody")
    expect(fieldSurface).not.toContain("#evalBody")
    expect(conversationSurface).not.toContain("#evalBody")
    expect(sectionSource).not.toContain('kind === "evaluation"')
    expect(sectionSource).not.toContain('active.push("evaluation")')
    expect(sectionSource).not.toContain('related.push("evaluation")')
    expect(inspectorSurface).toMatch(/\.gwg-eval-summary\s*\{/)
    expect(inspectorSurface).toMatch(/\.gwg-eval-summary \.msg-text/)
  })

  test("section phase-state variants are owned by surfaces/inspector.css", () => {
    // After Step 9.E migration, .section[data-phase-state] → .oc-section[data-phase-state].
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))
    const messagesSource = readText(join(OVERLAY_ROOT, "src/store/messages.ts"))

    for (const variant of ["related", "active"]) {
      expect(styles).not.toMatch(new RegExp(`\\.oc-section\\[data-phase-state="${variant}"\\]\\s*\\{`))
      expect(inspectorSurface).toMatch(new RegExp(`\\.oc-section\\[data-phase-state="${variant}"\\]\\s*\\{`))
    }

    expect(inspectorSurface).toMatch(
      /\.oc-section\[data-phase-state="active"\] \.oc-section__badge:not\(:empty\)::before\s*\{/,
    )
    // Active phase-state uses only a background wash; the old vertical
    // `::after` rail made narrow panes look broken.
    expect(inspectorSurface).not.toMatch(/\.oc-section\[data-phase-state="active"\]::after\s*\{/)
    expect(inspectorSurface).not.toMatch(/rgba\(91,\s*141,\s*239/)
    expect(inspectorSurface).not.toMatch(/rgba\(10,\s*16,\s*24/)
    expect(messagesSource).not.toContain("syncSectionPhases")
    expect(messagesSource).not.toContain("../utils/section")
  })

  test("retired conversation goal strip selectors stay absent from production source", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))
    const cardSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css"))
    const conversationSource = readText(join(OVERLAY_ROOT, "src/components/Conversation.tsx"))
    const sourceText = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:css|ts|tsx|html)$/.test(path))
      .map((path) => readText(path))
      .join("\n")

    for (const token of ["chatGoalsStrip", "chat-goals-strip", "goal-chip"]) {
      expect(sourceText).not.toMatch(new RegExp(`\\b${token}\\b`))
    }

    expect(styles).not.toMatch(/(^|\n)\.(?:chat-goals-strip|goal-chip)(?:\s|\.|:|\{|,|\[)/)
    expect(conversationSurface).not.toMatch(/(^|\n)\.(?:chat-goals-strip|goal-chip)(?:\s|\.|:|\{|,|\[)/)
    expect(conversationSource).toContain("<TaskProgressBar />")
    expect(cardSurface).toMatch(/(^|\n)\.task-progress \.oc-button\[data-ui="task-progress-pill"\]\s*\{/)
  })

  test("retired goal item list selectors stay absent while GWG remains canonical", () => {
    const productionSource = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:css|ts|tsx|html)$/.test(path))
      .map((path) => withoutComments(readText(path)))
      .join("\n")
    const goalWorkflowGroup = readText(join(OVERLAY_ROOT, "src/components/GoalWorkflowGroup.tsx"))
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const token of [
      "goals-list",
      "goal-item",
      "goal-item-head",
      "goal-item-chevron",
      "goal-desc-inline",
      "goal-title-brief",
      "goal-item-id",
      "goal-item-body",
      "goal-status-icon",
      "goal-priority",
      "goal-actions",
    ]) {
      expect(productionSource).not.toContain(token)
    }

    expect(goalWorkflowGroup).toContain('class="gwg-list"')
    expect(goalWorkflowGroup).toContain('class="gwg-status-icon"')
    expect(inspectorSurface).toMatch(/(^|\n)\.gwg-list\s*\{/)
    expect(inspectorSurface).toMatch(/(^|\n)\.gwg-status-icon\s*\{/)
  })

  test("conversation header + task-switch progress are owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))

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

    expect(conversationSurface).not.toMatch(/@keyframes task-switch-progress-slide/)
    expect(soloRuleBody(conversationSurface, ".task-switch-progress")).toContain("transition: opacity")
    expect(conversationSurface).toMatch(/\.task-switch-progress::before/)
    expect(conversationSurface).toMatch(/\.chat-header-meta\s*\{/)
    expect(conversationSurface).toMatch(/\.chat-usage\s*\{/)
  })

  test("conversation chat-scroll is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))

    expect(styles).not.toMatch(/(^|\n)\.chat-scroll\s*\{/)
    expect(conversationSurface).toMatch(/(^|\n)\.chat-scroll\s*\{/)
    expect(conversationSurface).toMatch(
      /\.conversation-virtual-item > \.card,\n\.conversation-virtual-item > \.interaction-card/,
    )
    expect(conversationSurface).toMatch(/@container chat-workbench \(width < 900px\)/)
    expect(conversationSurface).not.toContain("@media (max-width: 900px)")
  })

  test("conversation chat-empty task-children are owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))

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
    expect(conversationSurface).toMatch(/\.chat-empty--task \.chat-empty-marker \.chat-empty-icon\s*\{/)
  })

  test("conversation chat-empty placeholder is owned by surfaces/conversation.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))

    for (const className of ["chat-empty", "chat-empty-icon", "chat-empty-text"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(conversationSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
    expect(conversationSurface).not.toMatch(/(^|\n)\.chat-follow-label(?:\s|\.|:|\{|,|\[)/)

    expect(html).toContain('href="styles/surfaces/conversation.css"')
    const conversationAt = html.indexOf('href="styles/surfaces/conversation.css"')
    expect(conversationAt).toBeGreaterThan(-1)
  })

  test("composer version footer and reflow are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))

    for (const className of ["chat-version", "chat-version-copy"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    for (const className of ["chat-build", "chat-version-link", "chat-version-sep", "chat-version-name"]) {
      expect(composerSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[)`))
    }

    expect(composerSurface).toMatch(/@container \(max-width: 520px\)/)
    expect(composerSurface).toMatch(/@container \(max-width: 760px\)\s*\{\s*\/\* breakpoint: --ui-breakpoint-md \*\//)
    expect(composerSurface).not.toContain("@media (max-width: 760px)")
    expect(composerSurface).toMatch(/\.chat-send-icon svg\s*\{/)
    expect(styles).not.toMatch(/(^|\n)\.chat-send-icon svg\s*\{/)
  })

  test("composer attachments and compose row/meta are owned by surfaces/composer.css", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))
    const composerSource = readText(join(OVERLAY_ROOT, "src/components/ChatComposer.tsx"))

    for (const className of [
      "chat-attachments",
      "chat-attachment-item",
      "chat-attachment-thumb",
      "chat-attachment-icon",
      "chat-attachment-name",
      "chat-compose-row",
      "chat-compose-meta",
      "chat-compose-meta-left",
      "chat-resize-handle",
    ]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(composerSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }

    expect(composerSurface).not.toMatch(/(^|\n)\.chat-compose-meta-right(?:\s|\.|:|\{|,|\[)/)
    expect(composerSurface).not.toMatch(/(^|\n)\.chat-compose-meta-left\s+a(?:\s|\.|:|\{|,|\[)/)

    expect(composerSource).toContain('data-ui="chat-attachment-remove"')
    expect(composerSource).not.toContain('class="chat-attachment-remove"')
    expect(composerSurface).toMatch(/\.chat-attachment-item\s+\.oc-button\[data-ui="chat-attachment-remove"\]\s*\{/)
    expect(composerSurface).not.toMatch(/(^|\n)\.chat-attachment-remove(?:\s|:|\{|,|\[)/)
    expect(composerSurface).toMatch(/\.chat-input\[data-dragover\]\s+\.chat-compose-row\s*\{/)
  })

  test("composer send and stop controls route through the Button primitive", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const composerSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css"))
    const composerSource = readText(join(OVERLAY_ROOT, "src/components/ChatComposer.tsx"))

    expect(composerSource).toContain('import { Button } from "./ui/Button"')
    expect(composerSource).toContain("<Button")
    expect(composerSource).not.toMatch(/<button\b/)
    expect(composerSource).not.toContain('class="chat-send"')

    for (const className of ["chat-send-icon", "chat-send-label"]) {
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
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector || !/\.chat-send\b/.test(selector)) continue

      expect(selector).not.toMatch(/\.chat-send\b/)
    }
    expect(composerSurface).not.toMatch(/(^|\n)\.chat-send(?:\s|:|\{|,|\[)/)
    expect(composerSurface).toMatch(/\.chat-compose-row\s+\.oc-button\[data-mode\]\s*\{/)
    expect(composerSurface).toMatch(/\.chat-compose-row\s+\.oc-button\[data-mode="send"\]:disabled\s*\{/)
    expect(composerSurface).not.toMatch(/\.chat-send\[data-busy="true"\]:hover\s*\{/)
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
    const composerSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css")))
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
      expect(titlebarSurface).toMatch(new RegExp(`\\.titlebar-theme-option-swatch\\[data-theme="${swatch}"\\]`))
      expect(tokenText).toMatch(new RegExp(`--oc-theme-swatch-${swatch}\\s*:`))
    }
  })

  test("brand-guide family is owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))
    const html = readText(join(OVERLAY_ROOT, "src/index.html"))
    const component = readText(join(OVERLAY_ROOT, "src/components/titlebar/TitlebarBrandGuide.tsx"))

    for (const className of [
      "brand-guide-anchor",
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
    expect(titlebarSurface).not.toMatch(/\.brand-guide:hover\s+\.brand-guide-card/)
    expect(titlebarSurface).not.toMatch(/\.brand-guide:focus-within\s+\.brand-guide-card/)
    expect(titlebarSurface).toMatch(/var\(--oc-radius-pill\)/)
    expect(html).toContain('id="solidTitlebarBrandGuide"')
    expect(html).not.toMatch(/\bclass=["'][^"']*\bbrand-guide\b/)
    expect(component).toContain('import * as Popover from "@kobalte/core/popover"')
    expect(component).toContain("<Popover.Root")
    expect(component).toContain("<Popover.Trigger")
    expect(component).toContain("<Popover.Content")
  })

  test("titlebar layout containers and connection badge are owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of ["titlebar-nav", "titlebar-nav-group"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[)`))
      expect(titlebarSurface).not.toMatch(new RegExp(`(^|\\n)\\.${className}(?:\\s|\\.|:|\\{|,|\\[)`))
    }

    for (const className of ["titlebar-utility", "titlebar-actions", "titlebar-window-controls"]) {
      expect(styles).not.toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
      expect(titlebarSurface).toMatch(new RegExp(`(^|\\n)\\.${className}\\s*\\{`))
    }
    expect(styles).not.toMatch(/(^|\n)\.conn-badge(?:\s|\{|:)/)
    expect(titlebarSurface).toContain('.oc-button[data-ui="connection-badge"].conn-badge')
  })

  test("dead static titlebar window button classes stay retired", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const titlebarSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")))
    const combined = `${styles}\n${titlebarSurface}`

    expect(combined).not.toMatch(/(^|\n)\.titlebar-btn\b/)
    expect(combined).not.toMatch(/(^|\n)\.titlebar-close\b/)
  })

  test("titlebar shell and brand layout are owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of ["titlebar", "titlebar-left", "titlebar-brand", "titlebar-spacer", "brand-logo"]) {
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
      "brand-guide",
    ]

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      for (const className of migratedTitlebarClasses) {
        expect(selector).not.toMatch(new RegExp(`\\.${className}(?=$|[\\s:{.#\\[,>+~])`))
      }
    }
  })

  test("titlebar menubar family is owned by surfaces/titlebar.css", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const titlebarSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css"))

    for (const className of [
      "titlebar-menubar",
      "titlebar-menubar-slot",
      "titlebar-menubar-panel",
      "titlebar-menubar-group",
      "titlebar-menubar-group-title",
      "titlebar-menubar-item",
      "titlebar-menubar-checkbox",
      "titlebar-menubar-checkbox-copy",
      "titlebar-menubar-checkbox-indicator",
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
    expect(titlebarSurface).not.toMatch(/\.titlebar-menubar-trigger(?:\s|[,>{:+~.#\[]|$)/)
    expect(titlebarSurface).toContain('.titlebar-menubar .oc-button[data-ui="titlebar-menubar-trigger"]')
  })

  test("bold font-weight declarations cannot increase across overlay stylesheets", () => {
    const sources = [
      readLegacyStylesCss("src/styles.css"),
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/primitives"), (path) => path.endsWith(".css")).map(readText),
      ...walkFiles(join(OVERLAY_ROOT, "src/styles/surfaces"), (path) => path.endsWith(".css")).map(readText),
    ]
    const text = sources.join("\n")
    const boldDecls = count(/font-weight\s*:\s*(?:700|720|750|760|780|800|900|bold)\b/g, text)
    expect(boldDecls).toBeLessThanOrEqual(37)
  })

  test("right-panel inner headers do not rely on theme reset chrome", () => {
    const styles = readLegacyStylesCss("src/styles.css")

    expect(styles).not.toMatch(/body[^{]*(?:acceptance-panel-header|criteria-group-head)[^{]*\{/)
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

  test("retired criteria groups do not rely on theme layout or chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/criteria-group(?:-list)?/)
    }
  })

  test("acceptance panel keeps verdict accent outside theme chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/acceptance-panel/)
    }

    expect(inspectorSurface).toMatch(
      /\.acceptance-panel::before\s*\{[^}]*background:\s*var\(--acceptance-panel-accent\)/,
    )
    expect(inspectorSurface).not.toMatch(/\.acceptance-panel\s*\{[^}]*border-left\s*:/)
  })

  test("retired evaluation error chrome stays removed from theme resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const inspectorSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue

      expect(selector).not.toMatch(/eval-error/)
    }

    expect(inspectorSurface).not.toMatch(/\.eval-error(?:\s|\.|:|\{|,)/)
    expect(inspectorSurface).toMatch(/\.gwg-eval-summary\s*\{/)
  })

  test("settings channel docs card does not rely on theme chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const settingsSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css")))
    const messagesSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/messages.css")))

    for (const source of [styles, settingsSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
        if (!isThemeSelector) continue

        expect(selector).not.toMatch(/channel-doc-card/)
      }
    }

    const channelDocBody = settingsSurface.match(/\.channel-doc-card\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(channelDocBody).toContain("background: transparent")
    expect(channelDocBody).toContain("border: 0")

    for (const className of ["detail-stack", "detail-card", "detail-pre", "detail-pre-json", "detail-grid-row"]) {
      const selector = new RegExp(`(^|[\\n,{])\\s*\\.${className}(?:\\s|[,{:.#\\[]|$)`)
      expect(settingsSurface).not.toMatch(selector)
      expect(messagesSurface).not.toMatch(selector)
    }
  })

  test("settings extension rows do not rely on theme or local important chrome resets", () => {
    const styles = readLegacyStylesCss("src/styles.css")
    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))

    for (const source of [styles, settingsSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const hasSettingsRow = /(?:^|\s|:is\([^)]*)\.s-row(?:\b|[:.[#])/.test(selector)
        if (!hasSettingsRow) continue

        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
        const usesChromeImportant = /(background|border|border-color|border-radius|box-shadow):\s*[^;]*!important/.test(
          body,
        )

        expect(isThemeSelector).toBe(false)
        expect(usesChromeImportant).toBe(false)
      }
    }

    const body = settingsSurface.match(/\.s-row\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(body).toContain("background: transparent")
    expect(body).toContain("border: 0")
  })

  test("retired settings config containers do not rely on theme or local important chrome resets", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const settingsSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css")))

    for (const source of [styles, settingsSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const hasRetiredConfigContainer =
          /(?:^|\s|:is\([^)]*)\.config-section(?!-body)(?:\b|[:.[#])/.test(selector) ||
          /(?:^|\s|:is\([^)]*)\.config-section-head(?:\b|[:.[#])/.test(selector) ||
          /(?:^|\s|:is\([^)]*)\.config-subsection(?:\b|[:.[#])/.test(selector)

        expect(hasRetiredConfigContainer).toBe(false)
      }
    }

    const body = soloRuleBody(settingsSurface, ".config-section-body")
    expect(body).toContain("border: 0 solid transparent")
  })

  test("retired settings continuation selector families stay removed while channel list has an owner", () => {
    const settingsSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css")))
    const fieldSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/field.css")))
    const channelsPanel = withoutComments(readText(join(OVERLAY_ROOT, "src/components/settings/ChannelsPanel.tsx")))
    const configDialog = withoutComments(readText(join(OVERLAY_ROOT, "src/components/ConfigDialogHost.tsx")))
    const retiredContinuationSelectors = [
      ".playwright-options",
      ".channel-public-url-head",
      ".config-field-row",
      ".config-inline-popup",
      ".config-row",
      ".config-label",
      ".config-value",
      ".opacity-field",
    ]

    for (const selector of retiredContinuationSelectors) {
      expect(settingsSurface).not.toContain(selector)
      expect(fieldSurface).not.toContain(selector)
    }

    expect(settingsSurface).toContain("#channelConfigBody")
    expect(settingsSurface).toContain("#channelList")
    expect(settingsSurface).toContain(".config-inline-form")
    expect(settingsSurface).toContain(".extension-head .field-label")
    expect(settingsSurface).toContain(".general-panel")
    expect(settingsSurface).toContain(".loading-hint")
    expect(configDialog).toContain('return "channelConfigBody"')
    expect(channelsPanel).toContain('id="channelList"')
  })

  test("retired field input action/icon/row selectors stay removed while live field primitives remain", () => {
    const fieldSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/field.css")))
    const conversationSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")))
    const taskDirBarSource = withoutComments(readText(join(OVERLAY_ROOT, "src/components/TaskDirBar.tsx")))
    const productionSource = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:ts|tsx|html|json)$/.test(path))
      .map((path) => withoutComments(readText(path)))
      .join("\n")
    const cssClassSelector = (className: string) => new RegExp(`(^|[^A-Za-z0-9_-])\\.${className}(?![A-Za-z0-9_-])`)
    const sourceClassToken = (className: string) => new RegExp(`(^|[^A-Za-z0-9_-])${className}(?![A-Za-z0-9_-])`)

    for (const className of ["field-input-actions", "field-input-icon", "field-row", "engine-model-panel"]) {
      expect(fieldSurface).not.toMatch(cssClassSelector(className))
      expect(productionSource).not.toMatch(sourceClassToken(className))
    }

    expect(fieldSurface).toMatch(cssClassSelector("field-input"))
    expect(fieldSurface).toMatch(cssClassSelector("field-input-group"))
    expect(fieldSurface).toMatch(cssClassSelector("search-field"))
    expect(fieldSurface).toMatch(cssClassSelector("search-field-icon"))
    expect(fieldSurface).toMatch(cssClassSelector("search-field-input"))
    expect(productionSource).toContain("field-input-group")
    expect(productionSource).toContain("search-field-icon")
    expect(productionSource).toContain("search-field-input")
    expect(taskDirBarSource).toMatch(/<input[\s\S]*class="field-input"[\s\S]*data-ui="cwd-path-input"/)
    expect(conversationSurface).toMatch(/\.recent-dir-edit-label\s+\.field-input\s*\{/)
    expect(conversationSurface).not.toMatch(/\.recent-dir-edit-label\s+input\b/)
    expect(conversationSurface).not.toMatch(/\.recent-dir-edit-label\s+input:focus\b/)
  })

  test("composer shell does not rely on theme chrome resets", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const hasChatInput = /(?:^|\s|:is\([^)]*)\.chat-input(?:\b|[:.[#])/.test(selector)
      if (!hasChatInput) continue

      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      const usesChromeImportant =
        /(margin|padding|gap|background|border|border-color|border-radius|box-shadow):\s*[^;]*!important/.test(body)

      expect(isThemeSelector).toBe(false)
      expect(usesChromeImportant).toBe(false)
    }

    const composerSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css")))
    const body = soloRuleBody(composerSurface, ".chat-input")
    expect(body).toContain("margin: 0")
    expect(body).toContain("padding: calc(6px * var(--ui-scale))")
    expect(body).toContain("gap: calc(4px * var(--ui-scale))")
    expect(body).toContain("border-radius: var(--oc-radius-none)")
  })

  test("panel shell padding is canonical, not theme scoped", () => {
    // Canonical extracted to surfaces/workspace.css 2026-05-04.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const workspace = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))

    for (const source of [styles, workspace]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
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
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
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
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
        const hasHeaderControl =
          /\.(?:task-dir-shell|task-cwd-dropdown)\b/.test(selector) ||
          /\.oc-button\[data-ui="cwd-recent-trigger"\]/.test(selector) ||
          /\[data-ui="sidebar-new-task-button"\]/.test(selector)
        if (!isThemeSelector || !hasHeaderControl) continue

        expect(selector).not.toMatch(
          /\.(?:task-dir-shell|task-cwd-dropdown)\b|\.oc-button\[data-ui="cwd-recent-trigger"\]|\[data-ui="sidebar-new-task-button"\]/,
        )
      }
    }

    const conversationSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css"))
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("gap: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("padding: calc(2px * var(--ui-scale))")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain(
      "border: var(--oc-border-width) solid var(--oc-control-border)",
    )
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("border-radius: var(--oc-radius-soft)")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell")).toContain("background: var(--oc-control-bg)")
    expect(soloRuleBody(conversationSurface, ".task-dir-shell.task-cwd-dropdown")).toContain(
      "padding-inline: calc(2px * var(--ui-scale))",
    )
    expect(soloRuleBody(conversationSurface, ".task-dir-shell.task-cwd-dropdown")).toContain(
      "padding-block: calc(2px * var(--ui-scale))",
    )
    expect(
      soloRuleBody(conversationSurface, '.task-dir-menu-actions .oc-button[data-ui="cwd-recent-trigger"]'),
    ).toContain(
      "width: calc(22px * var(--ui-scale))",
    )
    const sidebarSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css")))
    expect(sidebarSurface).not.toContain("sidebar-toolset")
    expect(sidebarSurface).not.toContain('data-ui="sidebar-refresh-button"')
    expect(sidebarSurface).not.toContain('data-ui="sidebar-toggle-button"')
    expect(sidebarSurface).toContain('.oc-button[data-ui="sidebar-new-task-button"]')
    const workspaceSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))
    expect(workspaceSurface).not.toContain(".workspace-toggle")
  })

  test("empty-state surface keeps live card selectors without retired right-panel ids", () => {
    // Canonical extracted to surfaces/empty-state.css 2026-05-04.
    const styles = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/empty-state.css")))
    const indexHtml = readText(join(OVERLAY_ROOT, "src/index.html"))

    expect(indexHtml).toContain("solidFileChangesMount")
    expect(indexHtml).not.toContain("solidChangesPanel")
    expect(styles).not.toContain("#solidChangesPanel")
    expect(styles).toContain(".sidebar-list-cluster > .empty-hint")
    expect(styles).toContain(".diff-preview-empty .empty-hint")
    expect(styles).toContain(".empty-hint--card")
    expect(styles).not.toMatch(new RegExp("(?:^|[\\s,])\\.section" + "-body\\s*>"))
    expect(styles).not.toMatch(/\.oc-section__body\s*>\s*\.empty-hint/)
  })

  test("conversation agent rail is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const surface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      const targetsRail = /\.conversation-agent-rail\b/.test(selector)
      if (!isThemeSelector || !targetsRail) continue

      expect(body).not.toMatch(
        /\b(?:display|position|gap|padding(?:-[a-z]+)?|border(?:-[a-z]+)?|border-radius|background|box-shadow|width|height|min-width|max-width|overflow)\s*:/,
      )
    }

    const railBody = soloRuleBody(surface, ".conversation-agent-rail")
    for (const declaration of [
      "width: 100%",
      "height: calc(42px * var(--ui-scale))",
      "min-height: calc(42px * var(--ui-scale))",
      "display: flex",
      "flex-direction: row",
      "padding: calc(4px * var(--ui-scale)) calc(10px * var(--ui-scale))",
      "overflow: hidden",
    ]) {
      expect(railBody).toContain(declaration)
    }
    expect(railBody).not.toContain("max-height:")

    const laneBody = soloRuleBody(surface, ".conversation-agent-rail__lanes")
    expect(laneBody).toContain("overflow-x: auto")
    expect(laneBody).toContain("overflow-y: hidden")
    expect(laneBody).toContain("display: flex")
    expect(laneBody).toContain("flex-wrap: nowrap")
    expect(laneBody).toContain("scrollbar-width: none")
    expect(surface).toContain(".conversation-agent-rail__lanes::-webkit-scrollbar")
    expect(surface).not.toContain("scrollbar-width: thin")

    const rowBody = soloRuleBody(surface, ".conversation-agent-rail__row")
    expect(rowBody).toContain("display: grid")
    expect(rowBody).toContain("grid-template-columns: calc(34px * var(--ui-scale))")
    expect(surface).not.toContain("conversation-agent-rail__run")
    expect(surface).not.toContain("conversation-agent-rail__report")
    expect(surface).not.toContain("conversation-agent-rail__resize")
    expect(surface).not.toContain("agent-report-dialog")
  })

  test("panel body shell chrome is canonical, not theme scoped", () => {
    // .panel-body canonical moved to surfaces/workspace.css 2026-05-04.
    const workspace = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))

    for (const match of workspace.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector || !/\.panel-body\b/.test(selector)) continue

      expect(body).not.toMatch(
        /\b(?:gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|border(?:-[a-z]+)?|border-radius|box-shadow)\s*:/,
      )
    }

    const bodies = Array.from(workspace.matchAll(/(^|\n)\.panel-body\s*\{([^{}]*)\}/g)).map((match) => match[2] ?? "")
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
    const conversationSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")))

    // No theme selector in styles.css may set layout/chrome on .task-bar
    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
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
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector) continue
      if (!new RegExp(`(?:^|[\\s>+~,])\\.${columnClass}(?:$|[\\s:{.#\\[,>+~])`).test(selector)) {
        continue
      }

      expect(body).not.toMatch(/\b(?:border(?:-[a-z]+)?|border-radius|box-shadow|backdrop-filter)\s*:/)
    }

    const sidebarSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/sidebar.css")))
    const inspectorSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css")))
    const conversationSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")))
    for (const [selector, source] of [
      [".sidebar", sidebarSurface],
      [".chat", conversationSurface],
      [".sections", inspectorSurface],
    ] as const) {
      const body = soloRuleBody(source, selector)
      for (const declaration of ["border: 0", "border-radius: 0", "box-shadow: none", "backdrop-filter: none"]) {
        expect(body).toContain(declaration)
      }
    }
  })

  test("workspace and inspector stack spacing are canonical, not theme scoped", () => {
    // .workspace-main canonical moved to surfaces/workspace.css 2026-05-04.
    const workspace = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))
    const inspectorSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css")))

    for (const source of [workspace, inspectorSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
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

    const sectionsBodies = Array.from(inspectorSurface.matchAll(/(^|\n)\.sections-stack\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const sectionsBody = sectionsBodies.at(-1) ?? ""
    expect(sectionsBody).toContain("gap: var(--ui-gap-sm)")
    expect(sectionsBody).toContain("padding: var(--ui-gap-sm)")
  })

  test("legal overlay shell has no unreachable narrow panel layout", () => {
    const base = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/cascade/base.css")))
    const workspace = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))
    expect(base).toContain("container: overlay-shell / inline-size")
    expect(workspace).not.toContain("@media (width < 1120px)")
    expect(workspace).not.toMatch(/@container\s+overlay-shell\s+\(width\s*</)
    expect(workspace).not.toContain("max(var(--ui-workbench-panel-min-width), calc(50cqw))")
  })

  test("right panel card radius and body padding are canonical, not theme scoped", () => {
    // After Step 9.E migration, the legacy section shell migrated to the
    // oc-section primitive family.
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const inspectorSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/inspector.css")))

    for (const source of [styles, inspectorSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
        if (
          !isThemeSelector ||
          !/(?:^|[\s>+~,])\.(?:oc-section|gwg|oc-section__body|gwg-body)(?:$|[\s:{.#\[,>+~])/.test(selector)
        ) {
          continue
        }

        expect(body).not.toMatch(/\b(?:border-radius|padding(?:-[a-z]+)?)\s*:/)
      }
    }

    expect(soloRuleBody(inspectorSurface, ".oc-section")).toContain("border-radius: var(--oc-radius-soft)")
    expect(soloRuleBody(inspectorSurface, ".gwg")).toContain("border-radius: var(--oc-radius-soft)")

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
    const styleFiles = walkFiles(join(OVERLAY_ROOT, "src/styles"), (path) => path.endsWith(".css"))
    const styleResidue = styleFiles.flatMap((file) => {
      const css = withoutComments(readText(file))
      return /\.board-intro(?:__|\b)/.test(css) ? [file.replace(OVERLAY_ROOT, "").replace(/\\/g, "/")] : []
    })
    expect(styleResidue).toEqual([])

    const runtimeFiles = walkFiles(join(OVERLAY_ROOT, "src"), (path) => /\.(?:ts|tsx|html)$/.test(path))
    const sourceResidue = runtimeFiles.flatMap((file) => {
      const source = withoutComments(readText(file))
      return /\bBoardIntro\b|board-intro(?:__|-|\b)/.test(source)
        ? [file.replace(OVERLAY_ROOT, "").replace(/\\/g, "/")]
        : []
    })
    expect(sourceResidue).toEqual([])
    // board.css must not exist (was deleted with BoardIntro.tsx)
    expect(existsSync(join(OVERLAY_ROOT, "src/styles/surfaces/board.css"))).toBe(false)
  })

  test("chat scroll layout is canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const conversationSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")))

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      if (!isThemeSelector || !/\.chat-scroll\b/.test(selector)) continue

      expect(body).not.toMatch(/\b(?:padding(?:-[a-z]+)?|background|border(?:-[a-z]+)?|box-shadow)\s*:/)
    }

    const bodies = Array.from(conversationSurface.matchAll(/(^|\n)\.chat-scroll\s*\{([^{}]*)\}/g)).map(
      (match) => match[2] ?? "",
    )
    const body = bodies.at(-1) ?? ""
    expect(body).toContain(
      "padding: calc(18px * var(--ui-scale)) calc(22px * var(--ui-scale)) calc(20px * var(--ui-scale))",
    )
  })

  test("conversation auxiliary surfaces keep chrome out of theme selectors", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const workspaceSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/workspace.css")))

    for (const source of [styles, workspaceSurface]) {
      for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? ""
        const body = match[2] ?? ""
        const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
        if (!isThemeSelector || !/\.conversation-agent-rail\b/.test(selector)) continue

        expect(body).not.toMatch(/\b(?:background|border(?:-[a-z]+)?|box-shadow)\s*:/)
      }
    }

    expect(workspaceSurface).not.toMatch(/(^|\n)\.workspace-mount(?:\s|[{\[:#.>+~,])/)
  })

  test("chat task-switch progress overlays the header instead of creating a hidden gap", () => {
    const conversationSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/conversation.css")))
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

  test("retired titlebar status icon padding selector stays absent", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const titlebarSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")))
    const composerSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/composer.css")))
    const combined = `${styles}\n${titlebarSurface}\n${composerSurface}`
    const iconButtonClasses: string[] = []

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      const targetsIconButton = iconButtonClasses.some((cls) => new RegExp(`\\${cls}\\b`).test(selector))
      if (!isThemeSelector || !targetsIconButton) continue

      expect(body).not.toMatch(/\bpadding(?:-[a-z]+)?\s*:/)
    }

    expect(combined).not.toMatch(/\.titlebar-status-icon(?:\s|[,{:#.>+~\[])/)
  })

  test("titlebar layout container gaps are canonical, not theme scoped", () => {
    const styles = withoutComments(readLegacyStylesCss("src/styles.css"))
    const titlebarSurface = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/titlebar.css")))
    const containerSelectors = [
      ".titlebar-left",
      ".titlebar-brand",
      ".titlebar-utility",
      ".titlebar-actions",
      ".titlebar-window-controls",
    ]
    const retiredContainerSelectors = [".titlebar-nav", ".titlebar-nav-group"]
    const combined = `${styles}\n${titlebarSurface}`

    for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ""
      const body = match[2] ?? ""
      const isThemeSelector = /body(?:\[[^\]]*data-theme[^\]]*\]|:is\([^)]*data-theme[^)]*\))/.test(selector)
      const targetsTitlebarLayout = containerSelectors.some((cls) => new RegExp(`\\${cls}\\b`).test(selector))
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

    for (const selector of retiredContainerSelectors) {
      const escaped = selector.replace(".", "\\.")
      expect(combined).not.toMatch(new RegExp(`${escaped}(?:\\s|\\.|:|\\{|,|\\[)`))
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
    const mediaBreakpoint =
      /\(\s*(?:(?:min|max)-(?:width|height)\s*:\s*-?\d+(?:\.\d+)?px|(?:width|height)\s*(?:<|<=|>|>=)\s*-?\d+(?:\.\d+)?px)\s*\)/g

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
        if (match[0] === "0px") continue
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
    expect(count(/<SettingsGroup/g, skillMarket)).toBe(3)
    expect(skillMarket).toContain('class="extension-settings-group"')
    expect(skillMarket).not.toContain("<SurfaceHeader")

    const generalPanel = readText(join(OVERLAY_ROOT, "src/components/settings/GeneralPanel.tsx"))
    expect(count(/<SettingsGroup/g, generalPanel)).toBe(3)
    for (const key of [
      "settings.section.connection",
      "settings.section.database",
      "settings.section.behaviour",
    ]) {
      expect(generalPanel).toContain(`title={t("${key}")}`)
    }
    expect(generalPanel).not.toContain("<SurfaceHeader")
    expect(generalPanel).not.toContain("config-panel-group-title")
    expect(generalPanel).not.toContain("config-panel-group-head")

    const agentModelsPanel = readText(join(OVERLAY_ROOT, "src/components/settings/AgentModelsPanel.tsx"))
    expect(count(/<SettingsGroup/g, agentModelsPanel)).toBe(1)
    expect(agentModelsPanel).toContain('title={t("cmdk.settings.agent_models")}')
    expect(agentModelsPanel).not.toContain('title="Agent Models"')
    for (const literal of [
      "Core — main coding agents",
      "Lightweight — spec/plan/explore/etc.",
      "Internal — background tasks",
      "— inherit project default —",
      "saving…",
    ]) {
      expect(agentModelsPanel).not.toContain(literal)
    }
    expect(agentModelsPanel).not.toContain("<SurfaceHeader")
    expect(agentModelsPanel).not.toContain("config-panel-group-head")
    expect(agentModelsPanel).not.toContain("config-panel-group-title")

    const providersPanel = readText(join(OVERLAY_ROOT, "src/components/settings/ProvidersPanel.tsx"))
    expect(count(/<SettingsGroup/g, providersPanel)).toBe(1)
    expect(count(/<SurfaceHeader/g, providersPanel)).toBe(1)
    expect(providersPanel).not.toContain("config-panel-group-title")

    const settingsSurface = readText(join(OVERLAY_ROOT, "src/styles/surfaces/settings.css"))
    expect(settingsSurface).not.toContain(".config-panel-group-title")
    expect(settingsSurface).not.toContain(".config-panel-group-head")

    const conversationAgentRail = readText(join(OVERLAY_ROOT, "src/components/ConversationAgentRail.tsx"))
    expect(conversationAgentRail).not.toContain("<SurfaceHeader")
    expect(conversationAgentRail).not.toContain("agent-workflow-toolbar")
    expect(conversationAgentRail).not.toContain("agent-workflow-heading")
    expect(conversationAgentRail).not.toContain("agent-workflow-title")
  })

  test("config writers do not re-fetch config after updateConfig writes through the store", () => {
    const providersPanel = withoutComments(readText(join(OVERLAY_ROOT, "src/components/settings/ProvidersPanel.tsx")))
    const channelsPanel = withoutComments(readText(join(OVERLAY_ROOT, "src/components/settings/ChannelsPanel.tsx")))
    expect(providersPanel).not.toContain('apiJson("config")')
    expect(providersPanel).not.toContain('setAppStore("config"')
    expect(channelsPanel).not.toContain('apiJson("config")')
    expect(channelsPanel).not.toContain("loadConfigInfo")
  })

  test("agent model refresh key does not serialize the full provider catalog", () => {
    const agentModelsPanel = withoutComments(
      readText(join(OVERLAY_ROOT, "src/components/settings/AgentModelsPanel.tsx")),
    )
    expect(agentModelsPanel).toContain("appStore.providerCatalog?.connected")
    expect(agentModelsPanel).not.toContain("appStore.providerCatalog?.all")
    expect(agentModelsPanel).not.toContain("Object.keys(provider?.models")
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

  test("chat-bubble.css stays token-driven and contains no hex literals", () => {
    const css = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/chat-bubble.css")))
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  test("agent chat bubbles use the execution rail while message roles stay rail-free", () => {
    const css = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/chat-bubble.css")))
    expect(css).toContain('.chat-bubble-row[data-kind="agent"] .chat-bubble')
    expect(css).toContain("border-left: calc(3px * var(--ui-scale)) solid var(--card-stage);")
    expect(soloRuleBody(css, '.chat-bubble-row[data-kind="agent"] .chat-bubble')).toContain(
      "background: var(--card-bg-0)",
    )
    expect(soloRuleBody(css, '.chat-bubble-row[data-kind="agent"] .chat-bubble:hover')).toContain(
      "background: var(--card-bg-0)",
    )
    expect(css).not.toMatch(/border-inline-(?:start|end)\s*:/)
    expect(css).not.toContain("--card-system-rail")
    expect(css).not.toContain("--card-stage-user) 84%")
    expect(css).not.toMatch(/\[data-role="user"\][^{]*\{[^}]*border-left:/)
    expect(css).not.toMatch(/\[data-role="system"\][^{]*\{[^}]*border-left:/)
  })

  test("tool cards do not add theme-colored side rails", () => {
    const css = withoutComments(readText(join(OVERLAY_ROOT, "src/styles/surfaces/card.css")))
    expect(css).not.toMatch(/\[data-kind="tool"\][^{]*\{[^}]*border-left:\s*calc\(/)
    expect(css).not.toMatch(/\[data-kind="tool"\][^{]*\{[^}]*border-left-color:\s*var\(--card-stage-info\)/)
    expect(css).toMatch(
      /\.card:not\(\[data-depth="0"\]\)\[data-kind="tool"\]\s*\{[^}]*border-left:\s*0 solid transparent/,
    )
  })

  test("ChatBubble.tsx does not introduce inline SVG", () => {
    const tsx = readText(join(OVERLAY_ROOT, "src/components/ChatBubble.tsx"))
    expect(tsx).not.toMatch(/<svg\b/i)
  })

  test("Conversation.tsx is the only component that dispatches between Card and ChatBubble", () => {
    const componentsRoot = join(OVERLAY_ROOT, "src/components")
    const tsxFiles = walkFiles(componentsRoot, (path) => path.endsWith(".tsx"))
    const renderAsBubbleCallers = tsxFiles.filter((file) => readText(file).includes("renderAsBubble("))
    expect(renderAsBubbleCallers).toEqual([join(componentsRoot, "Conversation.tsx")])

    const chatBubbleDispatchers = tsxFiles.filter((file) => {
      if (file.endsWith("ChatBubble.tsx")) return false
      const text = withoutComments(readText(file))
      return text.includes("<ChatBubble") || text.includes('from "./ChatBubble"')
    })
    expect(chatBubbleDispatchers).toEqual([join(componentsRoot, "Conversation.tsx")])
  })
})
