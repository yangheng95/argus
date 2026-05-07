import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const promptPath = path.join(
  repoRoot,
  "packages/opencorvus/src/prompt/core/orchestrator-core.txt",
)

/**
 * Spec orchestrator-grain-discipline-2026-05-07.md §5.
 *
 * Source-text pins on orchestrator-core.txt's escalation ladder. The
 * fix is prompt-only — no host code changed. Pin the rung structure
 * + accept_build placement + the absence of the prior "→ restart_from_stage"
 * reflexive escalation pattern, so future prompt edits cannot silently
 * regress the grain discipline.
 *
 * Trigger evidence: live tsk_e0033e523001flSn0onlHh4Urh — orchestrator
 * LLM hit `restart_from_stage(executor)` for a single goal's
 * missing_terminal failure (rung 2 work mis-routed to rung 4) and
 * `design_analysis` for a host-config no_live_preview rejection
 * (rung 8's "→ restart" template fired on an infra obstacle).
 */
describe("orchestrator-core grain ladder hardening", () => {
  test("ladder uses 4 rung structure", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("rung 1 (per-attempt)")
    expect(text).toContain("rung 2 (per-goal)")
    expect(text).toContain("rung 3 (per-graph)")
    expect(text).toContain("rung 4 (per-task, destructive)")
  })

  test("rung 1 names build with retry guidance request", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(/rung 1 \(per-attempt\):\s*`build\(\{ goalID, request:/)
    expect(text).toContain("Retry Guidance From Orchestrator")
  })

  test("rung 2 names accept_build for missing_terminal failure mode", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("rung 2 (per-goal)")
    expect(text).toContain("missing_terminal")
    expect(text).toMatch(/accept_build\(\{ goalID, reason \}\)/)
  })

  test("rung 3 names architect re-entry as the per-graph escalation", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(
      /rung 3 \(per-graph\):\s*re-enter\s+`architect`\s+with\s+the\s+rejection\s+feedback/,
    )
  })

  test("rung 4 calls out collateral damage of restart_from_stage", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("rung 4 (per-task, destructive)")
    expect(text).toMatch(/wipes per-goal artifacts\s+as collateral/)
    expect(text).toMatch(/exhausting prior rungs on the same\s+failure mode/)
  })

  test("rung 8 prefers architect re-entry over restart_from_stage", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(
      /re-enter\s+`architect`\s+with\s+the\s+rejection\s+feedback\s+as\s+evidence\s+first/,
    )
    expect(text).toMatch(/only after architect\s+re-entry produced no convergence/)
  })

  test("tools list mentions accept_build alongside modify_goal", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(
      /\*\*accept_build\*\*\s+—\s+accept\s+a\s+missing-terminal\s+build's\s+worktree\s+contribution/,
    )
  })

  test("does NOT advertise restart_from_stage as the upstream-broken default", async () => {
    const text = await Bun.file(promptPath).text()
    // The prior reflexive pattern was rung 8: "Hallucination at the
    // upstream stage ... → **restart_from_stage(...)**". Pin its
    // absence so future edits don't quietly restore it.
    expect(text).not.toMatch(
      /Hallucination at the upstream stage[^.]*→\s*\*\*restart_from_stage/,
    )
  })

  test("does NOT advertise the prior single-line ladder", async () => {
    const text = await Bun.file(promptPath).text()
    // Pre-fix: the entire ladder fit on two lines as a > > > > chain.
    // The new ladder is multi-rung; pin the prior phrasing's absence so
    // an editor restoring the soft single-line form is caught.
    expect(text).not.toContain(
      "Cheaper repairs first: `modify_goal` (contract patch) > `build({ goalID })`",
    )
  })
})
