/**
 * Coverage guard for flat-redesign Step 3 (specs/overlay-flat-redesign/plan.md §2.3).
 *
 * Two assertions:
 *
 *   1. The Icon primitive is the single source of icon rendering.
 *      Commodity icons are backed by lucide-solid, while product-specific
 *      glyphs remain in the custom SVG registry.
 *
 *   2. No regression to character-icon callsites under
 *      `packages/overlay/src/components/**\/*.tsx`. The 4 close-X
 *      JSX literals (`>×</button>`), the 2 emoji icons (📁), and the
 *      caret literal (▾) that were migrated 2026-05-04 must not
 *      crawl back. The static `index.html` and the `main.tsx`
 *      innerHTML template are excluded from this guard — they are
 *      tracked separately in plan.md §3 Step 6 (dead-code cleanup)
 *      because rewriting innerHTML templates is out of scope here.
 */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// Importing Icon.tsx directly pulls in SolidJS JSX runtime; bun test
// doesn't compile JSX with the project's `jsxImportSource: "solid-js"`
// config. Read the registry as text and parse the IconName union
// instead — same single-source guarantee, no JSX runtime needed.
const COMPONENTS_ROOT = join(import.meta.dir, "..", "src", "components")
const ICON_TSX = readFileSync(join(COMPONENTS_ROOT, "Icon.tsx"), "utf8")
const ICON_HTML_TSX = readFileSync(join(import.meta.dir, "..", "src", "utils", "icon-html.tsx"), "utf8")
const MAIN_TSX = readFileSync(join(import.meta.dir, "..", "src", "main.tsx"), "utf8")

function registeredIconsFromSource(): string[] {
  // Carve out the union body between `export type IconName =` and the
  // terminating `;`. Strip comments first — block comments like
  // `/* ... */` and line comments like `// ... \n` may carry sample
  // strings (e.g. `"..."`) that would otherwise be picked up as
  // bogus IconName entries.
  const m = ICON_TSX.match(/export type IconName\s*=\s*([\s\S]*?);/)
  if (!m) throw new Error("IconName union not found in Icon.tsx")
  const stripped = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  return [...stripped.matchAll(/"([^"]+)"/g)].map((mm) => mm[1]!)
}

function listTsx(dir: string, exclude: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (exclude.has(full)) continue
    if (statSync(full).isDirectory()) out.push(...listTsx(full, exclude))
    else if (name.endsWith(".tsx")) out.push(full)
  }
  return out
}

describe("flat-redesign Icon primitive registry", () => {
  test("at least the 14 known icons are registered", () => {
    const registered = registeredIconsFromSource()
    expect(registered.length).toBeGreaterThanOrEqual(14)
    expect(registered).toContain("close")
    expect(registered).toContain("folder")
    expect(registered).toContain("acceptance")
  })

  test("every IconName declared in the union has one backing source", () => {
    const registered = registeredIconsFromSource()
    for (const name of registered) {
      const escaped = name.replace(/-/g, "\\-")
      const re = new RegExp(`(?:["']${escaped}["']|\\b${escaped}\\b)\\s*:\\s*\\{`)
      if (!re.test(ICON_TSX)) {
        throw new Error(`IconName "${name}" has no Lucide or custom icon entry`)
      }
    }
  })

  test("commodity icons are backed by lucide-solid", () => {
    expect(ICON_TSX).toContain('from "lucide-solid"')
    expect(ICON_TSX).toContain("const LUCIDE_ICON_MAP")
    for (const name of ["close", "plus", "search", "refresh", "copy", "download", "status-completed"]) {
      const escaped = name.replace(/-/g, "\\-")
      expect(ICON_TSX).toMatch(new RegExp(`(?:["']${escaped}["']|\\b${escaped}\\b)\\s*:\\s*\\{\\s*component:`))
    }
  })

  test("custom SVG fallback remains isolated inside Icon.tsx", () => {
    expect(ICON_TSX).toContain("const CUSTOM_ICON_PATHS")
    expect(ICON_TSX).toContain('viewBox="0 0 16 16"')
    expect(ICON_TSX).toContain('stroke="currentColor"')
    expect(ICON_TSX).toContain('stroke-linecap="round"')
    expect(ICON_TSX).toContain('stroke-linejoin="round"')
    expect(ICON_TSX).toContain('fill="none"')
  })

  test("iconHtml is a pure utility entry installed by the Icon primitive owner", () => {
    expect(ICON_HTML_TSX).toContain("installIconHtmlRenderer")
    expect(ICON_HTML_TSX).toContain('"iconHtml renderer has not been installed"')
    expect(ICON_HTML_TSX).not.toContain("../components/Icon")
    expect(ICON_HTML_TSX).not.toContain("ICON_PATHS")
    expect(ICON_HTML_TSX).not.toContain("renderToString")
    expect(MAIN_TSX).toContain("installIconHtmlRenderer")
    expect(MAIN_TSX).toContain("REGISTERED_ICONS")
    expect(MAIN_TSX).toContain("LUCIDE_ICON_NAMES")
    expect(MAIN_TSX).toContain("render(")
    expect(MAIN_TSX).not.toContain("renderToString")
  })
})

