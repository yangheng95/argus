import { describe, expect, test } from "bun:test"
import { createOrchestratorTools } from "../../src/orchestrator/tools"

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
    expect(tools.propose_task.description).toContain("execution evidence")
    expect(tools.propose_task.description).toContain("artifact state")
    expect(tools.propose_task.description).toContain("supplemental features")
    expect(tools.propose_task.description).toContain("project-improvement suggestions")
    expect(tools.propose_task.description).toContain("original user request never authorised")
  })

  test("modify_goal narrows existing contracts instead of expanding scope", () => {
    expect(tools.modify_goal.description).toContain("clarify or tighten acceptance")
    expect(tools.modify_goal.description).toContain("Scope expansion")
    expect(tools.modify_goal.description).toContain("propose_task or question")
  })

  test("frontend_research and frontend_design descriptions separate investigation division from UI implementation", () => {
    expect(tools.frontend_design.description).toContain("frontend/UI implementation")
    expect(tools.frontend_design.description).toContain("URL as a visual reference to clone, implement, reproduce, or refine")
    expect(tools.frontend_design.description).toContain("PRD/SPEC/report source material")
    expect(tools.frontend_design.description).toContain("you decide")
    expect(tools.frontend_design.description).not.toContain("Call this BEFORE every other downstream agent")
    expect(tools.frontend_design.description).not.toContain("route those URLs through `frontend_research` with `source_urls`")

    expect(tools.research).toBeUndefined()
    expect(tools.deep_research.description).toContain("PRD/SPEC/report source material")
    expect(tools.deep_research.description).toContain("`frontend_research` is a separate candidate")
    expect(tools.deep_research.description).not.toContain("use `frontend_research` instead")
    expect(tools.frontend_research.description).toContain("webpage/UI investigation publisher")
    expect(tools.frontend_research.description).toContain("host prepares rendered webpage evidence")
    expect(tools.frontend_research.description).toContain("partitions that evidence into source-backed work packets")
    expect(tools.frontend_research.description).toContain("small registration tools")
    expect(tools.frontend_research.description).not.toContain("does not acquire webpage evidence itself")
    expect(tools.frontend_research.description).not.toContain("dispatch `frontend_design` first")
    expect(tools.frontend_research.description).toContain("frontend_research_brief/webpage_contract")
    expect(tools.frontend_research.description).toContain("NOT build")
    expect(tools.frontend_research.description).toContain("NOT the frontend implementation template owner")
  })

  test("frontend tool schemas expose one registered field per tool input", () => {
    expect(Object.keys(tools.frontend_design.inputSchema!.shape)).toEqual([
      "reason",
      "url",
      "urls",
      "figma_url",
      "materials",
    ])
    expect(tools.frontend_design.inputSchema!.safeParse({ reason: "visual reference", urls: ["https://example.com"] }).success).toBe(
      true,
    )
    expect(tools.frontend_design.inputSchema!.safeParse({ urls: ["https://example.com"] }).success).toBe(false)

    expect(Object.keys(tools.frontend_research.inputSchema!.shape)).toEqual(["reason", "source_urls", "focus"])
    expect(
      tools.frontend_research.inputSchema!.safeParse({
        reason: "publish investigation packets",
        source_urls: ["https://example.com"],
      }).success,
    ).toBe(true)
    expect(tools.frontend_research.inputSchema!.safeParse({ reason: "missing urls" }).success).toBe(false)
  })
})
