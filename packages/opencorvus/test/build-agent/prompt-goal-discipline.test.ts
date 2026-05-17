import { describe, expect, test } from "bun:test"
import { renderBuildAutoIterationMode } from "../../src/build/agent"

const promptPath = new URL("../../src/prompt/core/build-core.txt", import.meta.url)

async function readBuildPrompt() {
  return await Bun.file(promptPath).text()
}

describe("build agent goal execution discipline prompt", () => {
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
    expect(normalized).toContain("With `assistant.auto_iteration=true`, iterate on failures until every acceptance spec for this goal is satisfied")
    expect(normalized).toContain("Expand outside `owned_paths` only when this goal's real code path requires it")
  })

  test("renders current auto-iteration mode into build sessions", () => {
    expect(renderBuildAutoIterationMode(false)).toContain("assistant.auto_iteration=false")
    expect(renderBuildAutoIterationMode(false)).toContain("one focused repair/verification pass")
    expect(renderBuildAutoIterationMode(true)).toContain("assistant.auto_iteration=true")
    expect(renderBuildAutoIterationMode(true)).toContain("continue focused repair attempts")
  })
})
