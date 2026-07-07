import { describe, expect, test } from "bun:test"
import { asSchema } from "ai"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { ProviderSchema } from "../../src/provider/schema"
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
      execute: (value: unknown, options: unknown) => Promise<unknown>
    }
  >

  test("unified scheduler tools replace direct stage and lifecycle descriptions", () => {
    expect(tools.dispatch_agent.description).toContain("Single scheduler agent dispatch tool")
    expect(tools.dispatch_agent.description).toContain("Use target to select the worker agent stage")
    expect(tools.dispatch_agent.description).toContain("target-specific fields")
    expect(tools.manage_task.description).toContain("Single scheduler task-management tool")
    expect(tools.manage_task.description).toContain("Use action to select task lifecycle, goal lifecycle, or failed-goal diagnostic behavior")
    expect(tools.manage_task.description).toContain("separate visible lifecycle and goal-diagnostic tools")

    for (const hidden of [
      "build",
      "integrity",
      "propose_task",
      "complete_task",
      "fail_task",
      "add_goal",
      "modify_goal",
      "delete_goal",
      "query_failed_goals",
    ]) {
      expect(tools[hidden], `${hidden} should be hidden behind unified tools`).toBeUndefined()
    }
  })

  test("wait description excludes internal live build polling", () => {
    expect(tools.wait.description).toContain("Never use wait for live build completion")
    expect(tools.wait.description).toContain("terminal refill polling")
  })

  test("respond_agent_coordination does not advertise generic same-kind redispatch", () => {
    const decision = tools.respond_agent_coordination.inputSchema!.shape.decision as { description?: string }
    expect(decision.description).toContain("concrete dispatch_agent target")
    expect(decision.description).toContain("Same-session replay without that target binding is rejected")
    expect(decision.description).not.toContain("same-kind or stage-specific")
  })

  test("cancel_subagent description excludes pending A2A request handling", () => {
    expect(tools.cancel_subagent.description).toContain("Do not use this to answer a pending A2A coordination request")
    expect(tools.cancel_subagent.description).toContain("respond_agent_coordination")
    expect(tools.cancel_subagent.description).toContain("cancel_worker")
    expect(tools.cancel_subagent.description).toContain("Missing root build ownership is not child lifecycle evidence")
    expect(tools.cancel_subagent.description).not.toContain("recover_stale")
  })

  test("removed child-session steering tool is not exposed", () => {
    expect(tools[["steer", "subagent"].join("_")]).toBeUndefined()
  })

  test("expert-squad tools are scheduler-owned visible skill loading", () => {
    expect(tools.select_expert_squad.description).toContain("active expert squad prompt profile")
    expect(tools.select_expert_squad.description).toContain("root session config overlay")
    expect(tools.select_expert_squad.description).toContain("future Orchestrator wakes")
    expect(tools.select_expert_squad.description).toContain("scheduler capability")
    expect(tools.select_expert_squad.description).toContain("visible selection evidence")
    expect(tools.select_expert_squad.description).toContain("visible continuation wake")
    expect(tools.select_expert_squad.description).toContain("already active")
    expect(tools.select_expert_squad.description).toContain("no-op")
    expect(tools.select_expert_squad.description).toContain("does not dispatch work")
    expect(tools.select_expert_squad.description).toContain("current model call")
    expect(tools.select_expert_squad.description).toContain("infer the profile from keywords")
    expect(tools.select_expert_squad.description).not.toContain("change tools")
    const profileID = tools.select_expert_squad.inputSchema!.shape.profile_id as { description?: string }
    expect(profileID.description).toContain("backend prompt-profile catalog")
    expect(profileID.description).toContain("loaded current-project expert-squad selector skill")
    expect(profileID.description).not.toContain("frontend-innovate")

    expect(tools.skill.description).toContain("Scheduler-only")
    expect(tools.skill.description).toContain("mounted Orchestrator expert-squad skills")
    expect(tools.skill.description).toContain("before calling select_expert_squad")
    expect(tools.skill.description).toContain(
      "never use it to load production, research, report, or implementation skills",
    )
  })

  test("select_expert_squad provider schema exports OpenAI-compatible profile_id pattern", () => {
    const providerBoundSchema = ProviderSchema.input(
      {
        id: "hexin/gpt-5.5",
        providerID: "hexin",
        api: {
          id: "gpt-5.5",
          url: "https://aimemodeldev.myhexin.com/litellm/v1",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "Gpt 5 5",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 1_050_000, output: 128_000 },
        status: "active",
        options: {},
        headers: {},
      } as any,
      tools.select_expert_squad.inputSchema,
    )
    const jsonSchema = asSchema(providerBoundSchema as any).jsonSchema as any
    const pattern = jsonSchema.properties?.profile_id?.pattern

    expect(pattern).toBe("^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
    expect(pattern).not.toMatch(/\(\?(?:[=!]|<[=!])/)
    expect(jsonSchema.required).toContain("profile_id")
  })

  test("build schema rejects misspelled goal scope instead of stripping it into direct build", () => {
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "build",
        reason: "Run the scoped goal build.",
        goalID: "gol_valid_scope",
      }).success,
    ).toBe(true)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "build",
        reason: "Run the scoped goal build.",
        goal_id: "gol_typo_scope",
        request: "Implement the scoped goal.",
        directBuildIntent: "modify_files",
      }).success,
    ).toBe(false)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "build",
        reason: "Do not accept a deleted new-session retry escape hatch.",
        goalID: "gol_valid_scope",
        freshContext: true,
      }).success,
    ).toBe(false)
  })

  test("analyze_intent schema accepts continuation artifact and rejects unknown fields", () => {
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "analyze_intent",
        reason: "Need a fresh intent read after an operator message.",
      }).success,
    ).toBe(true)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "analyze_intent",
        reason: "Continue the exact prior intent-analysis session.",
        continuation_artifact_id: "art_intent_continue",
      }).success,
    ).toBe(true)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "analyze_intent",
        reason: "Do not strip unknown input into an intent session.",
        continuation_id: "art_wrong_field",
      }).success,
    ).toBe(false)
  })

  test("continuation-capable stage schemas reject unknown fields instead of stripping them", () => {
    const validInputsByTool: Record<string, Record<string, unknown>> = {
      analyze_intent: { reason: "classify intent" },
      requirements: { reason: "analyze requirements" },
      architect: { reason: "decompose goals" },
      workload_analysis: { reason: "size goals" },
      deep_research: { reason: "collect evidence" },
      visual_qa: { reason: "review visual product" },
      integrity: { reason: "review active graph" },
    }
    for (const [toolName, validInput] of Object.entries(validInputsByTool)) {
      expect(tools.dispatch_agent.inputSchema!.safeParse({ target: toolName, ...validInput }).success).toBe(true)
      expect(
        tools.dispatch_agent.inputSchema!.safeParse({
          target: toolName,
          ...validInput,
          accidental_scope: "must not be stripped",
        }).success,
      ).toBe(false)
    }
  })

  test("frontend and review worker targets are hidden behind dispatch_agent", () => {
    expect(tools.frontend_design).toBeUndefined()
    expect(tools.frontend_research).toBeUndefined()
    expect(tools.deep_research).toBeUndefined()
    expect(tools.visual_qa).toBeUndefined()
    expect(tools.integrity).toBeUndefined()
    expect(tools.research).toBeUndefined()
    expect(tools.dispatch_agent.description).toContain("worker agent stage")
    expect(tools.dispatch_agent.description).toContain("visual_qa")
    expect(tools.dispatch_agent.description).toContain("integrity")
    expect(tools.browser_preview.description).toContain("Explicitly start a long-lived frontend preview service")
    expect(tools.browser_preview.description).toContain("ordinary command output does not update preview targets")
    expect(tools.browser_preview.description).toBe(BrowserPreviewToolStaticDefinition.description)
    expect(tools.browser_preview.inputSchema).toBe(BrowserPreviewToolStaticDefinition.parameters)
  })

  test("dispatch_agent schema exposes registered worker input fields", async () => {
    const dispatchJsonSchema = asSchema(tools.dispatch_agent.inputSchema as any).jsonSchema as any
    const dispatchVariants = dispatchJsonSchema.anyOf ?? dispatchJsonSchema.oneOf
    expect(Array.isArray(dispatchVariants)).toBe(true)
    const variantForTarget = (target: string) => {
      const variant = dispatchVariants.find((candidate: any) => candidate.properties?.target?.const === target)
      expect(variant).toBeDefined()
      return variant
    }
    const frontendDesignProperties = variantForTarget("frontend_design").properties
    const frontendResearchProperties = variantForTarget("frontend_research").properties

    expect(frontendDesignProperties.target.description).toContain("Workflow target")
    expect(frontendDesignProperties.urls.description).toContain("Use the plural field `urls`")
    expect(frontendDesignProperties.urls.description).toContain("do not send legacy `url`")
    expect(frontendResearchProperties.source_urls).toBeDefined()
    expect(frontendResearchProperties.focus).toBeDefined()

    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "frontend_design",
        reason: "visual reference",
        urls: ["https://example.com"],
      }).success,
    ).toBe(true)
    expect(
      tools.dispatch_agent.inputSchema!.safeParse({
        target: "frontend_design",
        reason: "old single-url field",
        url: "https://example.com",
      }).success,
    ).toBe(false)
    await expect(
      tools.dispatch_agent.execute(
        {
          target: "frontend_research",
          reason: "local files are not prepared webpage sources",
          source_urls: ["file:///tmp/source.html"],
        },
        {},
      ),
    ).rejects.toThrow()
    await expect(
      tools.dispatch_agent.execute(
        {
          target: "fact_check",
          reason: "Missing target fields.",
        },
        {},
      ),
    ).rejects.toThrow()

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
      "reason",
    ])
  })
})
