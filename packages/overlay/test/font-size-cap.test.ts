// Regression for iter48 of the design-language audit.
//
// User feedback (2026-05-03): "以标题栏菜单的字体大小为准，
// 任何其余字体都不允许比他字体更大".
//
// The titlebar menubar trigger (`.titlebar-menubar-trigger`)
// renders at `var(--ui-font-body)` (≈12px). iter48 caps the
// three larger typography tokens — `--ui-font-display`,
// `--ui-font-heading`, `--ui-font-title` — to that body value
// at the :root level (and the system-theme :root override
// further down in styles.css) so every selector that consumed
// them resolves to the same 12px ceiling.
//
// Pin: walk both :root blocks and assert the four tokens
// (display / heading / title / body) all resolve to the same
// body value. A future contributor who bumps any of the three
// up trips the test.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const RAW = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const STYLES = RAW.replace(/\/\*[\s\S]*?\*\//g, "")

function tokenValuesIn(blockBody: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(--ui-font-(?:display|heading|title|body)):\s*([^;]+);/g
  for (const m of blockBody.matchAll(re)) {
    out[m[1]] = m[2].trim()
  }
  return out
}

function findRootBlocks(): string[] {
  const re = /:root\s*(?:,[^{]*)?\{([\s\S]*?)\}/g
  return Array.from(STYLES.matchAll(re)).map((m) => m[1])
}

describe("typography tokens cap at the menubar body size (iter48)", () => {
  test("every :root block declares display = heading = title = body", () => {
    const blocks = findRootBlocks()
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    let assertedAtLeastOne = false
    for (const body of blocks) {
      const t = tokenValuesIn(body)
      // Only assert blocks that declare the body token (some
      // :root variants only override colors / radius — those
      // inherit the typography from the primary block).
      if (!t["--ui-font-body"]) continue
      assertedAtLeastOne = true
      expect(t["--ui-font-display"]).toBe(t["--ui-font-body"])
      expect(t["--ui-font-heading"]).toBe(t["--ui-font-body"])
      expect(t["--ui-font-title"]).toBe(t["--ui-font-body"])
    }
    expect(assertedAtLeastOne).toBe(true)
  })
})
