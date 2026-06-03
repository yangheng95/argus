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

  test("frontend_research and frontend_design descriptions separate webpage PRD evidence from UI implementation", () => {
    expect(tools.frontend_design.description).toContain("frontend/UI implementation")
    expect(tools.frontend_design.description).toContain("URL as a visual reference to clone, implement, reproduce, or refine")
    expect(tools.frontend_design.description).toContain("PRD/SPEC/report/source material")
    expect(tools.frontend_design.description).toContain("route those URLs through `frontend_research` with `source_urls`")

    expect(tools.research.description).toContain("PRD/SPEC/report source material")
    expect(tools.research.description).toContain("use `frontend_research` instead")
    expect(tools.frontend_research.description).toContain("read-only stage agent for webpage/UI reference research")
    expect(tools.frontend_research.description).toContain("investigates rendered webpage evidence and source pages itself")
    expect(tools.frontend_research.description).toContain("frontend_research_brief/webpage_contract")
    expect(tools.frontend_research.description).toContain("NOT build")
    expect(tools.frontend_research.description).toContain("NOT the frontend implementation template owner")
  })
})
