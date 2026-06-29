/**
 * Quick verification that all prompt files load correctly as non-empty strings.
 *
 * Run: bun test test/prompt-loading.test.ts
 *
 * Pre-June audit W2-V37 — pre-fix imported `summary.txt`,
 * `spec-core.txt`, `plan-core.txt`, all of which were removed
 * (same plan-mode + spec-mode cleanup pattern as W2-V27/V33/V36).
 * The bare `import x from "missing.txt"` fired at module load
 * → "Cannot find module" → "Unhandled error between tests" →
 * cascaded into `test/config/agent-color.test.ts` and
 * `test/config/config.test.ts` failures (Bun's test runner
 * doesn't isolate the module-load failure to just this file).
 *
 * Trim imports to currently-bundled prompts only.
 */
import { describe, test, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

// --- Agent prompts (currently bundled) ---
import PROMPT_CODING from "../src/agent/prompt/coding.txt"
import PROMPT_EXPLORE from "../src/agent/prompt/explore.txt"
import PROMPT_GENERAL from "../src/agent/prompt/general.txt"
import PROMPT_COMPACTION from "../src/agent/prompt/compaction.txt"
import PROMPT_TITLE from "../src/agent/prompt/title.txt"
import PROMPT_JUDGE from "../src/agent/prompt/judge.txt"

// --- System prompt ---
import PROMPT_SYSTEM from "../src/session/prompt/system.txt"

describe("Prompt file loading", () => {
  const prompts: Record<string, string> = {
    system: PROMPT_SYSTEM,
    coding: PROMPT_CODING,
    explore: PROMPT_EXPLORE,
    general: PROMPT_GENERAL,
    compaction: PROMPT_COMPACTION,
    title: PROMPT_TITLE,
    judge: PROMPT_JUDGE,
  }

  for (const [name, content] of Object.entries(prompts)) {
    test(`prompt "${name}" loads as non-empty string`, () => {
      expect(typeof content).toBe("string")
      expect(content.length).toBeGreaterThan(30)
    })
  }

  test("legacy direct-assistant prompt filename has no repository references", async () => {
    const root = path.join(import.meta.dir, "..")
    const legacyName = ["build", "txt"].join(".")
    const ignored = new Set([".git", "dist", "node_modules", ".turbo", ".opencorvus"])
    const hits: string[] = []

    async function scan(dir: string) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await scan(full)
          continue
        }
        const text = await fs.readFile(full, "utf8").catch(() => "")
        if (text.includes(legacyName)) hits.push(path.relative(root, full))
      }
    }

    await scan(root)
    expect(hits).toEqual([])
  })
})
