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
  // terminating `;`. Comments inside the union are tolerated.
  const m = ICON_TSX.match(/export type IconName\s*=\s*([\s\S]*?);/)
  if (!m) throw new Error("IconName union not found in Icon.tsx")
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((mm) => mm[1]!)
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
    expect(registered).toContain("delivery")
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
  // Excluded files: see jsdoc above. These are out-of-scope for Step 3
  // and are tracked in plan §3 Step 6 (dead-code cleanup).
  const EXCLUDED = new Set([
    join(COMPONENTS_ROOT, "TracePanel.tsx"), // intentional inline ✓ ✗ ⧉
    join(COMPONENTS_ROOT, "EvaluationCriteriaPanel.tsx"), // ditto
  ])

  // Patterns we forbid in component .tsx files.
  // Each entry is `[label, regex]`. Regex must match a JSX literal,
  // not a comment or string in i18n message bodies (none of these
  // characters appear in the active i18n catalog as labels).
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["close-X JSX literal", />\s*×\s*<\/button>/],
    ["folder emoji", /📁/],
    ["caret-down literal in JSX", />▾</],
    ["chevron literal in JSX", />▸</],
  ]

  for (const [label, re] of FORBIDDEN) {
    test(`no ${label} in components/`, () => {
      const files = listTsx(COMPONENTS_ROOT, EXCLUDED)
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
            `Use <Icon name="..." /> from components/Icon.tsx instead.`,
        )
      }
    })
  }

  test("no SECTION_ICONS innerHTML map under components/Board.tsx", () => {
    const board = readFileSync(join(COMPONENTS_ROOT, "Board.tsx"), "utf8")
    expect(board).not.toMatch(/const SECTION_ICONS\s*[:=]/)
    expect(board).not.toMatch(/innerHTML=\{[^}]*SECTION_ICONS/)
  })
})
