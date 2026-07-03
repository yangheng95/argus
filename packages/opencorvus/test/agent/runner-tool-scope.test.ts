import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { promptToolSwitchesForAgentRun } from "../../src/agent/runner"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { renderPreTerminalReflectionPrompt as preTerminalReflectionPrompt } from "../../src/prompt/fragments/pre-terminal-reflection"

describe("agent runner build tool scope", () => {
  test("plain build runs keep terminal tools and skill discovery but hide non-build and reference tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["merge_back", "report_build_result"],
      role: "build",
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

  test("build tool scope does not reopen webpage evidence tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["report_build_result"],
      role: "build",
    })

    expect(switches.report_build_result).toBe(true)
    expect(switches.webpage_extract).toBeUndefined()
    expect(switches.webpage_render).toBeUndefined()
    expect(switches.webpage_vision_judge).toBeUndefined()
  })

  test("build no longer opens research tools through skill required_tools", () => {
    const switches = promptToolSwitchesForAgentRun({
      extraToolNames: ["report_build_result"],
      role: "build",
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
      role: "integrity",
    })

    expect(switches).toEqual({ submit_acceptance_verdict: true })
  })

  test("build runtime tool switches are owned by the canonical tool pool", () => {
    expect(AgentToolPool.defaultRuntimeToolSwitches("build")).toMatchObject({
      skill: true,
      task: false,
      webfetch: false,
      websearch: false,
      external_code_search: false,
      memory: false,
      planner: false,
      goal_report: false,
    })
    expect(AgentToolPool.defaultRuntimeToolSwitches("integrity")).toEqual({})
  })

  test("runner does not own build-specific runtime tool policy", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/agent/runner.ts", import.meta.url)), "utf8")

    expect(source).not.toContain("BUILD_DEFAULT_DISABLED_TOOLS")
    expect(source).not.toContain('input.kind !== "build"')
    expect(source).not.toContain('input.kind === "build"')
  })

  test("generic runner does not own a visual reference hard-fail gate", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/agent/runner.ts", import.meta.url)), "utf8")

    expect(source).not.toContain("visual_reference_unreadable")
    expect(source).not.toContain("unreadableReferencePromptMarker")
    expect(source).not.toContain("shouldFailUnreadableReferenceForRole")
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
