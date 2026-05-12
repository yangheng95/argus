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
  requirements: "requirements-core.txt",
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
    const integrityFlat = integrity.replace(/\s+/g, " ")

    expect(integrity).toContain("MUST NOT include `corrections` or")
    expect(integrity).toContain("If you need to emit any `corrections` or")
    expect(integrityFlat).toContain("unsupported REQ IDs")
    expect(integrityFlat).toContain("requirement_ids")
    expect(integrity).toContain("does not apply graph mutations automatically")
    expect(orchestrator.replace(/\s+/g, " ")).toContain("not a pre-build or wave-level dispatch gate")
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
    expect(text).toContain("register_type_contract({")
    expect(text).toContain('name: "ChatMessage"')
    expect(text).toContain('goal_ids: ["goal_shared_types", "goal_storage", "goal_sse_manager", "goal_claude_api", "goal_hooks", "goal_chat_components"]')
  })

  test("architect prompt and tool surface do not expose duplicate metric or challenge lanes", async () => {
    const architect = await readPrompt("architect")
    const outputTools = await readSource("architect/output-tools.ts")

    for (const deadName of [
      "register_goal_metric_spec",
      "register_global_metric_spec",
      "register_challenge_seed",
    ]) {
      expect(architect).not.toContain(deadName)
      expect(outputTools).not.toContain(deadName)
    }
    expect(outputTools).not.toContain("RECOMMENDED_GOAL_METRICS")
    expect(outputTools).not.toContain("RECOMMENDED_GLOBAL_METRICS")
    expect(architect).toContain("The verification goal's `acceptance_specs` are the quality contract")
  })

  test("architect prompt pins reference-driven final judge to the single global test goal", async () => {
    const architect = await readPrompt("architect")

    expect(architect).toContain("A materialized PRD/SPEC handoff is itself an authoritative reference surface")
    expect(architect).toContain("Put this spec on the final `goal_tests` / `goal_e2e` verification goal")
    expect(architect).toContain("putting that spec on a feature goal will not satisfy `submit_architect`")
    expect(architect).toContain("Do not create two global test goals")
    expect(architect).toContain("do not create both `goal_unit_tests` and `goal_tests`")
    expect(architect).toContain("Single global test goal check")
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
    expect(build).toContain("Write commands for the actual shell and platform")
    expect(build).toContain("may be named `bash` for historical reasons")
    expect(build).toContain("not necessarily POSIX bash")
    expect(build).toContain("New-Item")
    expect(build).toContain("mkdir -p")
    expect(build).toContain("PowerShell-native commands")
    expect(build).toContain("unverified Unix-only helpers")
  })

  test("architect and build prompts require explicit browser dev scripts for delivery preview", async () => {
    const architect = await readPrompt("architect")
    const build = await readPrompt("build")

    expect(architect).toContain("For any browser/UI/webpage deliverable")
    expect(architect).toContain("explicit `packageManager` and `scripts.dev`")
    expect(architect).toContain("managed preview session")

    expect(build).toContain("Never deliver a browser/UI/webpage project without")
    expect(build).toContain("declares both `packageManager` and `scripts.dev`")
    expect(build).toContain("serve the real page over loopback HTTP from the repository root")
  })

  test("build prompt bans inline base64 in emitted code and routes assets through references/", async () => {
    // Spec: delivery-attachment-store-single-source-2026-05-11.md companion
    // (Session.updatePart `InlineBase64InPartError` host gate). The host gate
    // is rule-6.1 second branch (data integrity); this prompt clause is
    // rule-6.1 first branch — teach the LLM to never reach for inline
    // base64 when generating SVG/HTML/scripts, and to reference the staged
    // `references/<filename>` path instead. Bench evidence: build agent
    // emitted PowerShell with `<image href="data:image/png;base64,$pngBase64">`
    // and the gate rejected the part on write.
    const build = await readPrompt("build")
    // Explicit ban shape — both `data:` URL and base64 keyword present so a
    // future paraphrase can't accidentally drop one half of the regression.
    expect(build).toContain("Never inline base64-encoded binary assets")
    expect(build).toContain("data:<mime>;base64")
    expect(build).toContain("InlineBase64InPartError")
    // Positive guidance: staged path is the single source.
    expect(build).toContain("`<worktree>/references/<filename>`")
    expect(build).toContain('src="references/foo.png"')
    expect(build).toContain('href="references/foo.png"')
    // The Reference fidelity section names the staged-assets contract so the
    // ban lives next to the positive guidance (single source of truth).
    expect(build).toContain("Binary assets (images, fonts, PDFs, anything you'd otherwise base64-encode)")
  })

  test("build prompt requires failed report_build_result instead of prose stop", async () => {
    const build = await readPrompt("build")
    expect(build).toContain("report_build_result")
    expect(build).toContain('status="failed"')
    expect(build).toContain("Failure is also terminal")
    expect(build).toContain("do not stop with prose")
  })

  test("build prompt defines the explicit no-edit analysis terminal branch", async () => {
    const build = await readPrompt("build")
    expect(build).toContain("read-only exploration, investigation, or analysis")
    expect(build).toContain("skip commit / merge_back")
    expect(build).toContain("files_changed: []")
    expect(build).toContain("Do not end with prose")
  })

  test("requirements prompt keeps REQ extraction at acceptance granularity", async () => {
    const requirements = await readPrompt("requirements")

    expect(requirements).toContain("acceptance-level requirements")
    expect(requirements).toContain("Do NOT register implementation chores as standalone requirements")
    expect(requirements).toContain("Do NOT split one product capability into one REQ per button")
    expect(requirements).toContain("over-fragmenting details into dozens of REQs is also a failure")
    expect(requirements).toContain("compact capability catalog")
    expect(requirements).not.toContain("Every distinct user-facing need is one REQ-N")
    expect(requirements).not.toContain("TypeScript types for the Stock entity")
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
    expect(text).toContain("`start_frontend_preview`")
    expect(text).toContain("board `delivery.previewUrl`")
    expect(text).toContain("required runtime flow cannot be")
    expect(text).not.toContain("create follow-up tasks")
    expect(text).toContain("recommend follow-up")
    expect(text).toContain("Do not create the task yourself")
  })

  test("design-analysis and delivery agree that visual_consistency_spec is delivery-gated", async () => {
    const design = await readPrompt("designAnalyst")
    const delivery = await readPrompt("delivery")
    expect(design).not.toContain("ADVISORY")
    expect(design).not.toContain("not automatically scored or gated")
    expect(design).not.toContain("soft preference")
    expect(design).toContain("`visual_consistency_spec`: binding visual-fidelity specification")
    expect(design).not.toContain("register_color_spec")
    expect(design).not.toContain("register_layout_spec")
    expect(delivery).toContain("the design-analysis")
    expect(delivery).toContain("`visual_consistency_spec` is gating")
  })

  test("design-analysis treats raw mirror JSON as evidence, not PRD working context", async () => {
    const design = await readPrompt("designAnalyst")
    expect(design).toContain("After the compact artifacts exist, stop calling mirror acquisition tools")
    expect(design).toContain("Figma references are materialized before this agent through the connected Figma MCP server")
    expect(design).toContain("`mirror/page-ir.xml` for compact section")
    expect(design).toContain("`mirror/shared-context.md` for compact design-token")
    expect(design).toContain("Do not read `mirror/extracted-page.json` or `mirror/image-analysis.json` wholesale")
    expect(design).not.toContain("`mirror/extracted-page.json` or image/Figma analysis JSON for structure and style facts")
  })

  test("design-analysis core prompt does not repeat raw webpage mirror workflow", async () => {
    const design = await readPrompt("designAnalyst")
    expect(design).not.toContain("webpage_extract")
    expect(design).not.toContain("webpage_compile")
    expect(design).not.toContain("webpage_analyze")
    expect(design).not.toContain("Strict order")
    expect(design).not.toContain("Run those steps serially")
  })

  test("design-analysis forbids unobserved backend infrastructure in PRD/SPEC", async () => {
    const design = await readPrompt("designAnalyst")
    expect(design).toContain("default to a minimal local mock/static data contract")
    expect(design).toContain("Do not name backend infrastructure, storage, queues, caches, or realtime systems unless directly observed")
    expect(design).toContain("do not invent backend infrastructure names")
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

  test("orchestrator prompt treats direct build as supported but not always recommended", async () => {
    const text = await readPrompt("orchestrator")
    expect(text).not.toContain("A trivial bug fix calls `build → deliver`, full stop.")
    expect(text).not.toContain("NOT a prescriptive workflow")
    expect(text).not.toContain("Fresh `Kind: workflow` cannot start with task-level `build({ request })`")
    expect(text).not.toContain("never violate the task-kind contract")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain('`build({ request, directBuildIntent: "modify_files" })` is still supported')
    expect(normalized).toContain('direct `build({ request, directBuildIntent: "modify_files" })` is allowed')
    expect(normalized).toContain("Task-level inspect-only build is not a workflow path")
  })

  test("orchestrator prompt caps deliver retries and routes minor rejection fixes through build", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("Delivery has a hard prompt-level budget of TWO invocations per task")
    expect(normalized).toContain("After a second `deliver` rejection, do NOT call `deliver` a third time")
    expect(normalized).toContain("Decision priors are guidance for the LLM, not host-side gates")
    expect(normalized).toContain('70-85%: minor / localized rejection → task-level `build({ request, directBuildIntent: "modify_files" })`')
    expect(normalized).toContain("2-8%: separate follow-up scope → `propose_task`")
    expect(normalized).toContain("0-5%: no path to improve current task after the second deliver → `fail_task`")
    expect(normalized).toContain('Minor / localized delivery issues → call `build({ request, directBuildIntent: "modify_files" })`')
    expect(normalized).toContain("Do not re-run requirements, architect, design_analysis, or the whole workflow for these issues")
    expect(normalized).toContain("Re-enter **architect** only when the rejection proves a genuinely new prerequisite goal")
  })

  test("orchestrator prompt routes follow-up task creation through confirmed proposals", async () => {
    const text = await readPrompt("orchestrator")
    expect(text).toContain("propose_task")
    expect(text).toContain("Orchestrator is the only agent-side owner of engine task lifecycle decisions")
    expect(text).toContain("only creates the new task when the user")
    expect(text).toContain("Base-rate prior: this is a low-frequency option, roughly 2-8%")
    expect(text).toContain("remaining work is clearly outside the current")
    expect(text).toContain("Never call generic `task` or control-plane `panel`")
  })

  test("orchestrator prompt keeps visual workflow ordering and verification-goal lifecycle coherent", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("`design_analysis` MUST be first, before `analyze_intent`")
    expect(normalized).toContain("UI replication from visual reference")
    expect(normalized).toContain("`design_analysis` (mandatory when an image or live page URL is the visual spec) → `analyze_intent`")
    expect(normalized).not.toContain("UI replication from visual reference` in `Kind: workflow` → `analyze_intent`")
    expect(normalized).not.toContain("verification` goals are integration checks; they stay pending until **deliver**")
    expect(normalized).toContain("dispatch them with `build({ goalID })` like every other goal")
    expect(normalized).toContain("Every non-delivery-only verification goal must be terminal before `deliver`")
  })

  test("integrity prompt audits original request mining, not only generated REQ rows", async () => {
    const integrity = await readPrompt("integrity")
    const orchestrator = await readPrompt("orchestrator")
    const architect = await readPrompt("architect")
    const dimensions = await readSource("integrity/dimensions.ts")
    const agent = await readSource("integrity/agent.ts")

    for (const text of [integrity, dimensions, agent]) {
      const normalized = text.replace(/\s+/g, " ")
      const lower = normalized.toLowerCase()
      expect(lower).toContain("original user request")
      expect(lower).toContain("generated req rows")
      expect(lower).toContain("evidence")
      expect(lower).toContain("audit universe")
      expect(lower).toContain("requirements extraction")
    }
    expect(integrity).toContain("If the original request implies a requirement that has no corresponding REQ-N row")
    expect(integrity).toContain("leave `requirement_ids` empty")
    expect(orchestrator).toContain("late-stage requirements-mining and system-integrity review")
    expect(orchestrator.replace(/\s+/g, " ")).toContain("after Delivery acceptance and before publish")
    expect(orchestrator).toContain("No standalone wave-level integrity loop")
    expect(architect).toContain("near task end to audit the original user request, requirements extraction, and delivered system")
    expect(architect).not.toContain("integrity reviewer before build")
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
