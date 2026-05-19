import { describe, expect, test } from "bun:test"
import { promptToolSwitchesForAgentRun, shouldFailUnreadableBuildReference } from "../../src/agent/runner"

describe("agent runner build tool scope", () => {
  test("plain build runs keep terminal tools but hide non-build and reference tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["merge_back", "report_build_result"],
      skillsStage: "build",
      requiredTools: [],
    })

    expect(switches.merge_back).toBe(true)
    expect(switches.report_build_result).toBe(true)
    expect(switches.task).toBe(false)
    expect(switches.webfetch).toBe(false)
    expect(switches.websearch).toBe(false)
    expect(switches.external_code_search).toBe(false)
    expect(switches.skill).toBe(false)
    expect(switches.memory).toBe(false)
    expect(switches.schedule).toBeUndefined()
    expect(switches.planner).toBe(false)
    expect(switches.goal_report).toBe(false)
  })

  test("build skills do not reopen mirror tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["report_build_result"],
      skillsStage: "build",
      requiredTools: ["webpage_extract", "webpage_render", "webpage_vision_judge"],
    })

    expect(switches.report_build_result).toBe(true)
    expect(switches.webpage_extract).toBeUndefined()
    expect(switches.webpage_render).toBeUndefined()
    expect(switches.webpage_vision_judge).toBeUndefined()
  })

  test("build skills expose exactly their declared research tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["report_build_result"],
      skillsStage: "build",
      requiredTools: ["websearch", "webfetch"],
    })

    expect(switches.report_build_result).toBe(true)
    expect(switches.websearch).toBe(true)
    expect(switches.webfetch).toBe(true)
    expect(switches.external_code_search).toBe(false)
    expect(switches.task).toBe(false)
  })

  test("non-build agents are not silently scoped by build skill policy", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["submit_acceptance_verdict"],
      skillsStage: "acceptance",
      requiredTools: [],
    })

    expect(switches).toEqual({ submit_acceptance_verdict: true })
  })

  test("build visual reference contract is a hard gate when reference bytes are filtered", () => {
    expect(shouldFailUnreadableBuildReference({
      kind: "build",
      userText: "## Visual Reference Contract (binding for this dispatch)\nref.png",
      droppedFileParts: [{ mime: "image/png" }],
    })).toBe(true)
  })

  test("non-build filtered images keep the existing visible marker path", () => {
    expect(shouldFailUnreadableBuildReference({
      kind: "architect",
      userText: "## Visual Reference Contract (binding for this dispatch)\nref.png",
      droppedFileParts: [{ mime: "image/png" }],
    })).toBe(false)
  })
})
