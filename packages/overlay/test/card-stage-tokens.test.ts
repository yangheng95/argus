import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { stageAccent } from "../src/utils/card-color"

const CARD_CSS = readFileSync(
  join(import.meta.dir, "..", "src", "styles", "surfaces", "card.css"),
  "utf8",
)

const KNOWN_STAGES = [
  "user",
  "assistant",
  "system",
  "orchestrator",
  "mission",
  "intent-analysis",
  "spec",
  "requirements",
  "frontend-design",
  "architect",
  "planner",
  "goal",
  "executor",
  "build",
  "explore",
  "evaluator",
  "delivery",
  "integrity",
  "tool",
] as const

describe("card stage tokens", () => {
  test("every stage stageAccent emits has a matching --card-stage-* CSS var", () => {
    const missing: string[] = []
    for (const stage of KNOWN_STAGES) {
      const accent = stageAccent(stage)
      expect(accent).toBe(`var(--card-stage-${stage})`)
      const declared = new RegExp(`--card-stage-${stage}\\s*:`).test(CARD_CSS)
      if (!declared) missing.push(stage)
    }
    expect(missing).toEqual([])
  })

  test("border-left shorthand rules carry a fallback so an unset --card-stage cannot blank the rail", () => {
    // Only the shorthand (`border-left: <width> <style> <color>`) is at risk —
    // an invalid `var(--card-stage)` invalidates the whole declaration and
    // resets `border-left-style` to `none`, hiding the rail. The
    // `border-left-color: var(--card-stage-...)` status overrides set color
    // alone and don't need fallbacks (they only run when the shorthand
    // already painted a rail).
    const railLines = CARD_CSS.split(/\r?\n/).filter(
      (line) =>
        /border-left\s*:/.test(line) &&
        /var\(--card-stage[^-]/.test(line),
    )
    expect(railLines.length).toBeGreaterThan(0)
    for (const line of railLines) {
      expect(line).toMatch(/var\(--card-stage,\s*var\(--card-stage-[a-z-]+\)\)/)
    }
  })

  test("stage tokens resolve from theme-adaptive base tokens, not hex literals", () => {
    const block = CARD_CSS.match(/Per-stage rail tokens[\s\S]*?--card-stage-tool:[^;]+;/)
    expect(block).not.toBeNull()
    const text = block?.[0] ?? ""
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    for (const stage of KNOWN_STAGES) {
      const decl = new RegExp(`--card-stage-${stage}\\s*:\\s*([^;]+);`).exec(text)
      expect(decl).not.toBeNull()
      expect(decl?.[1] ?? "").toMatch(/var\(--(accent|good|warn|bad|text-soft)\)/)
    }
  })
})
