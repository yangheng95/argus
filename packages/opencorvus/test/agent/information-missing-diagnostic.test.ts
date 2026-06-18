import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  INFORMATION_MISSING_DIAGNOSTIC_TEXT,
  appendInformationMissingDiagnostic,
} from "../../src/prompt/information-missing"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptDir = path.join(repoRoot, "packages/opencorvus/src/prompt/core")

/**
 * INFORMATION MISSING diagnostic is a debug toggle (default OFF). When
 * the toggle is on (`debug.fail_on_information_missing` in
 * opencorvus.jsonc), the host injects the diagnostic block at runtime
 * via `appendInformationMissingDiagnostic`; when off, the block does NOT
 * appear in any prompt. The constant text + injection helper live in
 * `prompt/information-missing.ts` (single source per rule 8). The
 * `.txt` core prompts must NOT carry the diagnostic so the toggle has
 * binary semantics — runtime composition is the only path that adds
 * the block.
 *
 * Spec — 2026-05-07 INFORMATION MISSING debug toggle.
 */

const AGENT_PROMPTS = [
  "architect-core.txt",
  "build-core.txt",
  "frontend-design-core.txt",
  "frontend-research-core.txt",
  "integrity-team-core.txt",
  "intent-analysis-core.txt",
  "orchestrator-core.txt",
  "requirements-core.txt",
  "deep-research-core.txt",
  "visual-qa-core.txt",
] as const

describe("INFORMATION MISSING diagnostic — static prompts must NOT carry the section (toggle = OFF default)", () => {
  for (const filename of AGENT_PROMPTS) {
    test(`${filename} does not contain the INFORMATION MISSING diagnostic heading`, async () => {
      const text = await Bun.file(path.join(promptDir, filename)).text()
      expect(text).not.toContain("## INFORMATION MISSING diagnostic")
      expect(text).not.toContain("<INFORMATION MISSING>")
    })
  }
})

describe("INFORMATION_MISSING_DIAGNOSTIC_TEXT constant — single source for the runtime-injected block", () => {
  test("declares the section heading", () => {
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toContain("## INFORMATION MISSING diagnostic")
  })

  test("declares the XML diagnostic tags + list element template", () => {
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toContain("<INFORMATION MISSING>")
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toContain("</INFORMATION MISSING>")
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/<item>[^<]*missing field[^<]*<\/item>/)
  })

  test("inverts default behaviour — guessing is FORBIDDEN, emission is the goal", () => {
    // The load-bearing inversion: helpful extrapolation is the BUG here.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/guessing is FORBIDDEN/)
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/Helpful\s+extrapolation is the bug/)
    // Stop / no-tool-call instruction.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toContain("No tool calls")
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/Stop after the block/)
  })

  test("closes the helpful-bias loophole with explicit permission rules", () => {
    // Convention-fill is empirically the dominant cause of silent proceed
    // (kimi / general helpful-bias LLMs — verified 0 emissions in
    // benchmark project-v7ZJEI before this prompt strengthened, 2026-05-07).
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/Convention is a guess/)
    // Ad-hoc resolution must NOT mask the dispatcher drop.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/Ad-hoc resolution masks the dispatcher drop/)
    // "Run dies" rationalisation is explicitly closed.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/EMIT ANYWAY/)
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/Inferring user intent is exactly the failure/)
  })

  test("cites concrete trigger examples covering each documented dispatcher drop class", () => {
    // Bare retry signal — the dispatcher should have named the failure mode.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/no\s+`request`\s+\/\s+`reason`\s+\/\s+`feedback`/)
    // Goal contract field absent.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toContain("acceptance_specs")
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toContain("owned_paths")
    // Referenced artifact without payload.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/artifact[\s\S]*payload is absent/)
    // "Previous attempt failed" hint without concrete evidence.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/previous attempt failed[\s\S]*no concrete error/)
    // Convention-fill trigger — kimi-style helpful-bias loophole.
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/inferring from convention/)
  })

  test("declares the host's current-run failure contract", () => {
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(
      /host detects[\s\S]*<INFORMATION MISSING>[\s\S]*non-retryable AgentRunError/,
    )
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toContain("ONE emit")
    expect(INFORMATION_MISSING_DIAGNOSTIC_TEXT).toMatch(/desired outcome/)
  })
})

describe("appendInformationMissingDiagnostic — host runtime injection", () => {
  test("appends the diagnostic block separated by a blank line", () => {
    const out = appendInformationMissingDiagnostic("You are agent X.\n\n## Output\nDo Y.")
    expect(out).toContain("You are agent X.")
    expect(out).toContain("## Output")
    expect(out).toContain("Do Y.")
    expect(out).toContain("## INFORMATION MISSING diagnostic")
    // The diagnostic section is always last + separated from preceding content
    // so it survives prompt composition without merging into another section.
    expect(out.indexOf("## INFORMATION MISSING diagnostic")).toBeGreaterThan(out.indexOf("Do Y."))
    expect(out).toMatch(/Do Y\.\n\n## INFORMATION MISSING diagnostic/)
  })

  test("trims trailing whitespace on the input before appending (no triple-newlines)", () => {
    const out = appendInformationMissingDiagnostic("Body text.\n\n\n\n")
    expect(out).toMatch(/Body text\.\n\n## INFORMATION MISSING diagnostic/)
    expect(out).not.toMatch(/Body text\.\n\n\n/)
  })

  test("works on a single-line input (no preceding blank line)", () => {
    const out = appendInformationMissingDiagnostic("Single line.")
    expect(out).toMatch(/^Single line\.\n\n## INFORMATION MISSING diagnostic/)
  })

  test("output ends with the diagnostic's last sentence (block is last in the prompt)", () => {
    const out = appendInformationMissingDiagnostic("anything")
    expect(out.trimEnd().endsWith("every missing field in ONE block.")).toBe(true)
  })
})
