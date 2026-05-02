// Regression for iter15 of the design-language audit.
//
// `.sections` (the right-column container holding the Goals /
// Files / Workflow / Inspector / Preview section stack) was
// defined four times in styles.css:
//
//   - line ~1995: canonical full-chrome — bordered, rounded,
//                 gradient + drop-shadow background, hover state
//                 that lifts the shadow.
//   - line ~12257: `.sidebar, .chat, .sections { … !important }`
//                 multi-selector flat override that knocks out
//                 background / border / radius / box-shadow.
//   - line ~12798: `.sections { background: var(--inspector-surface)
//                 !important }` extra background override.
//   - line ~12804: another `.sidebar, .chat, .sections { border:
//                 0 !important; border-radius: 0 !important; }`
//                 with overlapping flat overrides.
//
// Same dual-source-with-!important anti-pattern as `.chat-empty`
// (iter5), `.sidebar-list-heading` (iter8), `.titlebar` (iter14).
// The canonical block is a lie — the rendered `.sections` is
// flat, not chromed. Anyone tweaking the canonical loses to the
// !important chain at the file's tail.
//
// Pin a single source: one canonical `.sections { … }` rule with
// no `!important`, flat by default (matching the rendered
// reality and the calm/flat design direction shipped in
// iter4 / iter5 / iter14). The `.sidebar, .chat, .sections`
// multi-selectors that survive after this iter target only
// `.sidebar` + `.chat` — `.sections` no longer needs to be in
// those lists because its canonical is already flat.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)

function countSoloTopLevelRules(selector: string): number {
  // Solo top-level rules only — no leading whitespace, no
  // theme prefix (`body[data-theme]`), no multi-selector list.
  // Theme-scoped overrides like `body[data-theme="light"]
  // .sections { … }` are legitimate per-context tweaks; the
  // dual-source pattern this iter targeted is the bare
  // `.sections { … }` block being defined more than once.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "g")
  return Array.from(STYLES.matchAll(re)).length
}

function soloRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)${escaped}\\s*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`solo ${selector} not found in styles.css`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe(".sections is a single source of truth", () => {
  test("only one solo top-level `.sections { … }` rule exists", () => {
    expect(countSoloTopLevelRules(".sections")).toBe(1)
  })

  test("the canonical `.sections` body uses no `!important`", () => {
    expect(soloRuleBody(".sections")).not.toContain("!important")
  })

  test("`.sections` is no longer riding on `.sidebar, .chat, .sections { … !important }` flat resets", () => {
    // After iter15 the chains at lines ~12257 / ~12804 only list
    // `.sidebar, .chat`. `.sections` is self-flat at the
    // canonical block, so it doesn't need to be in those
    // !important resets any more.
    expect(STYLES).not.toMatch(/\.sidebar,[\s\n]*\.chat,[\s\n]*\.sections\s*\{[^}]*!important/)
  })
})
