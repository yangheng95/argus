import { describe, expect, test } from "bun:test"
import { renderBuildAutoIterationMode } from "../../src/build/agent"

const promptPath = new URL("../../src/prompt/core/build-core.txt", import.meta.url)

async function readBuildPrompt() {
  return await Bun.file(promptPath).text()
}

describe("build agent goal execution discipline prompt", () => {
  test("frames build as a general task-scoped executor", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(normalized).toContain("general task-scoped executor")
    expect(normalized).toContain("investigation reports")
    expect(normalized).toContain("Product Requirements Document (PRD)")
    expect(normalized).toContain("produce the requested deliverable")
  })

  test("keeps goal builds depth-first inside the current goal contract", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(prompt).toContain("## Execution Discipline")
    expect(normalized).toContain("stay inside this goal's contract")
    expect(normalized).toContain("drive it to completion depth-first")
    expect(normalized).toContain("First satisfy this goal's `objective`, `acceptance_specs`")
    expect(normalized).toContain("reopen the whole task plan")
    expect(normalized).toContain("redesign decomposition")
    expect(normalized).toContain("Depth-first means: identify the goal-local execution path")
    expect(normalized).toContain("Expand outside `owned_paths` only when the real code path")
  })

  test("renders current auto-iteration mode into build sessions", () => {
    expect(renderBuildAutoIterationMode(false)).toContain("assistant.auto_iteration=false")
    expect(renderBuildAutoIterationMode(false)).toContain("one focused repair/verification pass")
    expect(renderBuildAutoIterationMode(false)).toContain("explicitly assigned stuck-state repair")
    expect(renderBuildAutoIterationMode(true)).toContain("assistant.auto_iteration=true")
    expect(renderBuildAutoIterationMode(true)).toContain("continue focused repair attempts")
    expect(renderBuildAutoIterationMode(true)).toContain("dependency, toolchain, port, script, test, and worktree merge repairs")
  })

  test("warns Windows builds to start Playwright through npm, not bun", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(normalized).toContain("On Windows, start Playwright only through Node Package Manager (`npm`)")
    expect(normalized).toContain("never through `bun`")
    expect(normalized).toContain("severe connection-timeout bug on Windows")
  })

  test("requires observed frontend verification and random preview ports", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(normalized).toContain("For frontend design, UI implementation, webpage, or visual tasks")
    expect(normalized).toContain("Model Context Protocol (MCP) browser/render/preview tooling")
    expect(normalized).toContain("Do not only write files and infer success from static code")
    expect(normalized).toContain("use a random or dynamically discovered free high port")
    expect(normalized).toContain("Do not bind default shared ports such as 3000, 5173, or 4173")
  })

  test("keeps scenario policy out of the build role core", async () => {
    const prompt = await readBuildPrompt()

    expect(prompt).not.toContain("web-clone-source")
    expect(prompt).not.toContain("frontend-design")
    expect(prompt).not.toContain("mirror/")
    expect(prompt).not.toContain("baseline_replacement_plan")
    expect(prompt).not.toContain("Persistent Integrity Findings")
  })
})
