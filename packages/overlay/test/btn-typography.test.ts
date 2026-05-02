// Regression for iter4 of the right-panel design-language audit.
//
// `.btn` (the overlay's primary button primitive at styles.css:6339)
// carried `text-transform: uppercase` and `letter-spacing: 0.05em`,
// which force-uppercased every button label across the overlay
// regardless of what i18n returned. So `Copy All` became `COPY ALL`,
// `Set up` became `SET UP`, etc — directly clashing with the Title
// Case used everywhere else (section titles, tab labels, field labels)
// and with the modern calm/flat trajectory recent commits have been
// pushing the overlay toward (a345c39a2 calm workflow, c399c6838
// transparent secondary controls, 5f0f209d3 remove right panel
// decorative borders, a5723925a flatten themes).
//
// Tier-3 status pills (verdict-pill, req-type, req-status, gwg-step-
// status, etc.) DO keep their uppercase styling — those are short
// single-word color-coded chips where the pill convention reads as a
// status tag, not as a screaming action. The negative control below
// pins that distinction so a future "remove all uppercase" sweep
// can't quietly strip the legitimate tier-3 pill styling either.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)

function ruleBody(selector: string): string {
  // Match a CSS rule that STARTS with the given selector (so a
  // descendant rule like `.foo .btn { ... }` doesn't steal the match).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)\\s*${escaped}(?=[\\s,{[])[^{]*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`selector ${selector} not found in styles.css`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe(".btn primary primitive renders Title Case action labels", () => {
  test(".btn does NOT force-uppercase its label", () => {
    const body = ruleBody(".btn")
    expect(body).not.toContain("text-transform: uppercase")
  })

  test(".btn does NOT carry the all-caps wide letter-spacing", () => {
    const body = ruleBody(".btn")
    // The 0.05em wide letter-spacing was paired with text-transform:
    // uppercase to make all-caps labels readable. With Title Case the
    // wide tracking just looks loose, so it goes too. A button can
    // still set its own letter-spacing if the design calls for it.
    expect(body).not.toMatch(/letter-spacing:\s*0\.05em/)
  })
})

describe("tier-3 status pills keep their uppercase styling (negative control)", () => {
  // These are the pills the "no uppercase" rule does NOT apply to. If
  // a future sweep accidentally removes their uppercase too, the
  // status badges lose their pill identity.
  for (const sel of [".verdict-pill", ".req-type", ".req-status"]) {
    test(`${sel} stays uppercase`, () => {
      expect(ruleBody(sel)).toContain("text-transform: uppercase")
    })
  }
})
