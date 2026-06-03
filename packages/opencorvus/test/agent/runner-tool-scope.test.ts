import { describe, expect, test } from "bun:test"
import { promptToolSwitchesForAgentRun, shouldFailUnreadableBuildReference } from "../../src/agent/runner"
import { renderPreTerminalReflectionPrompt as preTerminalReflectionPrompt } from "../../src/prompt/fragments/pre-terminal-reflection"

describe("agent runner build tool scope", () => {
  test("plain build runs keep terminal tools and skill discovery but hide non-build and reference tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["merge_back", "report_build_result"],
      kind: "build",
    })

    expect(switches.merge_back).toBe(true)
    expect(switches.report_build_result).toBe(true)
    expect(switches.task).toBe(false)
    expect(switches.webfetch).toBe(false)
    expect(switches.websearch).toBe(false)
    expect(switches.external_code_search).toBe(false)
    expect(switches.skill).toBe(true)
    expect(switches.memory).toBe(false)
    expect(switches.schedule).toBeUndefined()
    expect(switches.planner).toBe(false)
    expect(switches.goal_report).toBe(false)
  })

  test("build tool scope does not reopen mirror tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["report_build_result"],
      kind: "build",
    })

    expect(switches.report_build_result).toBe(true)
    expect(switches.webpage_extract).toBeUndefined()
    expect(switches.webpage_render).toBeUndefined()
    expect(switches.webpage_vision_judge).toBeUndefined()
  })

  test("build no longer opens research tools through skill required_tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["report_build_result"],
      kind: "build",
    })

    expect(switches.report_build_result).toBe(true)
    expect(switches.skill).toBe(true)
    expect(switches.websearch).toBe(false)
    expect(switches.webfetch).toBe(false)
    expect(switches.external_code_search).toBe(false)
    expect(switches.task).toBe(false)
  })

  test("non-build agents are not silently scoped by build skill policy", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["submit_acceptance_verdict"],
      kind: "integrity",
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

  test("pre-terminal reflection applies to terminal tools", () => {
    const prompt = preTerminalReflectionPrompt({
      agentName: "build",
      terminalToolName: "report_build_result",
    })

    expect(prompt).toContain("report_build_result")
    expect(prompt).toContain("original user request")
    expect(prompt).toContain("generated REQ rows")
    expect(prompt).toContain("architect goals")
    expect(prompt).toContain("integrity feedback")
    expect(prompt).toContain("visible content is componentized and data-fed")
    expect(prompt).toContain("charts/maps/heatmaps/tables/tabs/components were not flattened")
    expect(prompt).toContain("correct the mismatch before finalizing")
    expect(prompt).toContain("not an additional deliverable")
  })

  test("pre-terminal reflection applies to StructuredOutput agents", () => {
    const prompt = preTerminalReflectionPrompt({
      agentName: "intent-analysis",
      usesStructuredOutput: true,
    })

    expect(prompt).toContain("StructuredOutput")
    expect(prompt).toContain("intent-analysis")
    expect(prompt).toContain("prompt-visible original user request")
  })

  test("pre-terminal reflection is absent without a finalization contract", () => {
    expect(preTerminalReflectionPrompt({ agentName: "scratch" })).toBeUndefined()
  })
})
