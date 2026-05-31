import { describe, expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const coreDir = path.join(repoRoot, "packages/opencorvus/src/prompt/core")
const sourceDir = path.join(repoRoot, "packages/opencorvus/src")

const promptFiles = {
  architect: "architect-core.txt",
  build: "build-core.txt",
  frontendDesign: "frontend-design-core.txt",
  factCheck: "fact-check-core.txt",
  integrity: "integrity-core.txt",
  integrityTeam: "integrity-team-core.txt",
  intentAnalysis: "intent-analysis-core.txt",
  goalWorkloadAnalyst: "goal-workload-analyst-core.txt",
  orchestrator: "orchestrator-core.txt",
  requirements: "requirements-core.txt",
  research: "research-core.txt",
  visualQa: "visual-qa-core.txt",
}

const sharedPromptFiles = {
  acceptanceReview: "acceptance-review-core.txt",
  engineeringCraft: "engineering-craft.txt",
  mission: "mission-core.txt",
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
    expect(files.sort()).toEqual(
      [...Object.values(promptFiles), ...Object.values(sharedPromptFiles)].sort(),
    )
  })

  test("core prompt size budgets keep roles concise", async () => {
    const maxLines: Record<keyof typeof promptFiles, number> = {
      // Raised from 150 -> 160 on 2026-05-22 to add the faithful/complete
      // decomposition principles — "smallest" governs graph shape not
      // deliverable scope, and every requirement must map to a capable goal.
      // Raised 160 -> 170 on 2026-05-31 to document research evidence
      // consumption without letting Architect treat research as routing.
      architect: 170,
      // Raised from 175 -> 195 on 2026-05-28 to document webpage replica
      // framework-first build discipline: generated View layer first,
      // functional containers/adapters second.
      build: 195,
      // Raised 125 -> 130 when frontend_design stopped emitting product/spec docs and
      // added explicit template/module/component/material fields.
      frontendDesign: 135,
      factCheck: 80,
      integrity: 175,
      // Raised from 125 -> 135 after integrity-team gained final
      // maintainable web-clone acceptance mode rules.
      integrityTeam: 135,
      intentAnalysis: 130,
      goalWorkloadAnalyst: 70,
      // Raised from 360 -> 375 on 2026-05-21 to add the orchestrator's
      // project-root git conflict ownership and toolchain readiness duties
      // without widening the narrow git-only bash surface.
      // Raised 380 -> 420 on 2026-05-22 to make same-task deadlock recovery
      // explicit: dependency, worktree merge, port, script, and toolchain
      // blockers must be routed to repair owners instead of passive waits.
      // Raised 420 -> 495 on 2026-05-26 to add the §Fact-Check Dispatch
      // section (orchestrator instructions for the new fact_check tool;
      // specs/fact-check-agent-2026-05-25.md §4.4).
      // Raised 495 -> 505 after same-task repair / workload-analysis workflow
      // guidance made the prompt's live topology explicit.
      // Raised 505 -> 525 on 2026-05-31 for research evidence boundaries
      // while preserving prompt-over-host orchestration.
      orchestrator: 525,
      // Raised from 180 -> 190 on 2026-05-29 to make Requirements record
      // explicit workflow/visual/data/verification complexity calibration
      // without turning it into goal decomposition.
      // Raised 190 -> 195 on 2026-05-31 for research evidence ID handling.
      requirements: 195,
      research: 35,
      visualQa: 45,
    }

    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      const lines = text.split(/\r?\n/).length
      expect(lines, `${name} prompt exceeds line budget`).toBeLessThanOrEqual(maxLines[name])
    }
  })

  test("shared file-mutation ownership principle appears exactly once per core prompt", async () => {
    const principle =
      "Every agent owns its file mutations: if you modify project files, commit your own changes before finishing; if your role is read-only or only emits structured records, do not claim file changes."

    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      expect(text.split(principle).length - 1, `${name} prompt`).toBe(1)
    }
  })

  test("core prompts define their real file mutation commit boundary", async () => {
    const principle =
      "Every agent owns its file mutations: if you modify project files, commit your own changes before finishing; if your role is read-only or only emits structured records, do not claim file changes."

    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      expect(text).toContain(principle)
    }
  })

  test("fact-check core anti-recursion: no <fact-check> tag literal; fact_check_items only in NOT/forbid context", async () => {
    // Anti-recursion enforcement per specs/fact-check-agent-2026-05-25.md
    // §7.1 / codex impl review §6.  The fact-check agent must never be
    // told to produce fact_check_items (its report schema has no such
    // field) or to use inline <fact-check> tags (the registration channel
    // is the upstream worker's terminal schema, not chat-text markup).
    const text = await readPrompt("factCheck")

    // (a) No <fact-check> tag literal except inside an explicit "MUST NOT"
    // / "do not use" clause.  Search for the literal and walk back to the
    // start of the sentence to inspect the modal verb.
    const tagPattern = /<fact-check[^>]*>/gi
    for (const match of text.matchAll(tagPattern)) {
      const idx = match.index ?? 0
      // Look back ~120 chars from the match position to find the modal.
      const window = text.slice(Math.max(0, idx - 120), idx)
      const isForbid = /(must not|MUST NOT|do not|DO NOT|never)/.test(window)
      expect(
        isForbid,
        `fact-check core has a <fact-check> tag at offset ${idx} outside a MUST NOT/DO NOT clause: …${window.slice(-80)}«${match[0]}»…`,
      ).toBe(true)
    }

    // (b) Every occurrence of fact_check_items must sit inside a NOT/forbid
    // window or after the explicit "Anti-Recursion" heading.  This is a
    // semantic check: the agent must never be told to produce / populate /
    // emit fact_check_items.
    const itemsPattern = /fact_check_items/g
    for (const match of text.matchAll(itemsPattern)) {
      const idx = match.index ?? 0
      const window = text.slice(Math.max(0, idx - 200), idx)
      const isForbid =
        /(must not|MUST NOT|do not|DO NOT|never|Anti-Recursion|no such field|enforced at schema level)/.test(window)
      expect(
        isForbid,
        `fact-check core mentions fact_check_items at offset ${idx} in a non-forbid context: …${window.slice(-120)}«${match[0]}»`,
      ).toBe(true)
    }
  })

  test("no core prompt routes final acceptance authority to the retired Delivery role", async () => {
    // Regression guard (rule 8 single-source): delivery is retired; integrity
    // owns final acceptance. No active agent core prompt may name Delivery as
    // the acceptance/verdict authority. Lowercase generic "deliver" verbs are
    // fine — these patterns target the retired role-as-authority constructs
    // that requirements-core used to carry.
    const forbidden = [
      /Delivery owns/,
      /Delivery reviewer/,
      /\bto Delivery\b/,
      /delivery-surface evidence/,
      /not Delivery, Build/,
      /Delivery's own/,
    ]
    for (const name of Object.keys(promptFiles) as Array<keyof typeof promptFiles>) {
      const text = await readPrompt(name)
      for (const pat of forbidden) {
        expect(
          text,
          `${name} prompt still routes acceptance authority to the retired Delivery role (${pat})`,
        ).not.toMatch(pat)
      }
    }
  })

  test("build webpage clone instructions start from frontend-design skeleton and keep web-clone-source as evidence", async () => {
    const text = await readPrompt("build")
    expect(text).toContain("the named project is not the final deliverable, but it is the required implementation starting point")
    expect(text).toContain("the root app must adopt that skeleton baseline")
    expect(text).toContain("Do not create a blank Vite/React page shell")
    expect(text).toContain("read that project's `README.md`, `index.html`, and `src/slots.json` before changing app code")
    expect(text).toContain("Do not read `public/source.html`, `src/App.jsx`, or `src/generated/*` by default")
    expect(text).toContain("React DOM injection to render the extracted source DOM/CSS baseline")
    expect(text).toContain("`web-clone-source/` at the project root remains the evidence entrypoint")
    expect(text).toContain("Do not search sibling worktrees, primary project directories, absolute paths, or `mirror/`")
    expect(text).toContain("fail through `report_build_result` with blocker `web-clone-source package was not materialized in this worktree`")
    expect(text).not.toContain("call `web_clone_prepare_context`")
    expect(text).not.toContain("`web_clone_generate_source_project`")
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
    expect(orchestratorTools).toContain("Goal builds record ")
    expect(orchestratorTools).toContain("build reports as review input")

    expect(requirementsTools).not.toContain("metric specs, challenge seeds")

    expect(workflow).not.toContain("??????")
    expect(workflow).not.toContain("goals / ?? / ???? / ??")
    expect(workflow).not.toContain("evaluator as plan/build/evaluate phases")
    expect(workflow).not.toContain("per-goal[build + architecture_review]")
    expect(workflow).not.toContain("goal build ???????? architecture_review")
    expect(workflow).toContain("integrity 做 session-bound final gate")
    expect(workflow).toContain("acceptance_specs / traceability / source-reference coverage / cross-goal contracts")
    expect(workflow).toContain("最终 gate")
  })

  test("architecture review findings are actionable feedback, not dispatch gates", async () => {
    const integrity = await readPrompt("integrity")
    const orchestrator = await readPrompt("orchestrator")
    const tools = await readSource("orchestrator/tools.ts")
    const integrityFlat = integrity.replace(/\s+/g, " ")

    expect(integrity).toContain("MUST NOT include `corrections` or")
    expect(integrityFlat).toContain("If you need to emit any `corrections`, `missing_goals`, or `graph_corrections`")
    expect(integrityFlat).toContain("the dimension verdict is `needs_correction`, not `concerns`")
    expect(integrityFlat).toContain("unsupported REQ IDs")
    expect(integrityFlat).toContain("requirement_ids")
    expect(integrityFlat).toContain("does not apply graph mutations automatically")
    expect(orchestrator.replace(/\s+/g, " ")).toContain("Integrity is the workflow acceptance gate")
    expect(orchestrator).not.toContain("zero correction")
    expect(tools).not.toContain("integrityAttemptExecutionBlockReason")
    expect(tools).not.toContain("Diagnostic-only findings require upstream repair")
    expect(tools).not.toContain("Goal-layer Integrity corrections did not converge")
    expect(tools).toContain("the review itself does not rewrite requirements or goals")
    expect(tools).toContain("architecture_review_rework")
  })

  test("orchestrator prompt scopes bash to git merge repair only and forbids replacing sub-agents", async () => {
    // The orchestrator bash tool is a narrow git-only repair surface; the
    // prompt must (a) declare the section, (b) explicitly forbid using bash
    // as a code editor / test runner / investigation surface, and (c) repeat
    // the no-chain-bash discipline so a non-zero exit cannot escalate into a
    // multi-call loop. Spec — 2026-05-20 orchestrator-bash-git-only.
    const orchestrator = await readPrompt("orchestrator")
    const flat = orchestrator.replace(/\s+/g, " ")

    expect(orchestrator).toContain("## Git Merge Repair Bash")
    expect(flat).toContain("single repair surface for a stuck merge")
    expect(flat).toContain("schema HARD-rejects anything that is not a single `git <subcommand>` invocation")
    expect(flat).toContain("Build is the only code-author path")
    expect(flat).toContain("Network git (`fetch`, `pull`, `push`, `clone`, `remote ...`)")
    expect(flat).toContain("worktrees are Build's surface")
    expect(flat).toContain("`bash` is one shot, not a debugger")

    // The MUST-NOT block calls out bash explicitly so the LLM cannot
    // claim "bash isn't listed".
    expect(flat).toContain("use `bash` for anything outside the narrow git merge-state repair scope")
    expect(flat).toContain("NOT a code editor")
    expect(flat).toContain("NOT a test runner")
    expect(flat).toContain("NOT a research tool")

    // Tool Selection entry must point back to the scoped section.
    expect(flat).toContain("`bash`: git-only merge-state repair shell")
  })

  test("orchestrator prompt owns git conflict resolution and toolchain readiness", async () => {
    // Spec — 2026-05-21 orchestrator-git-toolchain-duty.
    // This is prompt policy, not a new host state machine: the bash schema
    // remains git-only while the orchestrator must treat required tools as
    // readiness blockers instead of dispatching blindly.
    const orchestrator = await readPrompt("orchestrator")
    const flat = orchestrator.replace(/\s+/g, " ")

    expect(flat).toContain("You own project-root git conflict resolution")
    expect(flat).toContain("in-progress merge or unresolved conflict in the primary project root")
    expect(flat).toContain("clear it through the narrow `bash` git repair surface")
    expect(orchestrator).toContain("## Toolchain Readiness")
    expect(flat).toContain("bash / accepted shell")
    expect(flat).toContain("git")
    expect(flat).toContain("package manager")
    expect(flat).toContain("test runner")
    expect(flat).toContain("browser preview tool")
    expect(flat).toContain("required agent/tool surface")
    expect(flat).toContain("Do not ignore or route around missing tools")
    expect(flat).toContain("dispatch `build` to repair project scripts, dependencies, package installation metadata")
    expect(flat).toContain("dynamic port selection, or tool configuration")
    expect(flat).toContain("use `explore` for read-only toolchain diagnosis")
    expect(flat).toContain("This is the direct surface for your project-root git conflict responsibility")
    expect(flat).toContain("NEVER for code edits, tests, repository investigation, dependency changes, research, toolchain diagnosis")
  })

  test("orchestrator prompt owns same-task deadlock repair routing", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")

    expect(text).toContain("## Deadlock Repair Responsibility")
    expect(normalized).toContain("occupied dev-server port")
    expect(normalized).toContain("unfinished worktree merge")
    expect(normalized).toContain("dynamic port selection")
    expect(normalized).toContain("Do not keep retrying a verification-only goal")
    expect(normalized).toContain("Route the repair to the owner inside the current task")
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

  test("architect prompt binds contract_audit ids to registered contract ids", async () => {
    const text = await readPrompt("architect")
    expect(text).toContain(
      "contract_audit.contract_ids must be copied from already-registered contract ids returned by register_contract; unknown ids are rejected.",
    )
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

  test("architect prompt forbids simplifying away requirement scope", async () => {
    const architect = await readPrompt("architect")
    const normalized = architect.replace(/\s+/g, " ")

    // Decomposition is a faithful re-expression of the task, not a re-scoping.
    expect(normalized).toContain("Decomposition is a faithful, complete re-expression of the task")
    expect(normalized).toContain("not authorized to narrow, defer, water down, or silently drop any requirement")
    expect(normalized).toContain("Decompose humbly")

    // "smallest" / "modest" / "do not chase perfection" must be disambiguated
    // as graph shape and effort bounds — never licenses for a smaller deliverable.
    expect(normalized).toContain('"Smallest" governs graph shape')
    expect(normalized).toContain("It never licenses a smaller deliverable")
    expect(normalized).toContain('"Modest" bounds one goal')
    expect(normalized).toContain("full requirement coverage is never optional")

    // Every requirement must land on a capable owning goal.
    expect(normalized).toContain("Map every requirement to a goal that can deliver it")
    expect(normalized).toContain(
      "Every requirement (REQ-N) is claimed by at least one goal that can deliver it",
    )
    expect(normalized).toContain(
      "how the goal set covers every requirement with nothing simplified, deferred, or dropped",
    )
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
    expect(build).toContain("first `git add -A -- . ':(exclude)web-clone-source'")
    expect(build).toContain("then `git commit -m")
    expect(build).toContain("## Implementation-bound source fidelity")
    expect(build).toContain("If the request is a port, migration, rewrite, clone, parity restoration, or")
    expect(build).toContain("component translation, investigation of the named source surface")
    expect(build).toContain("context-menu/right-click")
    expect(build).toContain("does not mean sampling one file and guessing the rest")
    expect(build).toContain("Do not invent")
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

  test("build prompt does not define a repository-investigation success branch", async () => {
    const build = await readPrompt("build")
    expect(build).toContain("This path is for implementation")
    expect(build).toContain("Build is the wrong stage")
    const retiredInvestigationBranch = ["read-only", ["exploration", "investigation", "or analysis"].join(", ")].join(" ")
    const retiredNoEditBranch = ["explicit", ["no-edit", "analysis / exploration"].join(" ")].join(" ")
    expect(build).not.toContain(retiredInvestigationBranch)
    expect(build).not.toContain(retiredNoEditBranch)
    expect(build).toContain("files_changed: []")
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
    expect(requirements).toContain("user_workflows")
    expect(requirements).toContain("visual_surfaces")
    expect(requirements).toContain("interactions_and_states")
    expect(requirements).toContain("data_contracts")
    expect(requirements).toContain("verification_surfaces")
    expect(requirements).toContain("complexity_drivers")
    expect(requirements).toContain("impact_size")
    expect(requirements).toContain("Calibrate scope before finalize")
    expect(normalized).toContain("Likely affected modules/surfaces, workflows, states, data contracts, and verification surfaces needed to calibrate requirement scope")
    expect(normalized).toContain("use this to catch missing implicit REQs, not to design goals")
    expect(normalized).toContain("This calibration is not goal decomposition")
    expect(normalized.toLowerCase()).toContain("do not produce goals, owned paths, acceptance specs, dependency contracts, or implementation plans here")
    expect(normalized).toContain("Minimum: runtime + one framework + test_framework + affected_modules + affected_concepts + impact_size")
    expect(normalized).toContain("For broad UI/webpage/data-flow tasks, also record user_workflows + visual_surfaces + interactions_and_states + data_contracts + verification_surfaces + complexity_drivers")
  })

  test("frontend-design routes visual_consistency_contract to integrity acceptance review", async () => {
    const design = await readPrompt("frontendDesign")
    expect(design).not.toContain("ADVISORY")
    expect(design).not.toContain("not automatically scored or gated")
    expect(design).not.toContain("soft preference")
    expect(design).toContain("`visual_consistency_contract`: binding visual-fidelity contract")
    expect(design).not.toContain("register_color_spec")
    expect(design).not.toContain("register_layout_spec")
    const acceptanceReview = await readPrompt("integrity")
    expect(acceptanceReview).toContain("final acceptance reviewer")
  })

  test("frontend-design is scoped as frontend design and replica contract owner", async () => {
    const design = await readPrompt("frontendDesign")
    const normalized = design.replace(/\s+/g, " ")
    expect(normalized).toContain("Frontend Design & Replica Agent")
    expect(normalized).toContain("You are not a generic product manager, backend architect, or implementation coder")
    expect(normalized).toContain("frontend design/replica contract")
    expect(normalized).toContain("UI data contract only when necessary to render the frontend")
    expect(normalized).toContain("Do not design backend infrastructure")
    expect(normalized).toContain("skeleton-first source handoff")
    expect(normalized).toContain("existing project components/design-system primitives first")
    expect(normalized).toContain("mature maintained libraries second")
    expect(normalized).toContain("custom components only for truly page-specific surfaces")
  })

  test("webpage replica prompts enforce skeleton-first baseline then functional fill", async () => {
    const design = await readPrompt("frontendDesign")
    const requirements = await readPrompt("requirements")
    const architect = await readPrompt("architect")
    const build = await readPrompt("build")
    const integrity = await readPrompt("integrity")
    const integrityTeam = await readPrompt("integrityTeam")
    const orchestrator = await readPrompt("orchestrator")
    const workflow = await readSource("engine/workflow.ts")

    expect(design).toContain("`mirror/page.ir.json` for canonical DOM order")
    expect(design).toContain("`mirror/assets/manifest.json` for dense CSS")
    expect(design).toContain("`mirror/segments.json` for implementation chunks")
    expect(design).toContain("`mirror/source-ir/component-tree.json` as semantic component boundary evidence")
    expect(design).toContain("`mirror/source-ir/content-model.json` as tables/lists/cards/controls/repeated group evidence")
    expect(design).toContain("`mirror/source-skeleton/index.html` as raw semantic HTML evidence")
    expect(design).toContain("`mirror/source-skeleton/critical.css` as reachable CSS plus computed-style fallback rules")
    expect(design).toContain("`mirror/source-skeleton/full-source.css` as the complete CSS sidecar")
    expect(design).toContain("`mirror/source-skeleton/source-skeleton-audit.json` as the skeleton quality evidence")
    expect(design).toContain("`mirror/source-ir/source-quality-audit.json` as semantic IR quality evidence")
    expect(design).toContain("skeleton-first source handoff")
    expect(design).toContain("`web-clone-source/implementation-blueprint.md`")
    expect(design).toContain("uses `reference.png` as visual truth")
    expect(design).toContain("mock/static data contract")
    expect(design).toContain("full-stack replica")
    expect(design).toContain("seed/reset")
    expect(design).toContain("desktop/tablet/mobile viewport matrix")
    expect(design).toContain("source-quality review against static HTML/base64/CSS replay")
    expect(design).toContain("frontend_design/host materializes raw `mirror/` evidence into visible `web-clone-source/`")
    expect(design).toContain("host-prepared terminal-only turns")
    expect(design).toContain("Do not call unavailable discovery tools such as `read_file`, `list_files`")
    expect(design).toContain("Build must adopt the frontend-design skeleton project as the root app's starting baseline")
    expect(design).toContain("it is not a sidecar reference to ignore")
    expect(design).toContain("`final_delivery_mode`")
    expect(design).toContain("`baseline_replacement_plan`")
    expect(design).toContain("maintainable_replacement_required")
    expect(design).toContain("existing project components and mature libraries")

    expect(requirements).toContain("skeleton-first implementation constraint")
    expect(requirements).toContain("must first be adopted into the root app as a temporary visual baseline")
    expect(requirements).toContain("Do not phrase this as \"skeleton is reference only\"")
    expect(requirements).toContain("first implementation goal must copy/adapt the frontend-design skeleton entrypoints")
    expect(requirements).toContain("`final_delivery_mode`")
    expect(requirements).toContain("`baseline_replacement_plan`")
    expect(requirements).toContain("web-clone-source/implementation-blueprint.md")
    expect(requirements).toContain("source-skeleton/index.html` is raw evidence only")
    expect(requirements).toContain("functional container/API/mock workflows")
    expect(requirements).toContain("cannot be accepted as skeleton injection alone")
    expect(requirements).toContain("database schema/entities and seed/reset data")
    expect(requirements).toContain("database_contracts")
    expect(requirements).toContain("keep this decision compact")
    expect(requirements).toContain("source-ir/*")
    expect(requirements).toContain("source-skeleton/critical.css")
    expect(requirements).toContain("targeted-gap evidence only")
    expect(requirements).toContain("`mirror/` is raw frontend_design provenance")

    expect(architect).toContain("decompose by phase outcomes, not UI parts")
    expect(architect).toContain("first adopt the frontend-design skeleton/slots/CSS as the root app baseline")
    expect(architect).toContain("must not create a blank scaffold, blank route shell, placeholder-only section shell")
    expect(architect).toContain("if it says the skeleton is \"reference only\" or \"do not copy\", the graph is wrong")
    expect(architect).toContain("source-IR-derived semantic component source")
    expect(architect).toContain("Require `web-clone-source/source-skeleton/source-skeleton-audit.json` and `web-clone-source/source-ir/source-quality-audit.json`")
    expect(architect).toContain("if either audit did not pass, make that a blocking decomposition concern")
    expect(architect).toContain("then data/API/state adapters, then user workflows/interactions, then final integrated visual/runtime verification")
    expect(architect).toContain("buttons, dropdowns, cards, toolbar items, tabs, and sidebars belong inside a phase goal or contract")
    expect(architect).toContain("database/API phase before frontend binding")
    expect(architect).toContain("database entities, and seed data")
    expect(architect).toContain("Do not put API/state wiring directly into extracted static markup")
    expect(architect).toContain("project-owned semantic components/data modules/API bindings")
    expect(architect).toContain("must not treat the frontend-design skeleton alone as deliverable completion")

    expect(build).toContain("read that project's `README.md`, `index.html`, and `src/slots.json` before changing app code")
    expect(build).toContain("the named project is not the final deliverable, but it is the required implementation starting point")
    expect(build).toContain("the root app must adopt that skeleton baseline")
    expect(build).toContain("Do not create a blank Vite/React page shell")
    expect(build).toContain("Do not read `public/source.html`, `src/App.jsx`, or `src/generated/*` by default")
    expect(build).toContain("`web-clone-source/` at the project root remains the evidence entrypoint")
    expect(build).toContain("fail through `report_build_result` with blocker `web-clone-source package was not materialized in this worktree`")
    expect(build).toContain("Do not search sibling worktrees, primary project directories, absolute paths, or `mirror/`")
    expect(build).toContain("Preserve visible text, layout hierarchy")
    expect(build).toContain("Do not start over from a blank page or a freehand redesign")
    expect(build).toContain("Use `web-clone-source/assets/` by file reference")
    expect(build).toContain("Repeated rows/cards/items should become arrays and loops")
    expect(build).toContain("Verify webpage replicas against the frontend template viewport matrix")
    expect(build).toContain("source review must reject screenshot replay or hidden semantic coverage layers")
    expect(build).toContain("run `web_clone_source_audit` before reporting pass after you have replaced generated baseline regions")
    expect(build).toContain("the generated DOM/CSS baseline is temporary evidence only")
    expect(build).toContain("Do not report pass while the requested surfaces remain only React DOM injection")
    expect(build).toContain("By default it audits project-owned source against `<worktree>/web-clone-source`, not raw `mirror/`")
    expect(build).toContain("finalDeliveryMode: \"maintainable_replacement_required\"")
    expect(build).toContain("`baseline_replacement_plan` is the execution checklist")
    expect(build).toContain("no default Vite/React/Vue scaffold residue")
    expect(build).toContain("derive the database schema, seed/reset data, and read API responses")
    expect(build).toContain("database initialization/reset, API responses, and frontend rendering")

    expect(integrity).toContain("web-clone-source-skeleton-consumption-audit.json")
    expect(integrity).toContain("Visual score is")
    expect(integrity).toContain("not sufficient evidence")
    expect(integrity).toContain("database schema/seed/reset")
    expect(integrity).toContain("backend API responses")
    expect(integrityTeam).toContain("maintainable_replacement_required")
    expect(integrityTeam).toContain("component_reuse_plan")
    expect(integrityTeam).toContain("baseline_replacement_plan")
    expect(integrityTeam).toContain("hand-rolled")
    expect(orchestrator).toContain("Routine web-clone policy belongs to internal agent/tool prompts")
    expect(design).toContain("recurring webpage-clone workflow as internal policy")
    expect(requirements).toContain("Do not require the user request to restate recurring clone rules")
    expect(architect).toContain("These web-clone acceptance rules are internal architecture policy")
    expect(build).toContain("When the handoff names webpage clone artifacts")
    expect(integrity).toContain("Treat those recurring webpage-clone gates as internal acceptance policy")

    expect(workflow).toContain("web-clone-source/implementation-blueprint.md")
    expect(workflow).toContain("source-ir/component-tree.json")
    expect(workflow).toContain("source-skeleton/critical.css")
    expect(workflow).toContain("LLM 写 React/Vue")
    expect(workflow).toContain("frontend-design skeleton/slots/CSS 必须先成为实现基底")
    expect(workflow).toContain("不能被当成旁路参考后从空白页手搓")
  })

  test("frontend-design treats raw mirror JSON as evidence, not template working context", async () => {
    const design = await readPrompt("frontendDesign")
    expect(design).toContain("After the compact artifacts exist, stop calling mirror acquisition tools")
    expect(design).toContain("Figma references are materialized before this agent through the connected Figma MCP server")
    expect(design).toContain("`mirror/page.ir.json` for canonical DOM order")
    expect(design).toContain("`mirror/assets/manifest.json` for dense CSS")
    expect(design).toContain("`mirror/segments.json` for implementation chunks")
    expect(design).toContain("`mirror/source-skeleton/index.html` as raw semantic HTML evidence")
    expect(design).toContain("`mirror/shared-context.md` for compact design-token")
    expect(design).toContain("Do not read `mirror/extracted-page.json`, `mirror/capture.html`, or `mirror/image-analysis.json` wholesale")
    expect(design).not.toContain("`mirror/extracted-page.json` or image/Figma analysis JSON for structure and style facts")
  })

  test("frontend-design core prompt does not repeat raw webpage mirror workflow", async () => {
    const design = await readPrompt("frontendDesign")
    expect(design).not.toContain("webpage_extract")
    expect(design).not.toContain("webpage_compile")
    expect(design).not.toContain("webpage_analyze")
    expect(design).not.toContain("Strict order")
    expect(design).not.toContain("Run those steps serially")
  })

  test("frontend-design forbids unobserved backend infrastructure in frontend template", async () => {
    const design = await readPrompt("frontendDesign")
    expect(design).toContain("default to a minimal local mock/static data contract")
    expect(design).toContain("Do not name backend infrastructure, storage, queues, caches, or realtime systems unless directly observed")
    expect(design).toContain("do not invent backend infrastructure names")
  })

  test("visual-qa core prompt preserves full-agent visual evidence and repair loop", async () => {
    const text = await readPrompt("visualQa")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("same capability level as Build")
    expect(normalized).toContain("read, edit, write, run commands, start dev servers")
    expect(normalized).toContain("Test the real running product")
    expect(normalized).toContain("Do not rely on fixed screenshot baselines as the primary verdict")
    expect(normalized).toContain("Do not accept build-agent claims")
    expect(normalized).toContain("fresh evidence")
    expect(normalized).toContain("previous visual report")
    expect(normalized).toContain("reproduce every prior blocking finding")
    expect(normalized).toContain("accepted=true")
    expect(normalized).toContain("accepted=false")
    expect(normalized).toContain("coverage")
    expect(normalized).toContain("findings")
    expect(normalized).toContain("evidence")
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

  test("orchestrator prompt forbids workflow bypass; direct build is the narrow exception", async () => {
    // 2026-05-20 (user directive): the agent team delivers via the workflow
    // pipeline. Direct task-level build is NOT a casually-"supported" option
    // for kind=workflow — it is reserved for kind=build and post-review fixes.
    // This replaces the prior "direct build is still supported" policy copy.
    const text = await readPrompt("orchestrator")
    expect(text).not.toContain("A trivial bug fix calls `build → deliver`, full stop.")
    expect(text).not.toContain("NOT a prescriptive workflow")
    expect(text).not.toContain("never violate the task-kind contract")
    // The prior permissive copy must be gone (it was the bypass loophole).
    expect(text).not.toContain("Direct build is supported:")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).not.toContain('`build({ request, directBuildIntent: "modify_files" })` is still supported')
    expect(normalized).toContain("The system delivers a project through its specialist agent team")
    expect(normalized).toContain("Bypassing the workflow is prohibited in principle")
    expect(normalized).toContain("you MUST NOT jump straight to `build({ request })`")
    expect(normalized).toContain('Direct `build({ request, directBuildIntent: "modify_files" })` is the narrow exception')
    expect(normalized).toContain("explicit `kind=build` tasks")
    expect(normalized).toContain("Build is an implementation tool, never a repository-investigation tool")
    expect(normalized).toContain("Repository investigation belongs to `analyze_intent`, `requirements`, or the registered `explore` subagent surface")
    expect(normalized).not.toContain(["inspect", "only"].join("_"))
    expect(normalized).not.toContain("Task-level inspect-only build is not a workflow path")
  })

  test("orchestrator prompt sends multi-goal requests through workflow decomposition", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("Before first implementation dispatch, explicitly decide whether the request needs multiple goals")
    expect(normalized).toContain("implementation, acceptance, and verification goals")
    expect(normalized).toContain("Do not compress a multi-goal job into a task-level direct build")
    expect(normalized).toContain("Does the request naturally split into implementation, acceptance hardening, and verification/integration surfaces?")
  })

  test("orchestrator prompt does not rerun successful requirements before architect", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("After a successful `requirements` result, call `architect` next")
    expect(normalized).toContain("Do not call `requirements` again unless an operator message changed scope")
    expect(normalized).toContain('`restart_from_stage("requirements")` was chosen')
    expect(normalized).toContain("concrete task evidence proves the active REQ snapshot is invalid")
  })

  test("orchestrator prompt routes non-pass integrity fixes through explicit repair", async () => {
    const text = await readPrompt("orchestrator")
    const source = await readSource("orchestrator/agent.ts")
    const normalized = text.replace(/\s+/g, " ")
    const sourceNormalized = source.replace(/\s+/g, " ")
    expect(normalized).toContain("Integrity is the workflow acceptance gate")
    expect(normalized).toContain("no separate final acceptance object")
    expect(normalized).toContain("The host no longer runs a host-owned final acceptance gate")
    expect(normalized).toContain("Non-pass `integrity` returns evidence for the next orchestrator decision")
    expect(normalized).toContain("After post-build non-pass integrity, do not end the wake with plain text")
    expect(normalized).toContain("do not passively report and leave the task active")
    expect(normalized).not.toContain("or report the current result when no responsible repair exists inside this task")
    expect(normalized).not.toContain("or reporting the current result")
    expect(normalized).not.toContain("report the current result")
    expect(normalized).not.toContain("report and wait")
    expect(normalized).not.toContain("report blockers and wait")
    expect(sourceNormalized).not.toContain("report the current result")
    expect(normalized).toContain("When the evidence shows no responsible repair inside this task")
    expect(normalized).toContain("the explicit action is `fail_task` with the evidence or `question`")
    expect(normalized).toContain("Valid next actions include task-level build")
    expect(normalized).toContain('Minor / localized integrity issues -> call `build({ request, directBuildIntent: "modify_files" })`')
    expect(normalized).toContain("Do not re-run requirements, architect, frontend_design, or the whole workflow for import typos")
    expect(normalized).toContain("Re-enter **architect** only when the review proves a genuinely new prerequisite goal")
    expect(normalized).toContain("Task-fidelity shortfall recovery")
    expect(normalized).toContain("First occurrence, when the missing or distorted capability is still inside the current task contract -> use the lightest valid repair")
    expect(normalized).toContain('`build({ request, directBuildIntent: "modify_files" })` with the exact fidelity delta as the request')
    expect(normalized).toContain("If the same fidelity shortfall repeats after that build retry")
    expect(normalized).toContain("use `modify_goal` or `architect` when the current task needs a corrected/new goal")
    expect(normalized).toContain("Use `propose_task` when the repeated fidelity gap has become a separate follow-up scope")
  })

  test("integrity aggregate docs do not describe the retired worst-of gate", async () => {
    const integrityPrompt = await readPrompt("integrity")
    const orchestratorTools = await readSource("orchestrator/tools.ts")
    const engineModel = await readSource("engine/model.ts")
    const text = [integrityPrompt, orchestratorTools, engineModel].join("\n").replace(/\s+/g, " ")

    expect(text).not.toContain("worst-of")
    expect(text).not.toContain("worst per-dimension")
    expect(text).not.toContain("per-dimension worst")
    expect(text).toContain("advisory-only concerns")
    expect(text).toContain("repair-bearing concerns")
  })

  test("orchestrator prompt routes follow-up task creation through proposed tasks", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(text).toContain("propose_task")
    expect(normalized).toContain("You are the only agent-side owner of engine task lifecycle decisions")
    expect(normalized).toContain("It creates according to `experimental.confirm_proposed_tasks`")
    expect(normalized).toContain("default false creates directly")
    expect(normalized).toContain("inheriting follow-up task creation")
    expect(normalized).toContain("execution evidence, artifact state, integrity history, or the obvious product path")
    expect(normalized).toContain("supplemental features, deeper implementation detail")
    expect(normalized).toContain("project improvement suggestions")
    expect(normalized).toContain("Never call generic `task` or control-plane `panel`")
  })

  test("orchestrator prompt makes post-build integrity pass the terminal lifecycle path", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("Pipeline workflow tasks complete only after the `integrity` reviewer returns a pass verdict")
    expect(normalized).toContain("The `deliver` endpoint is disabled and must not be used")
    expect(normalized).toContain("`publish_delivery` is also disabled because it depends on retired delivery verdicts")
    expect(normalized).toContain("A pass verdict completes the task")
    expect(normalized).toContain("Completed does not mean context deletion")
    expect(normalized).toContain("historical terminal review is baseline evidence")
    expect(normalized).not.toContain("Only an accepted host-arbiter verdict completes the task")
    expect(normalized).not.toContain("delivery has accepted and been published")
    expect(normalized).not.toContain("publish_delivery remains the normal terminal path")
  })

  test("orchestrator prompt keeps visual workflow ordering and verification-goal lifecycle coherent", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("`frontend_design` MUST be first, before `analyze_intent`")
    expect(normalized).toContain("UI replication from visual reference")
    expect(normalized).toContain("`frontend_design` (mandatory when an image or live page URL is the visual spec) -> `analyze_intent`")
    expect(normalized).not.toContain("UI replication from visual reference` in `Kind: workflow` → `analyze_intent`")
    expect(normalized).not.toContain("verification` goals are integration checks; they stay pending until **deliver**")
    expect(normalized).toContain("Dispatch them with `build({ goalID })` like every other goal")
    expect(normalized).toContain("every verification/integration goal still needed for evidence is terminal before `integrity`")
  })

  test("orchestrator prompt documents freshContext per-goal retry triggers and cost", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(normalized).toContain("`build({ goalID, freshContext: true, request })`")
    expect(normalized).toContain("compaction `nothing-to-compress` / `post-compaction-still-over`")
    expect(normalized).toContain("prior reasoning/tool history is gone")
    expect(normalized).toContain("`request` MUST restate concrete lessons")
    expect(normalized).toContain("No effect on task-level direct `build({ request })`")
  })

  test("integrity prompt audits original request mining, not only generated REQ rows", async () => {
    const integrity = await readPrompt("integrity")
    const integrityTeam = await Bun.file(path.join(coreDir, "integrity-team-core.txt")).text()
    const orchestrator = await readPrompt("orchestrator")
    const architect = await readPrompt("architect")
    const agent = await readSource("integrity/team-agent.ts")

    for (const text of [integrity, integrityTeam]) {
      const normalized = text.replace(/\s+/g, " ")
      const lower = normalized.toLowerCase()
      expect(lower).toContain("original user request")
      expect(lower).toContain("generated req rows")
      expect(lower).toContain("evidence")
    }
    expect(agent).toContain("renderUserRequestSection")
    expect(agent).toContain("buildIntegrityEvidencePrompt")
    expect(integrity.toLowerCase()).toContain("audit universe")
    expect(integrity.toLowerCase()).toContain("requirements extraction")
    expect(integrity).toContain("If the original request implies a requirement that has no corresponding REQ-N row")
    expect(integrity).toContain("leave `requirement_ids` empty")
    expect(orchestrator).toContain("late-stage requirements-mining and system-integrity review")
    expect(orchestrator.replace(/\s+/g, " ")).toContain("final workflow gate")
    expect(orchestrator.replace(/\s+/g, " ")).toContain("Pipeline workflow tasks complete only after the `integrity` reviewer returns a pass verdict")
    expect(architect).toContain("final workflow gate to audit the original user request, requirements extraction, and built system")
    expect(architect).not.toContain("integrity reviewer before build")
  })

  test("orchestrator prompt forbids final integrity while non-terminal goals remain", async () => {
    const text = await readPrompt("orchestrator")
    // The pre-integrity audit ritual must enumerate every goal explicitly and
    // the verification-goal blanket exception must stay gone.
    expect(text).toContain("## Pre-integrity Audit")
    expect(text).toContain("enumerate every goal id with its current status")
    // The buggy old "verification-only as terminal for this gate" exception
    // must be removed — it was the documentation mistake that authorised
    // premature deliver calls.
    expect(text).not.toContain("treat verification-only as terminal for")
    // The strengthened rule explicitly calls verification a non-exception.
    expect(text).toContain("Verification goals are NOT an")
    expect(text.replace(/\s+/g, " ")).toContain("A single passed goal is not task acceptance")
    expect(text).toContain("The `deliver` endpoint is disabled and must not be used")
  })

  test("orchestrator prompt keeps pre-delivery work moving and cascades 1:1 reference fidelity to build", async () => {
    const text = await readPrompt("orchestrator")
    const normalized = text.replace(/\s+/g, " ")
    expect(text).toContain("Do not stop to ask")
    expect(text).toContain("Would you like me")
    expect(normalized).toContain("your build dispatch MUST say they are the authoritative source of truth")
    expect(normalized).toContain("build must restore them 1:1 as closely as the stack allows")
  })

})
