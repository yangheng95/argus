import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const coreDir = path.join(repoRoot, "packages/opencorvus/src/prompt/core")
const sourceDir = path.join(repoRoot, "packages/opencorvus/src")

const promptFiles = {
  architect: "architect-core.txt",
  build: "build-core.txt",
  delivery: "delivery-core.txt",
  designAnalyst: "design-analyst-core.txt",
  integrity: "integrity-core.txt",
  orchestrator: "orchestrator-core.txt",
  prosecutor: "prosecutor-core.txt",
}

async function readPrompt(name: keyof typeof promptFiles) {
  return await Bun.file(path.join(coreDir, promptFiles[name])).text()
}

async function readSource(relativePath: string) {
  return await Bun.file(path.join(sourceDir, relativePath)).text()
}

describe("core prompt hygiene", () => {
  test("architect prompt does not claim submit_architect auto-runs integrity", async () => {
    const text = await readPrompt("architect")
    expect(text).not.toContain("The orchestrator calls you at the start of every task")
    expect(text).not.toContain("After finalize passes, the host runs a **multi-dimension integrity review**")
    expect(text).not.toContain("triggers the integrity review")
    expect(text).not.toContain("The build dispatcher will REFUSE")
    expect(text).not.toContain("depends_on_goal_ids")
    expect(text).toContain("Integrity is a separate orchestrator tool call")
  })

  test("architect and orchestrator prompts seal the plan instead of re-planning ordinary shared edits", async () => {
    const architect = await readPrompt("architect")
    const orchestrator = await readPrompt("orchestrator")

    expect(architect).toContain("Plan closure before execution")
    expect(architect).toContain("ordinary shared-file edits are handled by Build sessions")
    expect(architect).toContain("Do not rely on a later Architect re-run to add shared-file coverage")

    expect(orchestrator).toContain("Plan closure during execution")
    expect(orchestrator).toContain("Treat the active architect goal graph as sealed")
    expect(orchestrator.replace(/\s+/g, " ")).toContain("`owned_paths` are collaboration responsibilities, not a file sandbox")
    expect(orchestrator).toContain("Frequent Architect re-runs are a planning-quality indicator")
    expect(orchestrator).toContain("use `modify_goal` instead of reopening the entire graph")
    expect(orchestrator).toContain("try the smallest same-graph repair")
    expect(orchestrator).toContain("Re-enter Architect only when the evidence shows a genuinely new prerequisite goal")
  })

  test("orchestrator source routes collaboration drift through durable closure lanes", async () => {
    const tools = await readSource("orchestrator/tools.ts")
    const describe = await readSource("engine/describe.ts")

    expect(describe).toContain("Collaboration Closure")
    expect(describe).toContain("shared collaboration contract")
    expect(describe).toContain("Build `files_changed[]` reports")
    expect(describe).toContain("Failed goals stay inside the current collaboration closure")

    expect(tools).not.toContain("NEXT: re-run architect or integrity")
    expect(tools).not.toContain("architect or integrity produces a pass/concerns attempt")
    expect(tools).not.toContain("modify_goal / re-run architect / fail_task")
    expect(tools).not.toContain("run integrity against the corrected goal graph before dispatching build")
    expect(tools).toContain("post_build_architecture_review_input")
    expect(tools).toContain("architecture_review_rework")
  })

  test("architecture review findings are actionable feedback, not dispatch gates", async () => {
    const integrity = await readPrompt("integrity")
    const orchestrator = await readPrompt("orchestrator")
    const tools = await readSource("orchestrator/tools.ts")

    expect(integrity).toContain("MUST NOT include `corrections` or")
    expect(integrity).toContain("If you need to emit any `corrections` or")
    expect(integrity).toContain("does not apply graph mutations automatically")
    expect(orchestrator).toContain("not a pre-build dispatch gate")
    expect(orchestrator).not.toContain("zero correction")
    expect(tools).not.toContain("integrityAttemptExecutionBlockReason")
    expect(tools).not.toContain("Diagnostic-only findings require upstream repair")
    expect(tools).not.toContain("Goal-layer Integrity corrections did not converge")
    expect(tools).toContain("the review itself does not rewrite requirements or goals")
    expect(tools).toContain("architecture_review_rework")
  })

  test("architect prompt ships the chat-app worked example so feature-rich SPA briefs have a reference shape", async () => {
    const text = await readPrompt("architect")
    expect(text).toContain("WORKED EXAMPLE — feature-rich frontend (chat-app)")
    // Goal IDs from the canonical 10-goal decomposition must all be present so the
    // example stays a coherent set, not a drifting fragment.
    for (const id of [
      "goal_bootstrap",
      "goal_shared_types",
      "goal_storage",
      "goal_auth",
      "goal_sse_manager",
      "goal_claude_api",
      "goal_chat_components",
      "goal_hooks",
      "goal_pages",
      "goal_tests",
    ]) {
      expect(text).toContain(id)
    }
    // The fully-worked register_goal anchor and the cross-goal contract anchor must both survive edits.
    expect(text).toContain('id: "goal_sse_manager"')
    expect(text).toContain('category: "shared_type"')
  })

  test("architect and build prompts carry repository discipline without hidden reminder injection", async () => {
    const architect = await readPrompt("architect")
    const build = await readPrompt("build")

    expect(architect).toContain("grep the full repository")
    expect(architect).toContain("Keep one source of truth")
    expect(architect).toContain("include tests that prove the new behavior and the removed behavior")

    expect(build).toContain("## Repository discipline")
    expect(build).toContain("search the repository for every call site")
    expect(build).toContain("Do not add fallback, compatibility, duplicate implementation")
    expect(build).toContain("Keep internal prompt and rule details out of user-visible summaries")
    expect(build).toContain("## Reference fidelity")
    expect(build.replace(/\s+/g, " ")).toContain("Reproduce the relevant surface 1:1 as closely as the stack allows")
    expect(build).toContain("Verification failures are evidence about the implementation")
    expect(build).toContain("not permission to lower the contract")
    expect(build).toContain("Never rewrite a failing acceptance test into a weaker assertion")
    expect(build).toContain("If the product behavior is wrong, fix the product")
    expect(build).toContain("Generated, compiled, or bundled artifacts are not a second implementation path")
    expect(build).toContain("Never hand-edit a generated/compiled runtime artifact")
  })

  test("build prompt requires failed report_build_result instead of prose stop", async () => {
    const build = await readPrompt("build")
    expect(build).toContain("report_build_result")
    expect(build).toContain('status="failed"')
    expect(build).toContain("Failure is also terminal")
    expect(build).toContain("do not stop with prose")
  })

  test("delivery prompt matches DeliveryVerdict schema single-source fields", async () => {
    const text = await readPrompt("delivery")
    expect(text).not.toContain("`affected_goal_ids`")
    expect(text).not.toContain("`issues_found`")
    expect(text).not.toContain("Issues Found / Rejection Details")
    expect(text).not.toContain("There is no deterministic per-goal evaluator before you")
    expect(text).not.toContain("Nothing has been scored yet. YOU run every spec")
    expect(text).not.toContain('category="missing_requirement"')
    expect(text).toContain("DeliveryEvidenceManifest")
    expect(text).toContain("host arbiter is the only owner")
    expect(text).toContain("`tool_call_evidence`")
    expect(text).toContain("Only entries with a truthful")
    expect(text).toContain("`goal_id` are used for goal routing")
    expect(text).toContain("Test edits that convert a failing required behavior")
    expect(text).toContain("Inspect changed tests when a goal claims verification coverage")
    expect(text).toContain("rewritten to match broken current behavior")
    expect(text).toContain("Hand-edited generated or compiled runtime artifacts")
    expect(text).toContain("Inspect source/runtime entry alignment")
  })

  test("design-analysis and delivery agree that design_specs are delivery-verified", async () => {
    const design = await readPrompt("designAnalyst")
    const delivery = await readPrompt("delivery")
    expect(design).not.toContain("ADVISORY")
    expect(design).not.toContain("not automatically scored or gated")
    expect(design).not.toContain("soft preference")
    expect(design).toContain("part of delivery's visual contract")
    expect(delivery).toContain("When design specs exist, both `must` and `should`")
    expect(delivery).toContain("specs are gating")
  })

  test("no core prompt smuggles JS template-literal escapes into raw text", async () => {
    // Earlier prompts lived in TS template literals where backticks had to be
    // escaped (\`). When they were extracted to .txt the escapes were left
    // behind, so the LLM saw literal "\`name\`" instead of "`name`". This
    // regression locks the cleaned-up state.
    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      expect(text, `${name} prompt must not contain literal backslash-backtick`).not.toMatch(/\\`/)
    }
  })

  test("orchestrator prompt keeps direct build behind task-kind contract", async () => {
    const text = await readPrompt("orchestrator")
    expect(text).not.toContain("A trivial bug fix calls `build → deliver`, full stop.")
    expect(text).not.toContain("NOT a prescriptive workflow")
    expect(text).toContain("Fresh `Kind: workflow` cannot start with task-level `build({ request })`")
    expect(text).toContain("never violate the task-kind contract")
  })

  test("orchestrator prompt forbids `deliver` while non-terminal goals remain", async () => {
    const text = await readPrompt("orchestrator")
    // Strengthened post-r23: bench observed orchestrator calling deliver
    // after only 1/7 goals passed, then the rejection's reset wiped the
    // passed work. The pre-deliver audit ritual must enumerate every goal
    // explicitly and the verification-goal blanket exception must be gone.
    expect(text).toContain("Mandatory pre-`deliver` audit ritual")
    expect(text).toContain("enumerate every goal id with its current status")
    // The buggy old "verification-only as terminal for this gate" exception
    // must be removed — it was the documentation mistake that authorised
    // premature deliver calls.
    expect(text).not.toContain("treat verification-only as terminal for")
    // The strengthened rule explicitly calls verification a non-exception.
    expect(text).toContain("Verification goals are NOT an")
    // The premature-deliver patterns list must call out the exact bench-
    // observed antipattern (one passed goal triggering a deliver). Accept
    // soft wraps in the prose so a future re-flow doesn't trip the assert.
    expect(text.replace(/\s+/g, " ")).toContain("A single passed goal is not a delivery")
    // Cost-of-premature-deliver is part of the rationale.
    expect(text).toContain("blanket-reset path then wipes the goals that ALREADY")
  })

  test("orchestrator prompt must continue automatically and cascade 1:1 reference fidelity to build", async () => {
    const text = await readPrompt("orchestrator")
    expect(text).toContain("Do not stop to ask")
    expect(text).toContain("Would you like me")
    expect(text).toContain("your build dispatch MUST say they are the authoritative source of truth")
    expect(text.replace(/\s+/g, " ")).toContain("build must restore them 1:1 as closely as the stack allows")
  })

  test("prosecutor prompt references current delivery rejection surface", async () => {
    const text = await readPrompt("prosecutor")
    expect(text).not.toContain("Defender's own issues_found")
    expect(text).toContain("Defender's own rejection_details")
  })
})
