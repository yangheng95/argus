import { describe, expect, test } from "bun:test"
import { asSchema } from "ai"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { BrowserPreviewToolStaticDefinition } from "../../src/tool/browser-preview"

describe("orchestrator tool descriptions for integrity stuck loops", () => {
  const tools = createOrchestratorTools({
    taskID: "tsk_tool_description",
    agentSessionID: "ses_tool_description",
    signal: new AbortController().signal,
  }).tools as Record<
    string,
    {
      description?: string
      inputSchema?: {
        shape: Record<string, unknown>
        safeParse: (value: unknown) => { success: boolean }
      }
    }
  >

  test("fail_task describes persistent integrity roots", () => {
    expect(tools.fail_task.description).toContain("integrity history")
    expect(tools.fail_task.description).toContain("persistent blocking root")
  })

  test("propose_task describes inheriting evidence-backed follow-up work", () => {
    expect(tools.propose_task.description).toContain("concrete current-task evidence")
    expect(tools.propose_task.description).toContain("artifact state")
    expect(tools.propose_task.description).toContain("Create at most one inheriting child task")
    expect(tools.propose_task.description).toContain("active workflow contract is fundamentally wrong")
    expect(tools.propose_task.description).toContain("instead of rerunning requirements/plan/executor")
    expect(tools.propose_task.description).toContain("original user request never authorised")
  })

  test("modify_goal narrows existing contracts instead of expanding scope", () => {
    expect(tools.modify_goal.description).toContain("clarify or tighten acceptance")
    expect(tools.modify_goal.description).toContain("Scope expansion")
    expect(tools.modify_goal.description).toContain("propose_task or question")
  })

  test("add_goal owns concrete in-scope new goals without replacing re-decomposition", () => {
    expect(tools.add_goal.description).toContain("Append one new executable goal")
    expect(tools.add_goal.description).toContain("latest operator message")
    expect(tools.add_goal.description).toContain("Use this instead of `modify_goal`")
    expect(tools.add_goal.description).toContain("instead of `architect`")
    expect(tools.add_goal.description).toContain("After this returns, dispatch `build({ goalID })`")
  })

  test("build description distinguishes async goal start from direct terminal report", () => {
    expect(tools.build.description).toContain("returns after the child build session and goal_run have started")
    expect(tools.build.description).toContain("terminal refill wake")
    expect(tools.build.description).toContain(
      "For task-level direct builds, the tool returns the terminal build report",
    )
    expect(tools.build.description).not.toContain("After build returns, read the build report")
  })

  test("wait description excludes internal live build polling", () => {
    expect(tools.wait.description).toContain("Never use wait for live build completion")
    expect(tools.wait.description).toContain("terminal refill polling")
  })

  test("removed child-session steering tool is not exposed", () => {
    expect(tools[["steer", "subagent"].join("_")]).toBeUndefined()
  })

  test("expert-squad tools are scheduler-owned visible skill loading", () => {
    expect(tools.select_expert_squad.description).toContain("active expert squad prompt profile")
    expect(tools.select_expert_squad.description).toContain("root session config overlay")
    expect(tools.select_expert_squad.description).toContain("does not dispatch work")
    expect(tools.select_expert_squad.description).toContain("infer the profile from keywords")

    expect(tools.skill.description).toContain("Scheduler-only")
    expect(tools.skill.description).toContain("mounted Orchestrator expert-squad skills")
    expect(tools.skill.description).toContain("before calling select_expert_squad")
    expect(tools.skill.description).toContain("never use it to load production, research, report, or implementation skills")
  })

  test("build schema rejects misspelled goal scope instead of stripping it into direct build", () => {
    expect(Object.keys(tools.build.inputSchema!.shape)).toEqual([
      "request",
      "reason",
      "goalID",
      "directBuildIntent",
      "freshContext",
      "userConfirmedStaleIntegrityData",
    ])
    expect(
      tools.build.inputSchema!.safeParse({
        reason: "Run the scoped goal build.",
        goalID: "gol_valid_scope",
      }).success,
    ).toBe(true)
    expect(
      tools.build.inputSchema!.safeParse({
        reason: "Run the scoped goal build.",
        goal_id: "gol_typo_scope",
        request: "Implement the scoped goal.",
        directBuildIntent: "modify_files",
      }).success,
    ).toBe(false)
  })

  test("analyze_intent schema rejects unknown continuation-like fields", () => {
    expect(tools.analyze_intent.description).toContain("clarified_user_request")
    expect(tools.analyze_intent.description).toContain("Do not ask the same blocker again")
    expect(Object.keys(tools.analyze_intent.inputSchema!.shape)).toEqual(["reason"])
    expect(
      tools.analyze_intent.inputSchema!.safeParse({
        reason: "Need a fresh intent read after an operator message.",
      }).success,
    ).toBe(true)
    expect(
      tools.analyze_intent.inputSchema!.safeParse({
        reason: "Do not strip continuation-like input into a fresh intent session.",
        continuation_artifact_id: "art_intent_continue",
      }).success,
    ).toBe(false)
  })

  test("continuation-capable stage schemas reject unknown fields instead of stripping them", () => {
    const validInputsByTool: Record<string, Record<string, unknown>> = {
      requirements: { reason: "analyze requirements" },
      architect: { reason: "decompose goals" },
      workload_analysis: { reason: "size goals" },
      deep_research: { reason: "collect evidence" },
      visual_qa: { reason: "review visual product" },
      integrity: { reason: "review active graph" },
    }
    for (const [toolName, validInput] of Object.entries(validInputsByTool)) {
      expect(tools[toolName].inputSchema!.safeParse(validInput).success).toBe(true)
      expect(
        tools[toolName].inputSchema!.safeParse({
          ...validInput,
          accidental_scope: "must not be stripped",
        }).success,
      ).toBe(false)
    }
  })

  test("frontend_research and frontend_design descriptions separate investigation division from UI implementation", () => {
    expect(tools.frontend_design.description).toContain("frontend/UI implementation")
    expect(tools.frontend_design.description).toContain(
      "URL as a visual reference to clone, implement, reproduce, or refine",
    )
    expect(tools.frontend_design.description).toContain("PRD/SPEC/report source material")
    expect(tools.frontend_design.description).toContain("you decide")
    expect(tools.frontend_design.description).not.toContain("Call this BEFORE every other downstream agent")
    expect(tools.frontend_design.description).not.toContain(
      "route those URLs through `frontend_research` with `source_urls`",
    )

    expect(tools.research).toBeUndefined()
    expect(tools.deep_research.description).toContain("PRD/SPEC/report source material")
    expect(tools.deep_research.description).toContain("`frontend_research` is a separate candidate")
    expect(tools.deep_research.description).not.toContain("use `frontend_research` instead")
    expect(tools.frontend_research.description).toContain("webpage/UI investigation publisher")
    expect(tools.frontend_research.description).toContain("exactly one source page URL per fresh call")
    expect(tools.frontend_research.description).toContain(
      "call frontend_research separately only for additional page URLs",
    )
    expect(tools.frontend_research.description).toContain(
      "Same URL with a different focus, viewport, interaction state, component, region, fidelity risk, or missing-detail question is still the same source-page scope",
    )
    expect(tools.frontend_research.description).toContain("consume the existing frontend_research_brief")
    expect(tools.frontend_research.description).toContain("host prepares rendered webpage evidence")
    expect(tools.frontend_research.description).toContain("partitions that evidence into source-backed work packets")
    expect(tools.frontend_research.description).toContain("Page Skeleton Blueprint")
    expect(tools.frontend_research.description).toContain("frontend_design consumes as page information architecture")
    expect(tools.frontend_research.description).toContain("small update_* result tools")
    expect(tools.frontend_research.description).not.toContain(
      "dispatch once for the relevant webpage investigation scope",
    )
    expect(tools.frontend_research.description).not.toContain("does not acquire webpage evidence itself")
    expect(tools.frontend_research.description).not.toContain("dispatch `frontend_design` first")
    expect(tools.frontend_research.description).toContain("frontend_research_brief/webpage_contract")
    expect(tools.frontend_research.description).toContain("NOT build")
    expect(tools.frontend_research.description).toContain("NOT the frontend implementation template owner")

    expect(tools.visual_qa.description).toContain("final frontend visual GUI and functional product review agent")
    expect(tools.visual_qa.description).toContain("GUI means Graphical User Interface")
    expect(tools.visual_qa.description).toContain("Use once near task completion")
    expect(tools.visual_qa.description).toContain("after all blocking build work is terminal")
    expect(tools.visual_qa.description).toContain("Visual QA and integrity are peer review agents")
    expect(tools.visual_qa.description).toContain("component truth and visible functionality first")
    expect(tools.visual_qa.description).toContain("layout/composition second")
    expect(tools.visual_qa.description).toContain("micro-style polish last")
    expect(tools.visual_qa.description).toContain("production_blockers")
    expect(tools.visual_qa.description).toContain("does not use visual scores or judge verdicts")
    expect(tools.visual_qa.description).not.toContain("UX means User Experience")
    expect(tools.visual_qa.description).not.toContain("post-goal-batch")
    expect(tools.visual_qa.description).not.toContain("webpage_render")
    expect(tools.visual_qa.description).not.toContain("webpage_evaluate")
    expect(tools.visual_qa.description).toContain("task-scoped browser_preview evidence")
    expect(tools.visual_qa.description).toContain("NOT the final acceptance gate")
    expect(tools.visual_qa.description).toContain("Visual QA and integrity are peer review agents")
    expect(tools.visual_qa.description).toContain("does not replace integrity")
    expect(tools.visual_qa.description).toContain("not integrity's workflow prerequisite")

    expect(tools.browser_preview.description).toContain("Explicitly start a long-lived frontend preview service")
    expect(tools.browser_preview.description).toContain("ordinary command output does not update preview targets")
    expect(tools.browser_preview.description).toBe(BrowserPreviewToolStaticDefinition.description)
    expect(tools.browser_preview.inputSchema).toBe(BrowserPreviewToolStaticDefinition.parameters)
    expect(tools.browser_preview_bind_local_module).toBeUndefined()
    expect(tools.browser_preview_compare_regions).toBeUndefined()
  })

  test("frontend tool schemas expose one registered field per tool input", () => {
    const frontendDesignJsonSchema = asSchema(tools.frontend_design.inputSchema as any).jsonSchema as any
    const frontendResearchJsonSchema = asSchema(tools.frontend_research.inputSchema as any).jsonSchema as any

    expect(frontendDesignJsonSchema.properties?.urls?.description).toContain("Use the plural field `urls`")
    expect(frontendDesignJsonSchema.properties?.urls?.description).toContain("do not send legacy `url`")
    expect(frontendDesignJsonSchema.properties?.urls?.description).toContain("at most one non-Figma live/page URL")
    expect(frontendResearchJsonSchema.properties?.source_urls?.description).toContain(
      "Use the plural field `source_urls`",
    )
    expect(frontendResearchJsonSchema.properties?.source_urls?.description).toContain("do not send `url`")
    expect(frontendResearchJsonSchema.properties?.source_urls?.description).toContain(
      "exactly one HTTP(S) webpage URL per fresh call",
    )
    expect(frontendResearchJsonSchema.properties?.source_urls?.description).toContain(
      "Same URL plus a different focus, viewport, interaction state, component, region, fidelity risk, or missing-detail question is still the same source-page scope",
    )
    expect(frontendResearchJsonSchema.properties?.focus?.description).toContain("Focus narrows the first brief only")

    expect(Object.keys(tools.frontend_design.inputSchema!.shape)).toEqual([
      "reason",
      "urls",
      "figma_url",
      "materials",
      "continuation_artifact_id",
    ])
    expect(
      tools.frontend_design.inputSchema!.safeParse({ reason: "visual reference", urls: ["https://example.com"] })
        .success,
    ).toBe(true)
    expect(
      tools.frontend_design.inputSchema!.safeParse({
        reason: "ambiguous multi-page live clone reference",
        urls: ["https://example.com/one", "https://example.com/two"],
      }).success,
    ).toBe(false)
    expect(
      tools.frontend_design.inputSchema!.safeParse({ reason: "old single-url field", url: "https://example.com" })
        .success,
    ).toBe(false)
    expect(tools.frontend_design.inputSchema!.safeParse({ urls: ["https://example.com"] }).success).toBe(false)
    for (const freshScope of [
      { urls: ["https://example.com/new"] },
      { figma_url: "https://www.figma.com/design/example" },
      { materials: ["design.md"] },
    ]) {
      expect(
        tools.frontend_design.inputSchema!.safeParse({
          reason: "continue prior frontend design",
          continuation_artifact_id: "art_frontend_design_continue",
          ...freshScope,
        }).success,
      ).toBe(false)
    }

    expect(Object.keys(tools.frontend_research.inputSchema!.shape)).toEqual([
      "reason",
      "source_urls",
      "focus",
      "continuation_artifact_id",
    ])
    expect(
      tools.frontend_research.inputSchema!.safeParse({
        reason: "publish investigation packets",
        source_urls: ["https://example.com"],
      }).success,
    ).toBe(true)
    expect(
      tools.frontend_research.inputSchema!.safeParse({
        reason: "ambiguous multi-page frontend research",
        source_urls: ["https://example.com/a", "https://example.com/b"],
      }).success,
    ).toBe(false)
    expect(
      tools.frontend_research.inputSchema!.safeParse({
        reason: "local files are not prepared webpage sources",
        source_urls: ["file:///tmp/source.html"],
      }).success,
    ).toBe(false)
    expect(
      tools.frontend_research.inputSchema!.safeParse({
        reason: "continue prior frontend research",
        continuation_artifact_id: "art_frontend_research_continue",
        focus: "new focus would be ignored by the continuation prompt",
      }).success,
    ).toBe(false)
    expect(
      tools.frontend_research.inputSchema!.safeParse({
        reason: "continue prior frontend research",
        continuation_artifact_id: "art_frontend_research_continue",
      }).success,
    ).toBe(true)
    expect(tools.frontend_research.inputSchema!.safeParse({ reason: "missing mode" }).success).toBe(false)
    expect(
      tools.frontend_research.inputSchema!.safeParse({
        reason: "ambiguous frontend research mode",
        source_urls: ["https://example.com"],
        continuation_artifact_id: "art_frontend_research_continue",
      }).success,
    ).toBe(false)

    expect(Object.keys(tools.visual_qa.inputSchema!.shape)).toEqual([
      "reason",
      "focus",
      "app_url",
      "preview_command",
      "continuation_artifact_id",
    ])
    expect(tools.visual_qa.inputSchema!.safeParse({ reason: "need fresh visual evidence" }).success).toBe(true)
    expect(
      tools.visual_qa.inputSchema!.safeParse({
        reason: "continue prior visual QA",
        continuation_artifact_id: "art_visual_qa_continue",
      }).success,
    ).toBe(true)
    for (const freshField of ["focus", "app_url", "preview_command"] as const) {
      expect(
        tools.visual_qa.inputSchema!.safeParse({
          reason: "ambiguous visual QA continuation",
          continuation_artifact_id: "art_visual_qa_continue",
          [freshField]: freshField === "app_url" ? "http://127.0.0.1:5173" : "fresh scope",
        }).success,
      ).toBe(false)
    }
    expect(tools.visual_qa.inputSchema!.safeParse({ focus: "mobile" }).success).toBe(false)

    expect(Object.keys(tools.workload_analysis.inputSchema!.shape)).toEqual(["reason", "continuation_artifact_id"])
    expect(tools.workload_analysis.inputSchema!.safeParse({ reason: "size goals" }).success).toBe(true)
    expect(
      tools.workload_analysis.inputSchema!.safeParse({
        reason: "continue prior workload analysis",
        continuation_artifact_id: "art_workload_continue",
      }).success,
    ).toBe(true)

    expect(Object.keys(tools.deep_research.inputSchema!.shape)).toEqual([
      "reason",
      "target_deliverable",
      "source_urls",
      "focus",
      "continuation_artifact_id",
    ])
    expect(tools.deep_research.inputSchema!.safeParse({ reason: "collect evidence" }).success).toBe(true)
    expect(
      tools.deep_research.inputSchema!.safeParse({
        reason: "continue prior deep research",
        continuation_artifact_id: "art_deep_research_continue",
      }).success,
    ).toBe(true)
    expect(
      tools.deep_research.inputSchema!.safeParse({
        reason: "ambiguous deep research continuation",
        source_urls: ["https://example.com/new-source"],
        continuation_artifact_id: "art_deep_research_continue",
      }).success,
    ).toBe(false)
    for (const freshField of ["target_deliverable", "focus"] as const) {
      expect(
        tools.deep_research.inputSchema!.safeParse({
          reason: "ambiguous deep research continuation",
          continuation_artifact_id: "art_deep_research_continue",
          [freshField]: freshField === "target_deliverable" ? "prd" : "fresh scope",
        }).success,
      ).toBe(false)
    }

    expect(Object.keys(tools.fact_check.inputSchema!.shape)).toEqual([
      "target_session_id",
      "target_agent",
      "fact_check_items",
      "reason",
      "continuation_artifact_id",
    ])
    expect(
      tools.fact_check.inputSchema!.safeParse({
        target_session_id: "ses_worker",
        target_agent: "build",
        fact_check_items: [
          {
            claim: "React 19 introduced use() for reading promise-backed resources",
            confidence: "medium",
            category: "library",
            source: "model prior",
          },
        ],
        reason: "Verify a worker claim with external documentation.",
      }).success,
    ).toBe(true)
    expect(
      tools.fact_check.inputSchema!.safeParse({
        reason: "Continue prior fact-check finalizer miss.",
        continuation_artifact_id: "art_fact_check_continue",
      }).success,
    ).toBe(true)
    expect(tools.fact_check.inputSchema!.safeParse({ reason: "Missing target fields." }).success).toBe(false)
    expect(
      tools.fact_check.inputSchema!.safeParse({
        target_session_id: "ses_worker",
        target_agent: "build",
        fact_check_items: [],
        reason: "Ambiguous fact-check mode should be rejected.",
        continuation_artifact_id: "art_fact_check_continue",
      }).success,
    ).toBe(false)
    expect(
      tools.fact_check.inputSchema!.safeParse({
        target_agent: "build",
        reason: "Contradictory target assertion must not be accepted during continuation.",
        continuation_artifact_id: "art_fact_check_continue",
      }).success,
    ).toBe(false)

    expect(Object.keys(tools.integrity.inputSchema!.shape)).toEqual(["reason", "continuation_artifact_id"])
    expect(tools.integrity.inputSchema!.safeParse({ reason: "review active graph" }).success).toBe(true)
    expect(
      tools.integrity.inputSchema!.safeParse({
        reason: "continue previous integrity finalizer miss",
        continuation_artifact_id: "art_integrity_continue",
      }).success,
    ).toBe(true)

    expect(Object.keys(tools.browser_preview.inputSchema!.shape)).toEqual([
      "command",
      "workdir",
      "url",
      "viewports",
      "timeout",
      "leaseTimeout",
      "description",
    ])
    expect(
      tools.browser_preview.inputSchema!.safeParse({
        command: "npm run dev",
        viewports: [{ id: "desktop", labelKey: "browserPreview.viewport.desktop", width: 1440, height: 900 }],
      }).success,
    ).toBe(true)
    expect(tools.browser_preview.inputSchema!.safeParse({ url: "http://127.0.0.1:5173/" }).success).toBe(false)
  })

  test("subagent cancellation tool exposes goal_run_id as its own field", () => {
    expect(tools.cancel_subagent.description).not.toContain("backward compatibility")
    expect(tools.cancel_subagent.description).not.toContain("via session_id")
    expect(Object.keys(tools.cancel_subagent.inputSchema!.shape)).toEqual([
      "session_id",
      "goal_id",
      "goal_run_id",
      "mode",
      "reason",
    ])
  })
})
