import { describe, expect, test } from "bun:test"
import { renderBuildAutoIterationMode } from "../../src/build/agent"

const promptPath = new URL("../../src/prompt/core/build-core.txt", import.meta.url)

async function readBuildPrompt() {
  return await Bun.file(promptPath).text()
}

describe("build agent goal execution discipline prompt", () => {
  test("frames build as independent end-to-end ownership", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(normalized).toContain("independent end-to-end owner")
    expect(normalized).toContain("not a passive follower")
    expect(normalized).toContain("Keep the whole task in view")
    expect(normalized).toContain("deliver a simple runnable toy or product surface")
  })

  test("keeps goal builds depth-first inside the current goal contract", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(prompt).toContain("## Goal execution discipline")
    expect(normalized).toContain("stay inside this goal's contract")
    expect(normalized).toContain("drive it to completion depth-first")
    expect(normalized).toContain("make this exact goal's `objective`, `acceptance_specs`")
    expect(normalized).toContain("Do not browse adjacent goals")
    expect(normalized).toContain("reopen the whole task plan")
    expect(normalized).toContain("redesign the decomposition")
    expect(normalized).toContain("Depth-first means: identify the goal-local execution path")
    expect(normalized).toContain("With `assistant.auto_iteration=false`, make one focused repair/verification pass")
    expect(normalized).toContain("With `assistant.auto_iteration=true`, iterate on repairable tests")
    expect(normalized).toContain("scripts, ports, runtime config, and worktree merge conflicts")
    expect(normalized).toContain("Expand outside `owned_paths` only when this goal's real code path requires it")
  })

  test("renders current auto-iteration mode into build sessions", () => {
    expect(renderBuildAutoIterationMode(false)).toContain("assistant.auto_iteration=false")
    expect(renderBuildAutoIterationMode(false)).toContain("one focused repair/verification pass")
    expect(renderBuildAutoIterationMode(false)).toContain("explicitly assigned stuck-state repair")
    expect(renderBuildAutoIterationMode(true)).toContain("assistant.auto_iteration=true")
    expect(renderBuildAutoIterationMode(true)).toContain("continue focused repair attempts")
    expect(renderBuildAutoIterationMode(true)).toContain("dependency, toolchain, port, script, test, and worktree merge repairs")
  })

  test("teaches integrity-driven rework without a host-side route gate", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(prompt).toContain("## Integrity-driven rework")
    expect(normalized).toContain('When the user prompt contains a "## Persistent Integrity Findings" section')
    expect(normalized).toContain("treat its blocking findings as must-fix")
    expect(normalized).toContain("Address every blocking finding in your implementation OR fail through `report_build_result`")
    expect(normalized).toContain("Advisory findings rank below the blockers")
    expect(normalized).toContain("Do not interpret a finding's age as evidence it was already fixed")
    expect(normalized).toContain("persistence across rounds means previous attempts changed something")
  })
})
