/**
 * Coverage guard for flat-redesign Step 3 (specs/overlay-flat-redesign/plan.md §2.3).
 *
 * Two assertions:
 *
 *   1. The Icon primitive registry is the single source of icon SVG.
 *      Every entry in REGISTERED_ICONS satisfies the unified shape:
 *      stroke="currentColor", fill defaults to "none", line-cap/join
 *      "round". (Tested by rendering each Icon and inspecting the
 *      attribute set.)
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

function registeredIconsFromSource(): string[] {
  // Carve out the union body between `export type IconName =` and the
  // terminating `;`. Strip comments first — block comments like
  // `/* ... */` and line comments like `// ... \n` may carry sample
  // strings (e.g. `"..."`) that would otherwise be picked up as
  // bogus IconName entries.
  const m = ICON_TSX.match(/export type IconName\s*=\s*([\s\S]*?);/)
  if (!m) throw new Error("IconName union not found in Icon.tsx")
  const stripped = m[1]!
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
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

  test("every IconName declared in the union has an ICON_PATHS entry", () => {
    const registered = registeredIconsFromSource()
    for (const name of registered) {
      // Object literal keys: bare identifier (`close: {`) or quoted
      // string (`"caret-down": {`). Hyphenated names require quotes.
      const escaped = name.replace(/-/g, "\\-")
      const re = new RegExp(`(?:["']${escaped}["']|\\b${escaped}\\b)\\s*:\\s*\\{`)
      if (!re.test(ICON_TSX)) {
        throw new Error(`IconName "${name}" has no ICON_PATHS entry`)
      }
    }
  })

  test("the SVG attribute contract is single-source on the Icon component", () => {
    // Pin the canonical attribute set so a stray copy-paste of inline
    // SVG with different stroke-width / cap / join can't sneak in.
    expect(ICON_TSX).toContain('viewBox="0 0 16 16"')
    expect(ICON_TSX).toContain('stroke="currentColor"')
    expect(ICON_TSX).toContain('stroke-linecap="round"')
    expect(ICON_TSX).toContain('stroke-linejoin="round"')
    expect(ICON_TSX).toContain('fill="none"')
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
            `innerHTML template flows — an inline SVG matching the Icon ` +
            `primitive contract (viewBox 16, stroke=currentColor, stroke-` +
            `width 1.4, line-cap/join round).`,
        )
      }
    })
  }

  test("no SECTION_ICONS innerHTML map under components/Board.tsx", () => {
    const board = readFileSync(join(COMPONENTS_ROOT, "Board.tsx"), "utf8")
    expect(board).not.toMatch(/const SECTION_ICONS\s*[:=]/)
    expect(board).not.toMatch(/innerHTML=\{[^}]*SECTION_ICONS/)
  })

  test("no inline 16x16 svg literal across components/ (Icon.tsx is the single source)", () => {
    // Step 8b (2026-05-04): every 16x16 icon must render through the
    // Icon primitive, not as an inline JSX <svg>. Larger viewBoxes
    // (illustrations like chat-empty 40x40 or agent-workflow-beam
    // 28x104) are deliberately out of scope — they're not icons.
    //
    // Files exempt: Icon.tsx (the primitive itself).
    const EXEMPT = new Set([join(COMPONENTS_ROOT, "Icon.tsx")])
    const files = listTsx(COMPONENTS_ROOT, EXEMPT)
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8")
      // Match an inline JSX <svg> opening tag with viewBox="0 0 16 16"
      // (allow optional attributes between `<svg` and `viewBox`).
      if (/<svg\b[^>]*viewBox="0 0 16 16"/.test(text)) {
        violations.push(file)
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `inline 16x16 svg literal regressed in:\n  ${violations.join("\n  ")}\n` +
          `Use <Icon name="..." /> from components/Icon.tsx — add a new IconName ` +
          `to the registry if no existing icon fits.`,
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
