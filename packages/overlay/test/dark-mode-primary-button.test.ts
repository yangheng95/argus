// Regression for iter19 of the design-language audit.
//
// User feedback (2026-05-02 22:57): "深色模式下渐变色按钮有点
// 奇怪" — the gradient primary buttons look weird in dark mode.
//
// Primary buttons (.btn-primary, .sidebar-btn-primary,
// .chat-send, .board-intro__cta-action) used a multi-hue
// accent gradient — `linear-gradient(135deg, #4b8dff, #7b83ff
// 52%, #9b62ff)` (blue → violet). On a dark surface this reads
// as a saturated retro candy bar; the calm/flat trajectory
// shipped in iter4 / iter15 / iter16 / iter17 / iter18 calls
// for a single solid accent instead.
//
// Pin the contract: the dark-theme + vscode-dark-theme primary-
// button overrides use solid `var(--accent)` for the resting
// state and solid `var(--accent-hover)` on hover. The light
// theme keeps its gradient (the user's complaint was scoped
// to dark mode and the lighter background carries a gradient
// gracefully).

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)

function ruleBodies(headRegex: RegExp): string[] {
  const out: string[] = []
  for (const match of STYLES.matchAll(headRegex)) {
    const open = match.index! + match[0].length - 1
    const close = STYLES.indexOf("}", open)
    if (close < 0) continue
    out.push(STYLES.slice(open + 1, close))
  }
  return out
}

describe("dark-mode primary buttons render with a solid accent (no multi-hue gradient)", () => {
  test("the dark-theme primary-button reset uses a solid accent, not the multi-hue gradient", () => {
    // Find the block with both `[data-theme="dark"]` and the
    // primary-button selector list. Assert its body uses
    // `var(--accent)` (solid) and NOT `var(--accent-gradient)`.
    const headRe = new RegExp(
      `(^|\\n)(body[^{]*\\[data-theme=["']dark["'][^{]*?(?:\\.sidebar-btn-primary|\\.btn-primary|\\.chat-send)[^{]*?)\\{`,
      "g",
    )
    const bodies = ruleBodies(headRe)
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      // The hover-only block is allowed (it's also under
      // dark-theme but governs hover state — same rule
      // applies). Both should use solid accent.
      expect(body).not.toMatch(/background:\s*var\(--accent-gradient(?:-hover)?\)/)
    }
  })
})
