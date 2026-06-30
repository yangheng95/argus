import { describe, expect, test } from "bun:test"
import { renderBuildRepairDiscipline } from "../../src/build/agent"

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

  test("renders static build repair discipline into build sessions", () => {
    const discipline = renderBuildRepairDiscipline()

    expect(discipline).toContain("## Build Repair Discipline")
    expect(discipline).toContain("Repo-local dependency")
    expect(discipline).toContain("node_modules-link")
    expect(discipline).toContain("Continue concrete repairs in the same worktree")
    expect(discipline).toContain("until the exact required checker runs and passes")
    expect(discipline).toContain("Toolchain blockers are publish blockers")
    expect(discipline).toContain("Do not call merge_back")
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
    expect(normalized).toContain("use `browser_preview_reference_regions` only for required module binding evidence")
    expect(normalized).toContain("single returned source/local module comparison attachment")
    expect(normalized).toContain("Use `browser_preview_compare_scroll_slices`")
    expect(normalized).toContain("supporting side-by-side `visual_diff` evidence")
    expect(normalized).toContain("one concrete local module")
    expect(normalized).toContain("Do not use `browser_preview_reference_regions` for a first-viewport slice")
    expect(normalized).toContain("whole-page screenshot, body/main/app root, or page-shell locator")
    expect(normalized).toContain("does not run a second `reference-comparison` pass")
    expect(normalized).toContain("Browser MCP screenshot/observe/navigation tools")
    expect(normalized).toContain("first-viewport checks and changed page slices")
    expect(normalized).toContain("Keep `scrollY` and `sliceHeight` aligned with the source slice")
    expect(normalized).toContain("share the same viewport-slice contract")
    expect(normalized).toContain("Inspect the returned images yourself")
    expect(normalized).toContain("Treat scroll-slice side-by-side output as supporting `visual_diff` evidence")
    expect(normalized).toContain("not formal `reference-comparison` proof")
    expect(normalized).not.toContain("browser_preview_layout_geometry")
    expect(normalized).toContain("route-health failure")
    expect(normalized).toContain("Viewport width differences remain visible in side-by-side evidence")
    expect(normalized).toContain("reference-parity mismatch")
    expect(normalized).toContain("request only `desktop` viewport region comparison evidence")
    expect(normalized).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(normalized).toContain("invalid-goal-scope blocker")
    expect(normalized).toContain(
      "report the exact evidence gap or blocker if source binding cannot be produced for a required module",
    )
    expect(normalized).toContain("bound to the current goal, region, or delivered surface")
    expect(normalized).toContain("do not rely only on global shared screenshots")
    expect(normalized).toContain("DOM text checks, console-clean runtime diagnostics, or benchmark scores")
    expect(normalized).toContain("When retry guidance, acceptance feedback, or a Visual QA report includes `problem_dom_regions`")
    expect(normalized).toContain("Document Object Model")
    expect(normalized).toContain("selector/locator, DOM path, bounded HTML excerpt")
    expect(normalized).toContain("code-search terms")
    expect(normalized).toContain("Do not treat DOM text alone as visual proof")
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
    expect(normalized).toContain("layout density, spacing rhythm, scoped viewport behavior, or interaction semantics")
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
    expect(normalized).toContain("Local toolchain repair is part of Build ownership")
    expect(normalized).toContain("while concrete repair actions remain")
    expect(normalized).toContain("include the exhausted repair evidence")
    expect(normalized).toContain("Toolchain blockers are also publish blockers")
    expect(normalized).toContain("Do not call `merge_back` after project changes")
    expect(normalized).toContain("when the required checker has not started")
    expect(normalized).toContain("publish only after the checker evidence is green")
    expect(normalized).toContain("Never call `merge_back` for changed project files")
    expect(normalized).toContain("while required verification is blocked by local toolchain/pre-checker failure")
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
