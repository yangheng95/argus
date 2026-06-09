// Regression for iter39 of the design-language audit.
//
// Bug discovered: iter28 / iter30 / iter36 each retired part of
// an `!important` border-color reset rule shared with multiple
// shell selectors. The cleanup deleted the rule body but left
// five selector lines dangling without a closing `{ … }`:
//
//   .section,
//   .gwg,
//   .acceptance-panel,
//   .criteria-group,
//   .eval-error,
//   /* "rule deleted" comment */
//
//   .board-intro { display: flex; flex-direction: column;
//                  padding: var(--ui-gap-lg); … }
//
// The CSS parser treats the trailing `,` as "selector list
// continues" — comments are whitespace — so the dangling
// selectors fuse with the next rule's selector list:
//
//   .section, .gwg, .acceptance-panel, .criteria-group,
//   .eval-error, .board-intro { display: flex; … }
//
// Result: every shell-level container silently inherited
// `display: flex; flex-direction: column;` and the
// `padding: var(--ui-gap-lg)` from board-intro. Most of these
// shells already declared their own display + padding, so the
// later canonical wins; but `.eval-error` and `.criteria-group`
// have no flex/padding canonical and would have rendered with
// board-intro's layout — wrong size + wrong axis.
//
// Pin: walk the CSS and assert no rule head is a "trailing
// comma" — the last segment of every selector list MUST be a
// real selector, not a dangling comma. A simple structural
// check: between the last `}` and the next `{`, no
// non-whitespace, non-comment character should be a `,`.

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

describe("styles.css carries no dangling selector lists", () => {
  test("every rule head ends with a selector segment, not a trailing comma", () => {
    const dangling: string[] = []
    for (const chunk of STYLES.split("}")) {
      const openIdx = chunk.indexOf("{")
      if (openIdx < 0) continue
      const head = chunk.slice(0, openIdx).trim()
      if (!head) continue
      // A rule head with a trailing `,` was caused by iter28/30/36
      // retiring a body but leaving its selector list dangling.
      // The next rule's `{` then absorbed those orphan selectors.
      if (head.endsWith(",")) dangling.push(head.slice(0, 200))
    }
    expect(dangling).toEqual([])
  })
})
