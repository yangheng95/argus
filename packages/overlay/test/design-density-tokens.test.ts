import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const TOKENS = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles", "tokens", "design-language.css"),
  "utf8",
)

describe("design density tokens stay on the tightened 2026-05-05 scale", () => {
  test("large radius stays on the flatter 8px token", () => {
    expect(TOKENS).toContain("--oc-radius-large: calc(8px * var(--ui-scale, 1));")
  })

  test("control heights share the 26px density contract", () => {
    expect(TOKENS).toContain("--oc-density-control-height: calc(26px * var(--ui-scale, 1));")
    expect(TOKENS).toContain("--oc-density-icon-button: calc(26px * var(--ui-scale, 1));")
  })

  test("body, control, and meta copy share the 14px Codex app baseline", () => {
    expect(TOKENS).toContain("--ui-font-body: calc(14px * var(--ui-scale));")
    expect(TOKENS).toContain("--ui-font-control: calc(14px * var(--ui-scale));")
    expect(TOKENS).toContain("--ui-font-meta: calc(14px * var(--ui-scale));")
  })

  test("secondary copy remains readable below the app baseline", () => {
    expect(TOKENS).toContain("--ui-font-small: calc(12px * var(--ui-scale));")
    expect(TOKENS).toContain("--ui-font-tiny: calc(11px * var(--ui-scale));")
    expect(TOKENS).toContain("--ui-font-code: calc(13px * var(--ui-scale));")
  })

  test("titlebar and panel headers keep the compact 42/40px rhythm", () => {
    expect(TOKENS).toContain("--ui-titlebar-height: calc(42px * var(--ui-scale));")
    expect(TOKENS).toContain("--ui-panel-header-height: calc(40px * var(--ui-scale));")
  })
})
