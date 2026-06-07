/**
 * Single-source guard for the shared engineering-craft fragment.
 *
 * spec: specs/coding-agent-craft-prompt-2026-05-18.md
 *
 * The craft fragment lives in exactly ONE file
 * (prompt/core/engineering-craft.txt) and is composed only into agents that
 * actually mutate code: Build (composeBuildCore). It MUST NOT leak
 * into the read-only Integrity reviewer, MUST NOT be re-injected into the
 * interactive `coding` agent (which carries its own equivalent clauses —
 * re-injecting would be an intra-prompt double source), and the text MUST NOT
 * be duplicated into the per-role *-core.txt files (CLAUDE.md rule 8).
 *
 * Assertions target real composition points (composeBuildCore /
 * integrity agent core: line), not fragile call-site
 * greps, so a refactor cannot silently drop or leak the fragment (rule 28/36).
 */
import { describe, test, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import ENGINEERING_CRAFT from "../../src/prompt/core/engineering-craft.txt"
import BUILD_CORE from "../../src/prompt/core/build-core.txt"
import INTEGRITY_TEAM_CORE from "../../src/prompt/core/integrity-team-core.txt"
import PROMPT_CODING from "../../src/agent/prompt/coding.txt"
import { composeBuildCore } from "../../src/build/agent"

// A line unique to the craft fragment — the single-source sentinel.
const SENTINEL = "Do not guess facts you can read."
const HEADING = "## Engineering craft"

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe("engineering-craft shared fragment", () => {
  test("loads as a non-empty string with the expected anchors", () => {
    expect(typeof ENGINEERING_CRAFT).toBe("string")
    expect(ENGINEERING_CRAFT).toContain(HEADING)
    expect(ENGINEERING_CRAFT).toContain(SENTINEL)
    expect(ENGINEERING_CRAFT).toContain("Fix the cause, not the symptom")
    expect(ENGINEERING_CRAFT).toContain("Never introduce, print, log, or commit secrets")
    expect(occurrences(ENGINEERING_CRAFT, HEADING)).toBe(1)
  })

  test("is the single source: not duplicated into any per-role core", () => {
    // Each role core owns its mechanism rules only; the craft text exists
    // exactly once, in engineering-craft.txt. Inlining it elsewhere is rule 8.
    expect(BUILD_CORE).not.toContain(SENTINEL)
    expect(BUILD_CORE).not.toContain(HEADING)
    expect(INTEGRITY_TEAM_CORE).not.toContain(SENTINEL)
    expect(INTEGRITY_TEAM_CORE).not.toContain(HEADING)
  })

  test("Build composes the craft fragment exactly once (both auto modes)", () => {
    for (const autoIteration of [true, false]) {
      const core = composeBuildCore(autoIteration)
      expect(core).toContain(BUILD_CORE)
      expect(core).toContain(SENTINEL)
      expect(occurrences(core, HEADING)).toBe(1)
      // craft sits between the role core and the dynamic auto-iteration mode.
      expect(core).toContain("## Auto Iteration Mode")
    }
  })

  test("Build wires composeBuildCore into the live session core", () => {
    // Guard the single composition site so a refactor cannot bypass it.
    const buildAgentSrc = fs.readFileSync(
      path.join(import.meta.dir, "../../src/build/agent.ts"),
      "utf8",
    )
    expect(buildAgentSrc).toContain(
      'import ENGINEERING_CRAFT from "@/prompt/core/engineering-craft.txt"',
    )
    expect(buildAgentSrc).toMatch(/core:\s*withFactCheckRegistration\(composeBuildCore\(autoIteration\)\)/)
  })

  test("read-only Integrity team reviewer never carries the craft fragment", () => {
    // Integrity records feedback only and does not mutate code. Assert the
    // real composition point (agent core: line), not just the .txt — a future
    // change that pollutes integrity would edit agent.ts, not the core file.
    expect(INTEGRITY_TEAM_CORE).not.toContain(HEADING)
    const integritySrc = fs.readFileSync(
      path.join(import.meta.dir, "../../src/integrity/team-agent.ts"),
      "utf8",
    )
    expect(integritySrc).not.toContain("engineering-craft")
    expect(integritySrc).toContain("core: withFactCheckRegistration(TEAM_CORE)")
  })

  test("interactive coding agent keeps its own clauses, is not re-injected", () => {
    // coding.txt already carries equivalent craft clauses (its own single
    // source); injecting the shared fragment there would double-source it.
    expect(PROMPT_CODING).not.toContain(HEADING)
    expect(PROMPT_CODING).not.toContain(SENTINEL)
    // sanity: the equivalent clauses it owns are still present.
    expect(PROMPT_CODING).toContain("NEVER assume that a given library is available")
    expect(PROMPT_CODING).toContain("Never commit secrets or keys to the repository")
  })
})
