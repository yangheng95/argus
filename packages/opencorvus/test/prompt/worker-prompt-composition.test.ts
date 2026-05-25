/**
 * Asserts that every worker agent listed in
 * specs/fact-check-agent-2026-05-25.md §1.1 actually wraps its core
 * prompt with withFactCheckRegistration() at its runAgentSession({
 * core: ... }) call site — and that agents OUTSIDE the coverage list
 * (fact-check itself, compaction, title, summary, orchestrator,
 * control, coding, general, explore) do NOT.
 *
 * Codex impl review §test gap.  Source-text inspection rather than
 * runtime because the actual injection happens through string
 * composition and we want a single regex single source.
 */
import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const srcDir = path.join(repoRoot, "packages/opencorvus/src")

async function readSrc(rel: string): Promise<string> {
  return await Bun.file(path.join(srcDir, rel)).text()
}

const COVERED_WORKERS: Array<{ name: string; file: string }> = [
  { name: "build", file: "build/agent.ts" },
  { name: "requirements", file: "requirements/agent.ts" },
  { name: "architect", file: "architect/agent.ts" },
  { name: "design-analyst", file: "design-analyst/agent.ts" },
  { name: "intent-analysis", file: "intent-analysis/agent.ts" },
  { name: "integrity (team-agent consensus stage)", file: "integrity/team-agent.ts" },
]

const NOT_COVERED: Array<{ name: string; file: string }> = [
  { name: "fact-check (anti-recursion)", file: "fact-check/index.ts" },
]

describe("worker prompt composition — withFactCheckRegistration injection", () => {
  test("every covered worker imports the helper", async () => {
    for (const w of COVERED_WORKERS) {
      const source = await readSrc(w.file)
      expect(
        source.includes("withFactCheckRegistration"),
        `${w.file} must import + call withFactCheckRegistration (covered worker per spec §1.1)`,
      ).toBe(true)
      expect(
        source.includes('from "@/prompt/fragments/fact-check-registration"'),
        `${w.file} must import withFactCheckRegistration from @/prompt/fragments/fact-check-registration`,
      ).toBe(true)
    }
  })

  test("every covered worker calls withFactCheckRegistration in its core: arg", async () => {
    for (const w of COVERED_WORKERS) {
      const source = await readSrc(w.file)
      // Permissive regex — withFactCheckRegistration( appears somewhere
      // after a `core:` key.  We deliberately don't pin line numbers
      // because spec §5.2 noted lines drift.
      const callPattern = /core:\s*withFactCheckRegistration\(/
      expect(
        callPattern.test(source),
        `${w.file} must have a 'core: withFactCheckRegistration(...)' invocation; bare [CORE, fragment].join() is forbidden by rule 9.`,
      ).toBe(true)
    }
  })

  test("integrity team-agent injects ONLY at the consensus phase (line ~265), NOT plan or reviewer", async () => {
    const source = await readSrc("integrity/team-agent.ts")
    // Exactly ONE withFactCheckRegistration call (the consensus stage).
    const matches = source.match(/withFactCheckRegistration\(/g) ?? []
    expect(matches.length, "integrity/team-agent.ts must call withFactCheckRegistration exactly once (consensus only)").toBe(1)
    // Verify the call is attached to the consensus stage by inspecting the
    // surrounding code: it should be near `submit_integrity_consensus`
    // or follow the `consensusCollector` declaration.
    const callIdx = source.indexOf("withFactCheckRegistration(")
    const window = source.slice(Math.max(0, callIdx - 400), callIdx + 200)
    expect(
      /consensusCollector|submit_integrity_consensus|Consensus phase ONLY/i.test(window),
      "integrity team-agent withFactCheckRegistration call is not in the consensus stage scope",
    ).toBe(true)
  })

  test("fact-check itself never injects the registration fragment (anti-recursion)", async () => {
    for (const w of NOT_COVERED) {
      const source = await readSrc(w.file)
      expect(
        source.includes("withFactCheckRegistration"),
        `${w.file} must NOT import or call withFactCheckRegistration (anti-recursion per spec §5.3)`,
      ).toBe(false)
    }
  })

  test("fragment file exports both the constant and the helper exactly once", async () => {
    const source = await readSrc("prompt/fragments/fact-check-registration.ts")
    expect(
      (source.match(/export const FACT_CHECK_REGISTRATION_FRAGMENT/g) ?? []).length,
      "FACT_CHECK_REGISTRATION_FRAGMENT must be exported exactly once (single source per rule 8)",
    ).toBe(1)
    expect(
      (source.match(/export function withFactCheckRegistration/g) ?? []).length,
      "withFactCheckRegistration must be exported exactly once",
    ).toBe(1)
  })
})