describe("flat-redesign character-icon callsites are gone", () => {
  // Excluded files: in-text status indicators (✓ ✗ ⧉) that aren't
  // icons in the structural sense — they're inline glyphs in copy.
  const EXCLUDED = new Set([
    join(COMPONENTS_ROOT, "TracePanel.tsx"),
    join(COMPONENTS_ROOT, "EvaluationCriteriaPanel.tsx"),
  ])

  // Patterns we forbid across .tsx components and main.tsx. Each
  // entry is `[label, regex]`. Regex must match a JSX literal or an
  // innerHTML template-string literal — both shapes counted as
  // character-icon escapes.
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["close-X JSX literal", />\s*×\s*<\/button>/],
    ["close-X innerHTML literal", />×<\/button>/],
    ["folder emoji", /📁/],
    ["caret-down literal in JSX", />▾</],
    ["chevron literal in JSX", />▸</],
  ]

  function gatherSources(): string[] {
    return [
      ...listTsx(COMPONENTS_ROOT, EXCLUDED),
      // Step 7 (2026-05-04): main.tsx is now in scope — its innerHTML
      // template-string for the recent-dirs panel close button was
      // migrated from `>×</button>` to inline SVG matching the Icon
      // primitive contract.
      join(import.meta.dir, "..", "src", "main.tsx"),
    ]
  }

  for (const [label, re] of FORBIDDEN) {
    test(`no ${label} across components/ + main.tsx`, () => {
      const files = gatherSources()
      const violations: string[] = []
      for (const file of files) {
        const text = readFileSync(file, "utf8")
        if (re.test(text)) {
          violations.push(file)
        }
      }
      if (violations.length > 0) {
        throw new Error(
          `${label} regressed in:\n  ${violations.join("\n  ")}\n` +
            `Use <Icon name="..." /> from components/Icon.tsx, or — for ` +
            `innerHTML template flows — iconHtml() installed by the Icon ` +
            `primitive owner.`,
        )
      }
    })
  }

  test("no SECTION_ICONS innerHTML map under components/Board.tsx", () => {
    const board = readFileSync(join(COMPONENTS_ROOT, "Board.tsx"), "utf8")
    expect(board).not.toMatch(/const SECTION_ICONS\s*[:=]/)
    expect(board).not.toMatch(/innerHTML=\{[^}]*SECTION_ICONS/)
  })

  test("no inline 16px or 24px icon svg literals outside Icon.tsx", () => {
    const EXEMPT = new Set([join(COMPONENTS_ROOT, "Icon.tsx")])
    const files = [
      ...listTsx(COMPONENTS_ROOT, EXEMPT),
      join(import.meta.dir, "..", "src", "main.tsx"),
      join(import.meta.dir, "..", "src", "index.html"),
      join(import.meta.dir, "..", "src", "utils", "dom-utils.ts"),
      join(import.meta.dir, "..", "src", "utils", "markdown.ts"),
    ]
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8")
      if (/<svg\b[^>]*viewBox="0 0 (?:16 16|24 24)"/.test(text)) {
        violations.push(file)
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `inline icon svg literal regressed in:\n  ${violations.join("\n  ")}\n` +
          `Use <Icon name="..." /> from components/Icon.tsx or iconHtml() for string-template flows.`,
      )
    }
  })

  test("retired body-scope alias tokens have no consumers", () => {
    // Step 7 (2026-05-04): `--ok / --warning / --danger / --text-dim`
    // aliases retired from design-language.css. Verified zero callsites
    // before deletion; this guard keeps it that way.
    const RETIRED = ["--ok", "--warning", "--danger", "--text-dim"]
    const stylesRoot = join(import.meta.dir, "..", "src", "styles")
    const allCss: string[] = []
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith(".css")) allCss.push(full)
      }
    }
    walk(stylesRoot)
    const violations: string[] = []
    for (const file of allCss) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
      for (const token of RETIRED) {
        const consumerRe = new RegExp(`var\\(${token.replace(/-/g, "\\-")}\\)`)
        if (consumerRe.test(text)) {
          violations.push(`${file}: still references var(${token})`)
        }
        const declRe = new RegExp(`(?:^|[\\s;{])${token.replace(/-/g, "\\-")}\\s*:`)
        if (declRe.test(text)) {
          violations.push(`${file}: still declares ${token}`)
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(`retired body-scope aliases still in use:\n  ${violations.join("\n  ")}`)
    }
  })
})
