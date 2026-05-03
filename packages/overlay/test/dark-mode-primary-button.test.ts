// Regression for iter19 of the design-language audit, refreshed for the
// 2026-05-03 primary-button palette-only refactor.
//
// Original user feedback (2026-05-02 22:57): "深色模式下渐变色按钮有点
// 奇怪" — the gradient primary buttons look weird in dark mode. The
// original fix used a `body:is([data-theme="dark"], …) :is(.btn-primary,
// .sidebar-btn-primary, .board-intro__cta-action)` selector to force a
// solid accent on dark surfaces. That made the theme override button
// chrome, which violates the "themes only swap palette" contract this
// codebase now enforces.
//
// New contract: the dark + vscode-dark `:root` blocks override
// `--accent-gradient` itself to `var(--accent)` (and
// `--accent-gradient-hover` to `var(--accent-hover)`). The shared
// canonical at the multi-class selector reads `--accent-gradient`
// directly, so dark surfaces resolve to a solid accent without any
// theme selector touching `.btn-primary` / `.sidebar-btn-primary` /
// `.board-intro__cta-action`. Light keeps the linear-gradient palette
// because the original complaint was scoped to dark.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const STYLES = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)

function rootBodyOfTheme(theme: "dark" | "vscode-dark"): string {
  // styles.css carries multiple `body[data-theme="<theme>"]` palette
  // blocks (the original early-cascade palette and the iter22 "cohesive
  // workbench" palette later in the file). The iter22 block wins under
  // CSS cascade, so this helper returns the last matching block — that is
  // the one that actually decides the rendered palette.
  const headRe = new RegExp(
    `body\\[data-theme="${theme}"\\]\\s*\\{`,
    "g",
  )
  const matches = [...STYLES.matchAll(headRe)]
  if (matches.length === 0) throw new Error(`theme block for ${theme} not found`)
  const last = matches[matches.length - 1]!
  const open = last.index! + last[0].length - 1
  const close = STYLES.indexOf("\n}", open)
  if (close < 0) throw new Error(`theme block ${theme} missing close brace`)
  return STYLES.slice(open + 1, close)
}

describe("dark-mode primary buttons render with a solid accent (no multi-hue gradient)", () => {
  for (const theme of ["dark", "vscode-dark"] as const) {
    test(`${theme} :root flattens --accent-gradient to the solid accent palette`, () => {
      const body = rootBodyOfTheme(theme)
      expect(body).toMatch(/--accent-gradient:\s*var\(--accent\)\s*;/)
      expect(body).toMatch(/--accent-gradient-hover:\s*var\(--accent-hover\)\s*;/)
      // Guard against a regression that re-introduces a multi-hue
      // gradient inside the dark palette: the token must resolve to a
      // solid accent var, not a `linear-gradient(...)` value.
      expect(body).not.toMatch(/--accent-gradient:\s*linear-gradient/)
      expect(body).not.toMatch(/--accent-gradient-hover:\s*linear-gradient/)
    })
  }

  test("primary-button selectors do not appear in any theme override block", () => {
    // The chrome layer is single-sourced in the shared canonical at line
    // 7585; no `body:is([data-theme="dark"], …) :is(.btn-primary, …)`
    // override is allowed. Iter19's selector-driven fix has been
    // retired in favour of a palette-only approach.
    const themeWithPrimaryRe = new RegExp(
      "body(?:\\[[^\\]]*data-theme[^\\]]*\\]|:is\\([^)]*data-theme[^)]*\\))" +
        "[^{]*(?:\\.btn-primary|\\.sidebar-btn-primary|\\.board-intro__cta-action)\\b",
      "g",
    )
    const stripped = STYLES.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(stripped).not.toMatch(themeWithPrimaryRe)
  })
})
