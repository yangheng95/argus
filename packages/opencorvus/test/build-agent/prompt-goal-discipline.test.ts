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
    expect(renderBuildAutoIterationMode(true)).toContain(
      "dependency, toolchain, port, script, test, and worktree merge repairs",
    )
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

    expect(prompt).toContain("## Frontend Visual Principle")
    expect(normalized).toContain("For any frontend project")
    expect(normalized).toContain("visual review is a first-class build responsibility")
    expect(normalized).toContain("not an optional verification detail")
    expect(normalized).toContain("Each file-changing pass must include observing the rendered result")
    expect(normalized).toContain("task-scoped backend browser evidence runner")
    expect(normalized).toContain("task preview target evidence route")
    expect(normalized).toContain("call `browser_preview` with the real dev/preview command")
    expect(normalized).toContain("Ordinary `bash` output does not update Preview targets")
    expect(normalized).toContain("task-scoped `browser_preview_target` artifact created by `browser_preview`")
    expect(normalized).toContain("Do not only write files and infer success from static code")
    expect(normalized).toContain("open the affected surface in a real browser/preview")
    expect(normalized).toContain("capture fresh screenshot evidence")
    expect(normalized).toContain("Browser MCP screenshot/observe tool")
    expect(normalized).toContain("inspect the screenshot yourself")
    expect(normalized).toContain("inspect the changed region plus surrounding layout context")
    expect(normalized).toContain("parent container, adjacent components, spacing, typography, color")
    expect(normalized).toContain("responsive framing, and local visual style")
    expect(normalized).toContain("prefer `browser_preview_compare_regions` over standalone screenshot capture")
    expect(normalized).toContain("Region comparison is the first repair-loop evidence")
    expect(normalized).toContain("use plain screenshots only as surrounding context")
    expect(normalized).toContain("Do not report frontend parity success without fresh region-comparison artifacts")
    expect(normalized).toContain("bound to the current goal, region, or delivered surface")
    expect(normalized).toContain("do not rely only on global shared screenshots")
    expect(normalized).toContain("DOM text checks, console-clean runtime diagnostics, or benchmark scores")
    expect(normalized).toContain("modify the implementation and repeat the screenshot review loop")
    expect(normalized).toContain("apply the Frontend Visual Principle before claiming the UI is correct")
    expect(normalized).toContain("use a random or dynamically discovered free high port")
    expect(normalized).toContain("Do not bind default shared ports such as 3000, 5173, or 4173")
  })

  test("requires product-manager screenshot review before frontend success", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(prompt).toContain("## Product Readiness Review")
    expect(normalized).toContain("review your final screenshots as a product manager")
    expect(normalized).toContain("Product manager means the person accountable")
    expect(normalized).toContain("product-grade, not merely compiling, test-passing, or visually nonblank")
    expect(normalized).toContain("must not look like an unfinished generated draft")
    expect(normalized).toContain("Block premature code and premature design before reporting success")
    expect(normalized).toContain("fake charts/maps/tables")
    expect(normalized).toContain("placeholder widgets")
    expect(normalized).toContain("dead controls")
    expect(normalized).toContain("bypassing the target component system")
    expect(normalized).toContain("marketing-style redesign of an operational surface")
    expect(normalized).toContain("reference-structure drift")
    expect(normalized).toContain("not limited to CSS or surface styling")
    expect(normalized).toContain("remove or replace that component and rebuild the surface")
    expect(normalized).toContain("Do not try to pass a structurally wrong component by tweaking")
    expect(normalized).toContain('Never call `report_build_result(status="passed")`')
    expect(normalized).toContain("latest screenshot still looks premature or not product-grade")
  })

  test("keeps reference parity boundaries when target design system adaptation is requested", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(prompt).toContain("## Reference Parity Boundaries")
    expect(normalized).toContain("the source evidence remains the binding contract")
    expect(normalized).toContain("not pixel-perfect")
    expect(normalized).toContain("not a brand copy")
    expect(normalized).toContain("use the target design system")
    expect(normalized).toContain("only relax the explicitly named dimensions")
    expect(normalized).toContain("They do not permit adding, removing, reordering")
    expect(normalized).toContain("source regions, navigation surfaces, content hierarchy")
    expect(normalized).toContain("layout density, spacing rhythm, responsive behavior, or interaction semantics")
    expect(normalized).toContain("Do not convert a reference-parity task into a new target-styled design")
    expect(normalized).toContain("treat that as a verification failure to repair")
    expect(normalized).toContain("must not be used to accept a mismatch")
    expect(normalized).toContain(
      "screenshots, source Document Object Model (DOM), style evidence, or interaction evidence",
    )
  })

  test("treats pre-checker verification failures as toolchain blockers", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(normalized).toContain("fails before the intended checker actually starts")
    expect(normalized).toContain("package manager")
    expect(normalized).toContain("dependency install graph")
    expect(normalized).toContain("native module loader")
    expect(normalized).toContain("build-script approval")
    expect(normalized).toContain("treat that as a toolchain blocker")
    expect(normalized).toContain("repair the toolchain first")
    expect(normalized).toContain("rerun the exact required command")
    expect(normalized).toContain("do not bypass the required command with a lower-level executable")
    expect(normalized).toContain("as if product code failed")
  })

  test("forbids committing OpenCorvus internal runtime paths as deliverables", async () => {
    const prompt = await readBuildPrompt()
    const normalized = prompt.replace(/\s+/g, " ")

    expect(normalized).toContain("Never stage or commit `.opencorvus/r/`")
    expect(normalized).toContain("`.opencorvus/runtime/`")
    expect(normalized).toContain("`.opencorvus/worktrees/`")
    expect(normalized).toContain("per-machine engine state")
    expect(normalized).toContain("durable deliverable there")
    expect(normalized).toContain("project source/docs path")
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
