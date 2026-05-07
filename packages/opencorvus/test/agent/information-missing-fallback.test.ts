import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  INFORMATION_MISSING_FALLBACK_TEXT,
  appendInformationMissingFallback,
} from "../../src/prompt/information-missing"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptDir = path.join(repoRoot, "packages/opencorvus/src/prompt/core")

/**
 * INFORMATION MISSING fallback is a debug toggle (default OFF). When
 * the toggle is on (`debug.fail_on_information_missing` in
 * opencorvus.jsonc), the host injects the fallback block at runtime
 * via `appendInformationMissingFallback`; when off, the block does NOT
 * appear in any prompt. The constant text + injection helper live in
 * `prompt/information-missing.ts` (single source per rule 8). The
 * `.txt` core prompts must NOT carry the fallback so the toggle has
 * binary semantics — runtime composition is the only path that adds
 * the block.
 *
 * Spec — 2026-05-07 INFORMATION MISSING debug toggle.
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

describe("INFORMATION MISSING fallback — static prompts must NOT carry the section (toggle = OFF default)", () => {
  for (const filename of AGENT_PROMPTS) {
    test(`${filename} does not contain the INFORMATION MISSING fallback heading`, async () => {
      const text = await Bun.file(path.join(promptDir, filename)).text()
      expect(text).not.toContain("## INFORMATION MISSING fallback")
      expect(text).not.toContain("<INFORMATION MISSING>")
    })
  }
})

describe("INFORMATION_MISSING_FALLBACK_TEXT constant — single source for the runtime-injected block", () => {
  test("declares the section heading", () => {
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("## INFORMATION MISSING fallback")
  })

  test("declares the XML diagnostic tags + list element template", () => {
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("<INFORMATION MISSING>")
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("</INFORMATION MISSING>")
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toMatch(/<item>[^<]*missing field[^<]*<\/item>/)
  })

  test("forbids guessing / silent proceeding", () => {
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("Then stop")
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toMatch(/Do\s+NOT guess defaults/)
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toMatch(/do\s+NOT silently proceed/)
  })

  test("cites concrete trigger examples (retry / contract / artifact / prior failure)", () => {
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("retry without reason")
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("goal contract fields absent")
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("referenced artifact named without payload")
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("previous attempt failed")
  })

  test("declares the host's process-exit fatal-signal contract", () => {
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toMatch(
      /host detects this XML block.*IMMEDIATELY[\s\S]*exits the process/,
    )
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("fatal signal")
    expect(INFORMATION_MISSING_FALLBACK_TEXT).toContain("ONE emit")
  })
})

describe("appendInformationMissingFallback — host runtime injection", () => {
  test("appends the fallback block separated by a blank line", () => {
    const out = appendInformationMissingFallback("You are agent X.\n\n## Output\nDo Y.")
    expect(out).toContain("You are agent X.")
    expect(out).toContain("## Output")
    expect(out).toContain("Do Y.")
    expect(out).toContain("## INFORMATION MISSING fallback")
    // The fallback section is always last + separated from preceding content
    // so it survives prompt composition without merging into another section.
    expect(out.indexOf("## INFORMATION MISSING fallback")).toBeGreaterThan(out.indexOf("Do Y."))
    expect(out).toMatch(/Do Y\.\n\n## INFORMATION MISSING fallback/)
  })

  test("trims trailing whitespace on the input before appending (no triple-newlines)", () => {
    const out = appendInformationMissingFallback("Body text.\n\n\n\n")
    expect(out).toMatch(/Body text\.\n\n## INFORMATION MISSING fallback/)
    expect(out).not.toMatch(/Body text\.\n\n\n/)
  })

  test("works on a single-line input (no preceding blank line)", () => {
    const out = appendInformationMissingFallback("Single line.")
    expect(out).toMatch(/^Single line\.\n\n## INFORMATION MISSING fallback/)
  })

  test("output ends with the fallback's last sentence (block is last in the prompt)", () => {
    const out = appendInformationMissingFallback("anything")
    expect(out.trimEnd().endsWith("every missing field in ONE block.")).toBe(true)
  })
})
