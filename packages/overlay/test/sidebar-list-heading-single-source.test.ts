// Regression for iter8 of the design-language audit.
//
// `.sidebar-list-heading` (the small group label above each chat
// cluster in the sidebar — "Today" / "Yesterday" / "Last 7 days"
// / "Older") used to be defined twice in styles.css:
//
//   - line ~9666: the canonical block, with
//       text-transform: uppercase; letter-spacing: 0.1em;
//   - line ~12329: a follow-up rule sharing a selector list with
//       `.project-group-heading`, that flips the heading back to
//       text-transform: none + letter-spacing: 0 so the sidebar
//       label reads "Today" rather than "TODAY".
//
// The same dual-source-with-late-override anti-pattern that iter5
// collapsed for `.chat-empty`. Reading just the canonical block
// would leave a contributor convinced the heading was uppercase,
// then any tweak there would silently lose to the late override.
// Folded the two blocks together so there's a single source.
//
// (`.project-group-heading` keeps its own canonical rule — the
// late selector at ~12329 only existed to drop `.sidebar-list-
// heading` back to Title Case while bumping its left padding;
// after the merge, project-group-heading no longer needs to share
// that rule.)

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const STYLES_ROOT = path.resolve(import.meta.dir, "..", "src", "styles")

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

// Concatenate all surface + cascade + primitive CSS files (styles.css was
// dissolved 2026-05-04 into this decomposed architecture). Comments are
// stripped first so a /* ... */ block immediately preceding a rule does
// not get folded into the rule's selector head when we split on }.
function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "")
}
const STYLES = stripCssComments(
  walkCss(STYLES_ROOT)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n"),
)

function countRulesStartingWith(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Match selectors that START with the class — either as the whole
  // head (`.foo {`) or as the first item in a list (`.foo, .bar {`).
  const re = new RegExp(`(^|\\n)\\s*${escaped}(?=[\\s,{])[^{]*\\{`, "g")
  return Array.from(STYLES.matchAll(re)).length
}

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)\\s*${escaped}(?=[\\s,{[])[^{]*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`selector ${selector} not found in surface files`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe(".sidebar-list-heading is a single source of truth", () => {
  test(".sidebar-list-heading appears in exactly one rule head", () => {
    expect(countRulesStartingWith(".sidebar-list-heading")).toBe(1)
  })

  test("the canonical .sidebar-list-heading is Title Case (no text-transform: uppercase)", () => {
    const body = ruleBody(".sidebar-list-heading")
    expect(body).not.toContain("text-transform: uppercase")
  })
})
