import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptDir = path.join(repoRoot, "packages/opencorvus/src/prompt/core")

/**
 * Every agent core prompt MUST carry the INFORMATION MISSING fallback
 * instruction so that when an upstream stage drops required context
 * (retry without reason, contract fields absent, referenced artifact
 * named without payload) the agent emits a structured XML diagnostic
 * instead of guessing.
 *
 * The fallback is a debug signal for context-drop in transit — not
 * a normal error. Pinned via source-text contains because the prompt
 * is the LLM-facing contract; runtime checks would route the signal
 * through the very layer that drops it.
 */

const AGENT_PROMPTS = [
  "architect-core.txt",
  "build-core.txt",
  "delivery-core.txt",
  "design-analyst-core.txt",
  "integrity-core.txt",
  "intent-analysis-core.txt",
  "orchestrator-core.txt",
  "prosecutor-core.txt",
  "requirements-core.txt",
] as const

describe("INFORMATION MISSING fallback in every agent prompt", () => {
  for (const filename of AGENT_PROMPTS) {
    test(`${filename} carries the INFORMATION MISSING fallback heading`, async () => {
      const text = await Bun.file(path.join(promptDir, filename)).text()
      expect(text).toContain("## INFORMATION MISSING fallback")
    })

    test(`${filename} declares the XML diagnostic tags`, async () => {
      const text = await Bun.file(path.join(promptDir, filename)).text()
      expect(text).toContain("<INFORMATION MISSING>")
      expect(text).toContain("</INFORMATION MISSING>")
      // The fallback uses <item>...</item> as the list element so the
      // host's downstream consumer can parse a uniform shape across all
      // agent reports.
      expect(text).toMatch(/<item>[^<]*missing field[^<]*<\/item>/)
    })

    test(`${filename} forbids guessing / silent proceeding`, async () => {
      const text = await Bun.file(path.join(promptDir, filename)).text()
      expect(text).toContain("Then stop")
      expect(text).toMatch(/Do\s+NOT guess defaults/)
      expect(text).toMatch(/do\s+NOT silently proceed/)
    })

    test(`${filename} cites concrete trigger examples`, async () => {
      const text = await Bun.file(path.join(promptDir, filename)).text()
      expect(text).toContain("retry without reason")
      expect(text).toContain("goal contract fields absent")
      expect(text).toContain("referenced artifact named without payload")
      expect(text).toContain("previous attempt failed")
    })
  }
})
