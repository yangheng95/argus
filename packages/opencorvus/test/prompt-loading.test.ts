/**
 * Quick verification that all prompt files load correctly
 * and the provider selection logic works as expected.
 *
 * Run: bun test test/prompt-loading.test.ts
 */
import { describe, test, expect } from "bun:test"

// --- 1. Verify all .txt prompt files can be imported and are non-empty ---

import PROMPT_CODEX from "../src/session/prompt/codex_header.txt"
import PROMPT_ANTHROPIC from "../src/session/prompt/anthropic.txt"
import PROMPT_BEAST from "../src/session/prompt/beast.txt"
import PROMPT_CODEX_GPT from "../src/session/prompt/codex.txt"
import PROMPT_GEMINI from "../src/session/prompt/gemini.txt"
import PROMPT_DEFAULT from "../src/session/prompt/default.txt"

import PROMPT_EXPLORE from "../src/agent/prompt/explore.txt"
import PROMPT_GENERAL from "../src/agent/prompt/general.txt"
import PROMPT_COMPACTION from "../src/agent/prompt/compaction.txt"
import PROMPT_SUMMARY from "../src/agent/prompt/summary.txt"
import PROMPT_TITLE from "../src/agent/prompt/title.txt"
import PROMPT_JUDGE from "../src/agent/prompt/judge.txt"

describe("Prompt file loading", () => {
  const providerPrompts = {
    codex_header: PROMPT_CODEX,
    anthropic: PROMPT_ANTHROPIC,
    beast: PROMPT_BEAST,
    codex_gpt: PROMPT_CODEX_GPT,
    gemini: PROMPT_GEMINI,
    default: PROMPT_DEFAULT,
  }

  const agentPrompts = {
    explore: PROMPT_EXPLORE,
    general: PROMPT_GENERAL,
    compaction: PROMPT_COMPACTION,
    summary: PROMPT_SUMMARY,
    title: PROMPT_TITLE,
    judge: PROMPT_JUDGE,
  }

  for (const [name, content] of Object.entries(providerPrompts)) {
    test(`provider prompt "${name}" loads as non-empty string`, () => {
      expect(typeof content).toBe("string")
      expect(content.length).toBeGreaterThan(50)
    })
  }

  for (const [name, content] of Object.entries(agentPrompts)) {
    test(`agent prompt "${name}" loads as non-empty string`, () => {
      expect(typeof content).toBe("string")
      expect(content.length).toBeGreaterThan(30)
    })
  }
})

// --- 2. Verify provider selection logic ---

describe("Provider prompt selection", () => {
  // Replicate the selection logic from system.ts
  function selectProviderPrompt(modelId: string): string {
    if (modelId.includes("claude")) return PROMPT_ANTHROPIC
    if (modelId.includes("gpt-4") || modelId.includes("o1") || modelId.includes("o3")) return PROMPT_BEAST
    if (modelId.includes("gpt")) return PROMPT_CODEX_GPT
    if (modelId.includes("gemini-")) return PROMPT_GEMINI
    return PROMPT_DEFAULT
  }

  const cases: Array<[string, string, string]> = [
    // [model ID, expected prompt name, description]
    ["claude-sonnet-4-20250514", "anthropic", "Claude Sonnet"],
    ["claude-opus-4-20250514", "anthropic", "Claude Opus"],
    ["claude-3-haiku-20240307", "anthropic", "Claude 3 Haiku"],
    ["gpt-4o", "beast", "GPT-4o"],
    ["gpt-4-turbo", "beast", "GPT-4 Turbo"],
    ["o1-preview", "beast", "o1-preview"],
    ["o3-mini", "beast", "o3-mini"],
    ["gpt-5", "codex_gpt", "GPT-5"],
    ["gpt-image-1", "codex_gpt", "GPT Image"],
    ["gemini-2.5-pro", "gemini", "Gemini 2.5 Pro"],
    ["gemini-2.0-flash", "gemini", "Gemini 2.0 Flash"],
    ["deepseek-chat", "default", "DeepSeek (fallback)"],
    ["qwen-72b", "default", "Qwen (fallback)"],
    ["mistral-large", "default", "Mistral (fallback)"],
  ]

  const promptMap: Record<string, string> = {
    anthropic: PROMPT_ANTHROPIC,
    beast: PROMPT_BEAST,
    codex_gpt: PROMPT_CODEX_GPT,
    gemini: PROMPT_GEMINI,
    default: PROMPT_DEFAULT,
  }

  for (const [modelId, expectedKey, desc] of cases) {
    test(`${desc} (${modelId}) -> ${expectedKey}`, () => {
      const result = selectProviderPrompt(modelId)
      expect(result).toBe(promptMap[expectedKey])
    })
  }
})

// --- 3. Verify prompts contain expected identity ---

describe("Prompt identity check", () => {
  test("anthropic.txt contains OpenCorvus identity", () => {
    expect(PROMPT_ANTHROPIC).toContain("OpenCorvus")
  })

  test("beast.txt contains OpenCorvus identity", () => {
    expect(PROMPT_BEAST).toContain("OpenCorvus")
  })

  test("codex.txt contains OpenCorvus identity", () => {
    expect(PROMPT_CODEX_GPT).toContain("OpenCorvus")
  })

  test("gemini.txt contains OpenCorvus identity", () => {
    expect(PROMPT_GEMINI).toContain("OpenCorvus")
  })

  test("default.txt contains OpenCorvus identity", () => {
    expect(PROMPT_DEFAULT).toContain("OpenCorvus")
  })

  test("codex_header.txt (legacy) contains OpenCorvus identity", () => {
    expect(PROMPT_CODEX).toContain("OpenCorvus")
  })
})

// --- 4. Verify no prompt is accidentally a duplicate ---

describe("Prompt uniqueness", () => {
  const allProviderPrompts = [PROMPT_ANTHROPIC, PROMPT_BEAST, PROMPT_CODEX_GPT, PROMPT_GEMINI, PROMPT_DEFAULT]

  test("all provider prompts are distinct", () => {
    const unique = new Set(allProviderPrompts)
    expect(unique.size).toBe(allProviderPrompts.length)
  })

  test("provider prompts differ from legacy codex_header", () => {
    for (const p of allProviderPrompts) {
      expect(p).not.toBe(PROMPT_CODEX)
    }
  })
})
