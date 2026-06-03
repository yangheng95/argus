import { describe, expect, test } from "bun:test"
import { createOrchestratorTools } from "../../src/orchestrator/tools"

describe("orchestrator tool descriptions for integrity stuck loops", () => {
  const tools = createOrchestratorTools({
    taskID: "tsk_tool_description",
    agentSessionID: "ses_tool_description",
    signal: new AbortController().signal,
  }).tools as Record<string, { description?: string }>

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

  test("research and frontend_design descriptions separate webpage PRD evidence from UI implementation", () => {
    expect(tools.frontend_design.description).toContain("frontend/UI implementation")
    expect(tools.frontend_design.description).toContain("URL as a visual reference to clone, implement, reproduce, or refine")
    expect(tools.frontend_design.description).toContain("PRD/SPEC/report/source material")
    expect(tools.frontend_design.description).toContain("route those URLs through `research` with `source_urls`")

    expect(tools.research.description).toContain("PRD/SPEC/report source material")
    expect(tools.research.description).toContain("functional and visual analysis of a supplied page")
    expect(tools.research.description).toContain("rendered webpage PRD evidence path instead of frontend_design")
  })
})
