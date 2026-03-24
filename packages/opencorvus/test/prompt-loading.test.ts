/**
 * Quick verification that all prompt files load correctly as non-empty strings.
 *
 * Run: bun test test/prompt-loading.test.ts
 */
import { describe, test, expect } from "bun:test"

// --- Agent prompts ---
import PROMPT_EXPLORE from "../src/agent/prompt/explore.txt"
import PROMPT_GENERAL from "../src/agent/prompt/general.txt"
import PROMPT_COMPACTION from "../src/agent/prompt/compaction.txt"
import PROMPT_SUMMARY from "../src/agent/prompt/summary.txt"
import PROMPT_TITLE from "../src/agent/prompt/title.txt"
import PROMPT_JUDGE from "../src/agent/prompt/judge.txt"

// --- Core prompts (shared across headless, executor-native, and interactive variants) ---
import SPEC_CORE from "../src/prompt/core/spec-core.txt"
import PLAN_CORE from "../src/prompt/core/plan-core.txt"

// --- Interactive overlays ---
import SPEC_INTERACTIVE from "../src/agent/prompt/spec-interactive.txt"
import PLAN_INTERACTIVE from "../src/agent/prompt/plan-interactive.txt"

// --- System prompt ---
import PROMPT_SYSTEM from "../src/session/prompt/system.txt"

describe("Prompt file loading", () => {
  const prompts: Record<string, string> = {
    system: PROMPT_SYSTEM,
    explore: PROMPT_EXPLORE,
    general: PROMPT_GENERAL,
    compaction: PROMPT_COMPACTION,
    summary: PROMPT_SUMMARY,
    title: PROMPT_TITLE,
    judge: PROMPT_JUDGE,
    spec_core: SPEC_CORE,
    plan_core: PLAN_CORE,
    spec_interactive: SPEC_INTERACTIVE,
    plan_interactive: PLAN_INTERACTIVE,
  }

  for (const [name, content] of Object.entries(prompts)) {
    test(`prompt "${name}" loads as non-empty string`, () => {
      expect(typeof content).toBe("string")
      expect(content.length).toBeGreaterThan(30)
    })
  }
})

describe("Core prompt composition", () => {
  test("spec composite (core + interactive) is coherent", () => {
    const composite = SPEC_CORE + "\n\n" + SPEC_INTERACTIVE
    expect(composite).toContain("specification brain")
    expect(composite).toContain("spec_exit")
    expect(composite).toContain("check_selector")
  })

  test("plan composite (core + interactive) is coherent", () => {
    const composite = PLAN_CORE + "\n\n" + PLAN_INTERACTIVE
    expect(composite).toContain("planning brain")
    expect(composite).toContain("plan_exit")
    expect(composite).toContain("check_selector")
  })

  test("spec core contains shared identity", () => {
    expect(SPEC_CORE).toContain("OpenCorvus")
    expect(SPEC_CORE).toContain("EXPLORE")
    expect(SPEC_CORE).toContain("spec_items")
  })

  test("plan core contains shared identity", () => {
    expect(PLAN_CORE).toContain("OpenCorvus")
    expect(PLAN_CORE).toContain("EXPLORE")
    expect(PLAN_CORE).toContain("<goals>")
  })
})

describe("Prompt uniqueness", () => {
  test("core prompts are distinct from each other", () => {
    expect(SPEC_CORE).not.toBe(PLAN_CORE)
  })

  test("interactive overlays are distinct from each other", () => {
    expect(SPEC_INTERACTIVE).not.toBe(PLAN_INTERACTIVE)
  })
})
