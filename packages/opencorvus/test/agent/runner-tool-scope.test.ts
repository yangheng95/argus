import { describe, expect, test } from "bun:test"
import { promptToolSwitchesForAgentRun } from "../../src/agent/runner"

describe("agent runner build tool scope", () => {
  test("plain build runs keep terminal tools but hide reference-only tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["merge_back", "report_build_result"],
      skillsStage: "build",
      requiredTools: [],
    })

    expect(switches.merge_back).toBe(true)
    expect(switches.report_build_result).toBe(true)
    expect(switches.webpage_extract).toBe(false)
    expect(switches.webpage_image_extract).toBe(false)
    expect(switches.figma_extract).toBe(false)
    expect(switches.webpage_vision_judge).toBe(false)
  })

  test("build skills expose exactly their declared reference tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["report_build_result"],
      skillsStage: "build",
      requiredTools: ["webpage_extract", "webpage_render", "webpage_vision_judge"],
    })

    expect(switches.report_build_result).toBe(true)
    expect(switches.webpage_extract).toBe(true)
    expect(switches.webpage_render).toBe(true)
    expect(switches.webpage_vision_judge).toBe(true)
    expect(switches.webpage_image_extract).toBe(false)
    expect(switches.figma_extract).toBe(false)
  })

  test("non-build agents are not silently scoped by build skill policy", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["submit_verdict"],
      skillsStage: "delivery",
      requiredTools: [],
    })

    expect(switches).toEqual({ submit_verdict: true })
  })
})
