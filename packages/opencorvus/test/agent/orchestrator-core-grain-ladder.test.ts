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
 * + missing-terminal retry placement + the absence of the prior "→ restart_from_stage"
 * reflexive escalation pattern, so future prompt edits cannot silently
 * regress the grain discipline.
 *
 * Trigger evidence: live tsk_e0033e523001flSn0onlHh4Urh — orchestrator
 * LLM hit `restart_from_stage(executor)` for a single goal's
 * missing_terminal failure (rung 2 work mis-routed to rung 4) and
 * `frontend_design` for a host-config no_live_preview rejection
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

  test("rung 2 routes missing_terminal through build retry guidance", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("rung 2 (per-goal)")
    expect(text).toContain("missing_terminal")
    expect(text).toMatch(/build\(\{ goalID, request:/)
    expect(text).toContain("concrete recovery guidance")
    expect(text).not.toContain("accept" + "_build")
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

  /**
   * Trigger evidence: live tsk_e1a4df293001G0dhTStIi2tIDF — Goal #1 had
   * already completed; Goal #2 exhausted 3 build retries; LLM
   * orchestrator escalated straight to `restart_from_stage('executor')`,
   * whose documented collateral wiped already-completed Goal #1 and
   * cancelled the task. Per CLAUDE.md rule 6.1 the fix is the prompt:
   * goal-level failure (single goalID with retries exhausted) is rung
   * 1-3 territory; rung 4 is for task-wide / stage-wide failure modes
   * only. Pin the new copy so future edits cannot silently regress.
   */
  test("rung 4 collateral explicitly includes ALREADY-completed siblings", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(
      /INCLUDING ALREADY-completed sibling goals in the same task/,
    )
  })

  test("goal-level failure is pinned to rung 1-3, never rung 4", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("Goal-level failure is rung 1-3 territory, never rung 4")
    // Pin the load-bearing distinction between goal-level and stage-level
    // failure so an editor cannot soften it into "prefer fine-grained tools".
    expect(text).toMatch(/goal-level\*\*\s+failure, not a stage-level failure/)
    expect(text).toMatch(
      /executor stage spans every goal in the\s+task/,
    )
    expect(text).toMatch(
      /collateral wipes ALREADY-completed siblings/,
    )
    // The legal-moves enumeration must name the rung 1-3 tools by their
    // prompt-canonical spellings so the LLM sees concrete alternatives.
    expect(text).toMatch(/build\(\{ goalID: N, request:/)
    expect(text).toMatch(/modify_goal\(\{ goalID: N/)
    expect(text).toContain("`architect` re-entry")
    expect(text).toContain("`fail_task`")
  })

  test("restart_from_stage is reserved for task-wide failure modes", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(
      /`restart_from_stage` is reserved for \*\*task-wide\*\* failure modes/,
    )
    // "Goal #N exhausted its retries" must be named as NOT one of those,
    // because that is the exact misuse the live task hit.
    expect(text).toMatch(
      /"Goal #N\s+exhausted its retries" is not one of those/,
    )
  })

  test("rung 8 prefers architect re-entry over restart_from_stage", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(
      /re-enter\s+`architect`\s+with\s+the\s+rejection\s+feedback\s+as\s+evidence\s+first/,
    )
    expect(text).toMatch(/only after architect\s+re-entry produced no convergence/)
  })

  test("tools list does not advertise removed terminal-acceptance path", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("**modify_goal**")
    expect(text).not.toContain("**accept" + "_build**")
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

/**
 * 2026-05-20 (user directive): the system delivers a project through its
 * specialist agent team via the workflow pipeline. The orchestrator was
 * shortcutting `kind=workflow` tasks straight to `build({ request })`,
 * skipping requirements/architect (no goal graph, no contracts, nothing
 * for integrity to gate). Direct build is reserved for kind=build and
 * post-review scoped fixes only. Prompt-only fix (rule 6.1); pin the
 * load-bearing copy + the absence of the prior permissive phrasing so a
 * future edit cannot silently re-open the bypass.
 */
describe("orchestrator-core workflow-bypass prohibition", () => {
  test("states the agent-team delivery principle", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("The system delivers a project through its specialist agent team")
    expect(text).toContain("the team IS the\ndelivery mechanism")
  })

  test("prohibits jumping straight to direct build on a fresh workflow task", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toContain("Bypassing the workflow is prohibited in principle")
    expect(text).toMatch(/MUST NOT jump straight to `build\(\{ request \}\)`/)
    expect(text).toContain("task simplicity is the Architect's call")
    // Concrete consequence (user 2026-05-20): a direct-build bypass task is
    // not accepted by integrity — nothing for it to gate, cannot complete.
    const norm = text.replace(/\s+/g, " ")
    expect(norm).toContain("started by a direct `build` bypass is NOT accepted by the `integrity` agent")
    expect(norm).toContain("it cannot return a pass and the task cannot complete")
  })

  test("direct build is the narrow exception: kind=build or post-review fix", async () => {
    const text = await Bun.file(promptPath).text()
    expect(text).toMatch(/Direct `build\(\{ request, directBuildIntent: "modify_files" \}\)` is the narrow\nexception/)
    expect(text).toContain("explicit `kind=build` tasks")
    expect(text).toContain("subsequent, concretely-scoped problem fix after a `build`/`integrity`")
  })

  test("does NOT advertise the prior permissive direct-build copy", async () => {
    const text = await Bun.file(promptPath).text()
    // Pre-fix copy invited direct build whenever it was "the smallest
    // responsible path" for a workflow task — the exact bypass loophole.
    expect(text).not.toContain("workflow tasks where a direct\ntask-level edit is the smallest responsible path")
    expect(text).not.toContain("Direct build is supported:")
  })
})
