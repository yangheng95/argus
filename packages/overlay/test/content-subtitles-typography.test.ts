// Regression for iter12 of the design-language audit.
//
// Last sweep of tier-2 leaks across content panels — six classes
// that styled themselves as tier-3 status pills (uppercase + wide
// letter-spacing) but had no pill chrome (no background, no
// border-radius, no accent color):
//
//   .change-subline                (path/context line under a
//                                    file row in the changes list)
//   .diff-preview-scope            (file scope label in diff
//                                    preview header)
//   .msg-todo-card__label          ("In progress", "Pending"
//                                    section labels in TodoListPart)
//   .msg-read-reminder__label      ("Read reminder" subtitle)
//   .log-detail-title              (log-viewer detail block
//                                    subtitle: "Stack", "Body", …)
//   .board-intro__section-title    (board intro section title:
//                                    "Modes", "Agents")
//
// All six are plain subtitles inside content. Same logic as iter4 /
// iter7 / iter9 / iter10 / iter11: no pill chrome → not a status
// chip → drop the all-caps + wide tracking. The remaining
// uppercase tier-3 pills (verdict-pill, req-status, reasoning-label,
// criteria-result, eval-error-meta, session-msg-role, md-code-lang,
// gwg-priority-badge, gwg-step-status, gwg-verdict, integrity__tag,
// req-priority, req-type, status-label, brand-guide-kicker)
// keep their styling — they ARE color-coded short-word chips and
// the all-caps pill convention reads as a status tag there.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const head = new RegExp(`(^|\\n)\\s*${escaped}(?=[\\s,{[])[^{]*\\{`, "m").exec(STYLES)
  if (!head) throw new Error(`selector ${selector} not found in styles.css`)
  const open = head.index + head[0].length - 1
  const close = STYLES.indexOf("}", open)
  if (close < 0) throw new Error(`malformed block for ${selector}`)
  return STYLES.slice(open + 1, close)
}

describe("content-area subtitles render Title Case", () => {
  for (const sel of [
    ".change-subline",
    ".diff-preview-scope",
    ".msg-todo-card__label",
    ".msg-read-reminder__label",
    ".log-detail-title",
    ".board-intro__section-title",
  ]) {
    test(`${sel} does not force-uppercase`, () => {
      expect(ruleBody(sel)).not.toContain("text-transform: uppercase")
    })
  }
})

describe("legitimate tier-3 pills keep uppercase (negative control)", () => {
  for (const sel of [
    ".verdict-pill",
    ".req-status",
    ".reasoning-label",
    ".gwg-step-status",
    ".gwg-priority-badge",
    ".md-code-lang",
  ]) {
    test(`${sel} stays uppercase`, () => {
      expect(ruleBody(sel)).toContain("text-transform: uppercase")
    })
  }
})
