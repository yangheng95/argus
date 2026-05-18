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
  intentAnalysis: "intent-analysis-core.txt",
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
  test("core prompt file inventory is fully covered by hygiene tests", async () => {
    const files = await Array.fromAsync(new Bun.Glob("*.txt").scan({ cwd: coreDir }))
    expect(files.sort()).toEqual(Object.values(promptFiles).sort())
  })

  test("core prompt size budgets keep roles concise", async () => {
    const maxLines: Record<keyof typeof promptFiles, number> = {
      architect: 150,
      build: 175,
      delivery: 320,
      designAnalyst: 125,
      integrity: 175,
      intentAnalysis: 130,
      orchestrator: 260,
      prosecutor: 80,
      requirements: 180,
    }

    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      const lines = text.split(/\r?\n/).length
      expect(lines, `${name} prompt exceeds line budget`).toBeLessThanOrEqual(maxLines[name])
    }
  })

  test("shared file-mutation ownership principle appears exactly once per non-delivery core prompt", async () => {
    const principle =
      "Every agent owns its file mutations: if you modify project files, commit your own changes before finishing; if your role is read-only or only emits structured records, do not claim file changes."

    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      const expected = name === "delivery" ? 0 : 1
      expect(text.split(principle).length - 1, `${name} prompt`).toBe(expected)
    }
  })

  test("core prompts define their real file mutation commit boundary", async () => {
    const principle =
      "Every agent owns its file mutations: if you modify project files, commit your own changes before finishing; if your role is read-only or only emits structured records, do not claim file changes."

    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      if (name === "delivery") {
        expect(text).toContain("Delivery does not run git commits itself")
        expect(text).toContain("host deliver round commit")
        expect(text).toContain("Do not call git")
      } else {
        expect(text).toContain(principle)
      }
    }
  })

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
    const orchestratorFlat = orchestrator.replace(/\s+/g, " ")

    expect(architect).toContain("Produce the smallest executable goal graph")
    expect(architect).toContain("do not chase perfection in Architect")

    expect(orchestrator).toContain("Plan closure during execution")
    expect(orchestratorFlat).toContain("Treat the active architect goal graph as sealed")
    expect(orchestratorFlat).toContain("`owned_paths` are collaboration responsibilities, not a file sandbox")
    expect(orchestrator).toContain("Frequent Architect re-runs are a planning-quality indicator")
    expect(orchestratorFlat).toContain("Use `modify_goal` instead of reopening the entire graph")
    expect(orchestratorFlat).toContain("try the smallest same-graph repair")
    expect(orchestratorFlat).toContain("Re-enter Architect only when the evidence shows a genuinely new prerequisite goal")
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

  test("runtime workflow guidance matches the live agent topology", async () => {
    const orchestratorAgent = await readSource("orchestrator/agent.ts")
    const orchestratorTools = await readSource("orchestrator/tools.ts")
    const requirementsTools = await readSource("requirements/output-tools.ts")
    const workflow = await readSource("engine/workflow.ts")
    const orchestratorAgentFlat = orchestratorAgent.replace(/\s*\*\s*/g, " ").replace(/\s+/g, " ")

    expect(orchestratorAgent).not.toContain("requirements → goals → plan → execute → eval → delivery verify → publish")
    expect(orchestratorAgent).not.toContain("plan, eval, delivery")
    expect(orchestratorAgentFlat).toContain("MiniWorkflow renders an advisory path")
    expect(orchestratorAgentFlat).toContain("Specialist agents own their structured artifacts")

    expect(orchestratorTools).not.toContain("Goal decomposition / metric specs /")
    expect(orchestratorTools).not.toContain("metric specs, challenge seeds")
    expect(orchestratorTools).not.toContain("Each goal build automatically records its build report and runs")
    expect(orchestratorTools).not.toContain("Build already invokes the post-build review")
    expect(orchestratorTools).toContain("acceptance_specs, traceability, source/reference coverage, and cross-goal")
    expect(orchestratorTools).toContain("Goal builds record build reports as review input")

    expect(requirementsTools).not.toContain("metric specs, challenge seeds")
    expect(requirementsTools).toContain("Challenge metrics are produced by prosecutor/metrics")

    expect(workflow).not.toContain("停止默认调度")
    expect(workflow).not.toContain("goals / 度量 / 挑战种子 / 契约")
    expect(workflow).not.toContain("evaluator as plan/build/evaluate phases")
    expect(workflow).not.toContain("per-goal[build + architecture_review]")
    expect(workflow).not.toContain("goal build 完成后自动跑一次 architecture_review")
    expect(workflow).toContain("deliver rejected 返回结构化证据，下一步仍由 Orchestrator 基于证据决定")
    expect(workflow).toContain("acceptance_specs / traceability / source-reference coverage / cross-goal contracts")
    expect(workflow).toContain("build 报告会作为 review input 被记录，但不会自动触发 architecture_review")
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

  test("architect prompt documents graph contracts as the only cross-goal handoff shape", async () => {
    const text = await readPrompt("architect")
    expect(text).toContain("Multi-goal decomposition should register graph contracts for known handoffs")
    expect(text).toContain("must not trap Architect in a retry loop")
    expect(text).toContain("Cross-goal handoffs are represented by graph contracts")
    expect(text).toContain("register_contract({")
    expect(text).toContain("producer_goal_id")
    expect(text).toContain("consumer_goal_ids")
    expect(text).toContain("register_dependency_contract({")
    expect(text).toContain('reason: "contract" | "bootstrap_scaffold" | "integration_order"')
    expect(text).toContain("Use `contract_audit` only with")
  })

  test("architect prompt pins acceptance scorer discriminator values", async () => {
    const text = await readPrompt("architect")
    expect(text).toContain('Scorer `type` is exactly one of `"heuristic"`, `"llm_judge"`, `"prebuilt"`, or `"contract_audit"`')
    expect(text).toContain('Do not use `type: "shell"` or `type: "script_ref"`')
    expect(text).toContain('"type": "heuristic"')
    expect(text).toContain('"kind": "shell"')
    expect(text).toContain('"kind": "script_ref"')
  })

  test("architect prompt requires cautious multi-goal decomposition analysis", async () => {
    const text = await readPrompt("architect")
    const normalized = text.replace(/\s+/g, " ")

    expect(normalized).toContain("Before registering goals, analyze the requirement surfaces")
    expect(normalized).toContain("Register at least two goals")
    expect(normalized).toContain("A single all-in-one goal is forbidden")
    expect(normalized).toContain("Keep every goal modest and independently executable")
    expect(normalized).toContain("Call `submit_architect({ summary, decomposition_analysis })`")
    expect(normalized).toContain("why no goal is too large")
    expect(normalized).toContain("At least two goals exist")
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

  test("architect prompt keeps reference fidelity as downstream concern, not submit gate", async () => {
    const architect = await readPrompt("architect")

    expect(architect).toContain("prefer one final verification/integration goal")
    expect(architect).toContain("submit the executable graph and leave the fidelity gap as a concern")
    expect(architect).not.toContain("will not satisfy `submit_architect`")
    expect(architect).not.toContain("Do not create two global test goals")
  })

  test("architect and build prompts carry repository discipline without hidden reminder injection", async () => {
    const architect = await readPrompt("architect")
    const build = await readPrompt("build")

    expect(architect).toContain("Produce the smallest executable goal graph")
    expect(architect).toContain("Do not design fallback, compatibility, parallel implementations")

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
    expect(build).toContain("Commit your work to the worktree branch when you changed project files")
    expect(build).toContain("first `git add -A`, then `git commit -m")
  })

  test("build prompt requires explicit browser dev scripts for delivery preview", async () => {
    const architect = await readPrompt("architect")
    const build = await readPrompt("build")

    expect(architect).not.toContain("For any browser/UI/webpage deliverable")
    expect(architect).not.toContain("explicit `packageManager` and `scripts.dev`")
    expect(architect).not.toContain("managed preview session")

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

  test("requirements prompt calibrates scope without becoming architect decomposition", async () => {
    const requirements = await readPrompt("requirements")
    const normalized = requirements.replace(/\s+/g, " ")

    expect(requirements).toContain("calibrate scope")
    expect(requirements).toContain("affected_modules")
    expect(requirements).toContain("affected_concepts")
    expect(requirements).toContain("impact_size")
    expect(requirements).toContain("Calibrate scope before finalize")
    expect(normalized).toContain("Likely affected modules/surfaces and concepts needed to calibrate requirement scope")
    expect(normalized).toContain("use this to catch missing implicit REQs, not to design goals")
    expect(normalized).toContain("This calibration is not goal decomposition")
    expect(normalized.toLowerCase()).toContain("do not produce goals, owned paths, acceptance specs, dependency contracts, or implementation plans here")
    expect(normalized).toContain("Minimum: runtime + one framework + test_framework + affected_modules + affected_concepts + impact_size")
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
    expect(text).toContain("run_integrity_review")
    expect(text).toContain("suspicion-triggered semantic integrity review")
    expect(text.replace(/\s+/g, " ")).toContain("not a routine internal Delivery gate")
    expect(text).not.toContain("create follow-up tasks")
    expect(text).toContain("recommend follow-up")
    expect(text).toContain("Do not create the task yourself")
  })

  test("delivery prompt pins lifecycle, commit, and visual evidence boundaries", async () => {
    const text = await readPrompt("delivery")
    const normalized = text.replace(/\s+/g, " ")

    expect(normalized).toContain("Delivery does not run git commits itself")
    expect(normalized).toContain("let the host deliver round commit archive those changes")
    expect(normalized).toContain("Do not call git commit from `run_command`")
    expect(normalized).toContain("Delivery does not start, stop, retry, cancel, or create engine tasks")
    expect(text).toContain("verify_page_integrity")
    expect(text).toContain("compare_visual_artifacts")
    expect(normalized).toContain("screenshot as supporting evidence")
    expect(normalized).toContain("do not treat a screenshot alone as the full visual gate")
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

  test("orchestrator prompt sends multi-goal requests through workflow decomposition", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("Before first implementation dispatch, explicitly decide whether the request needs multiple goals")
    expect(normalized).toContain("implementation, acceptance, and verification goals")
    expect(normalized).toContain("Do not compress a multi-goal job into a task-level direct build")
    expect(normalized).toContain("Does the request naturally split into implementation, acceptance hardening, and verification/integration surfaces?")
  })

  test("orchestrator prompt caps deliver retries and routes minor rejection fixes through build", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("Rejected `deliver` returns evidence for the next orchestrator decision")
    expect(normalized).toContain("not a host-side mandate to end the scheduler")
    expect(normalized).toContain("Valid next actions include task-level build")
    expect(normalized).toContain("first acceptance attempt plus at most one post-rework verification")
    expect(normalized).toContain("After the second non-accepted deliver, no priors apply; call `question` and wait for the operator")
    expect(normalized).toContain("the host will not open rework attempts or queue repair work by itself")
    expect(normalized).not.toContain("0-5%: no path to improve current task after the second deliver → `fail_task`")
    expect(normalized).toContain('Minor / localized delivery issues -> call `build({ request, directBuildIntent: "modify_files" })`')
    expect(normalized).toContain("Do not re-run requirements, architect, design_analysis, or the whole workflow for import typos")
    expect(normalized).toContain("Re-enter **architect** only when the rejection proves a genuinely new prerequisite goal")
    expect(normalized).toContain("Task-fidelity shortfall recovery")
    expect(normalized).toContain("First occurrence, when the missing or distorted capability is still inside the current task contract -> use the lightest valid repair")
    expect(normalized).toContain('`build({ request, directBuildIntent: "modify_files" })` with the exact fidelity delta as the request')
    expect(normalized).toContain("If the same fidelity shortfall repeats after that build retry")
    expect(normalized).toContain("use `modify_goal` or `architect` when the current task needs a corrected/new goal")
    expect(normalized).toContain("Use `propose_task` only when the repeated fidelity gap has become a separate follow-up scope")
  })

  test("orchestrator prompt routes follow-up task creation through confirmed proposals", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(text).toContain("propose_task")
    expect(normalized).toContain("You are the only agent-side owner of engine task lifecycle decisions")
    expect(normalized).toContain("only creates the new task when the user selects the confirmation action")
    expect(normalized).toContain("Base-rate prior: low-frequency option, roughly 2-8%")
    expect(normalized).toContain("remaining work is clearly outside the current task contract")
    expect(normalized).toContain("Never call generic `task` or control-plane `panel`")
  })

  test("orchestrator prompt makes accepted deliver the terminal lifecycle path", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("Accepted deliveries complete the task")
    expect(normalized).toContain("Accepted `deliver` already completed the task")
    expect(normalized).toContain("DeliveryAgent calls `submit_verdict` as semantic review input")
    expect(normalized).toContain("the deliver tool's host arbiter converts that evidence into the persisted delivery verdict")
    expect(normalized).toContain("Only an accepted host-arbiter verdict completes the task")
    expect(normalized).toContain("`publish_delivery` is explicit artifact export only; it does not decide lifecycle")
    expect(normalized).toContain("Completed does not mean context deletion")
    expect(normalized).toContain("the historical accepted verdict is baseline evidence, not proof that a new operator message is already handled")
    expect(normalized).not.toContain("delivery has accepted and been published")
    expect(normalized).not.toContain("publish_delivery remains the normal terminal path")
  })

  test("orchestrator prompt keeps visual workflow ordering and verification-goal lifecycle coherent", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("`design_analysis` MUST be first, before `analyze_intent`")
    expect(normalized).toContain("UI replication from visual reference")
    expect(normalized).toContain("`design_analysis` (mandatory when an image or live page URL is the visual spec) -> `analyze_intent`")
    expect(normalized).not.toContain("UI replication from visual reference` in `Kind: workflow` → `analyze_intent`")
    expect(normalized).not.toContain("verification` goals are integration checks; they stay pending until **deliver**")
    expect(normalized).toContain("Dispatch them with `build({ goalID })` like every other goal")
    expect(normalized).toContain("every non-delivery-only verification goal is terminal before `deliver`")
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
    expect(orchestrator.replace(/\s+/g, " ")).toContain("after Delivery acceptance and before follow-up/failure decisions")
    expect(orchestrator.replace(/\s+/g, " ")).toContain("No standalone wave-level integrity loop")
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

  test("orchestrator prompt keeps pre-delivery work moving and cascades 1:1 reference fidelity to build", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(text).toContain("Do not stop to ask")
    expect(text).toContain("Would you like me")
    expect(normalized).toContain("your build dispatch MUST say they are the authoritative source of truth")
    expect(normalized).toContain("build must restore them 1:1 as closely as the stack allows")
  })

  test("prosecutor prompt references current delivery rejection surface", async () => {
    const text = await readPrompt("prosecutor")
    expect(text).not.toContain("Defender's own issues_found")
    expect(text).toContain("Defender's own rejection_details")
    expect(text).toContain("Use `query_diff` only when it returns a real delivery snapshot")
    expect(text).toContain("do not invent diff-grounded claims")
  })
})
