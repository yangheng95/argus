import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { VisualQaTestHooks } from "../../src/visual-qa"
import { VISUAL_QA_SESSION_TOOL_IDS } from "../../src/visual-qa/static-tools"
import { BrowserPreviewTool } from "../../src/tool/browser-preview"
import { BrowserPreviewBindLocalModuleTool } from "../../src/tool/browser-preview-bind-local-module"
import { BrowserPreviewCompareRegionsTool } from "../../src/tool/browser-preview-compare-regions"

describe("visual-qa agent", () => {
  test("runtime tool surface matches the dedicated static contract", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const contextTools = await VisualQaTestHooks.createVisualQaContextTools({})
        const implementationTools = await VisualQaTestHooks.createVisualQaImplementationTools({})
        const utilityTools = await VisualQaTestHooks.createVisualQaUtilityTools({})
        const tools = {
          ...contextTools,
          ...implementationTools,
          ...utilityTools,
          submit_visual_qa_report: {} as any,
        }
        VisualQaTestHooks.assertVisualQaStaticToolSurface(tools)
        expect(Object.keys(tools).sort()).toEqual([...VISUAL_QA_SESSION_TOOL_IDS].sort())
        expect(Object.keys(tools)).toContain("skill")
        expect(Object.keys(tools)).toContain("browser_preview")
        expect(Object.keys(tools)).toContain("browser_preview_bind_local_module")
        expect(Object.keys(tools)).toContain("browser_preview_compare_regions")
        expect(Object.keys(tools)).not.toContain("webpage_render")
        expect(Object.keys(tools)).not.toContain("webpage_evaluate")
        expect(Object.keys(tools)).not.toContain("webpage_vision_judge")
        expect(Object.keys(tools)).not.toContain("webpage_extract")

        for (const info of [BrowserPreviewTool, BrowserPreviewBindLocalModuleTool, BrowserPreviewCompareRegionsTool]) {
          const initialized = await info.init()
          const runtimeTool = tools[info.id] as unknown as { description?: string; inputSchema?: unknown }
          expect(runtimeTool.description).toBe(initialized.description)
          expect(runtimeTool.inputSchema).toBe(initialized.parameters)
        }
      },
    })
  }, 30_000)

  test("prompt names focused GUI fidelity and frontend_design evidence source", () => {
    const prompt = VisualQaTestHooks.buildVisualQaUserPrompt({
      taskTitle: "Clone page",
      taskRequest: "Replicate the visual page.",
      reason: "Need fresh desktop and mobile evidence.",
      integrityContext: "Integrity says the fake chart must become a real data-bound chart.",
      frontendDesign: "visual_consistency_contract",
      buildEvidence: "Build report",
      previewCommand: "npm run dev",
    })
    expect(prompt).toContain("final frontend visual GUI and functional product review")
    expect(prompt).toContain("Visual QA and integrity are peer post-build review agents")
    expect(prompt).toContain("focused frontend visual/product-design evidence")
    expect(prompt).toContain("GUI means Graphical User Interface")
    expect(prompt).not.toContain("UX means User Experience")
    expect(prompt).toContain("picky professional product designer")
    expect(prompt).toContain("Do not give draft-quality")
    expect(prompt).toContain("not a style-only pass")
    expect(prompt).toContain("removing/replacing/rebuilding that component")
    expect(prompt).toContain("instead of CSS tweaking")
    expect(prompt).toContain("Integrity Review Context")
    expect(prompt).toContain("fake chart must become a real data-bound chart")
    expect(prompt).toContain("Repair coarse-to-fine")
    expect(prompt).toContain("component truth and visible functionality first")
    expect(prompt).toContain("layout/composition second")
    expect(prompt).toContain("state-style polish last")
    expect(prompt).toContain("Do not chase visual scores or external judge verdicts")
    expect(prompt).toContain("blocker-free structured report")
    expect(prompt).toContain("Reference/clone fidelity is enforced only when")
    expect(prompt).toContain("browser_preview_bind_local_module")
    expect(prompt).toContain("browser_preview_compare_regions")
    expect(prompt).toContain("task-scoped `reference-comparison` evidence")
    expect(prompt).toContain("Frontend Design Context")
    expect(prompt).not.toContain("Frontend Research Work Packets")
    expect(prompt).toContain("Use Node for Playwright")
    expect(prompt).toContain("no follow_up_task")
    expect(prompt).toContain("include follow_up_task with a complete new-round task request")
  })

  test("product design principles render abstract prompt criteria without fixture examples", () => {
    const prompt = VisualQaTestHooks.buildVisualQaUserPrompt({
      taskTitle: "Visual review",
      taskRequest: "Review the page.",
      reason: "Need a product-grade visual QA pass.",
    })

    expect(prompt).toContain("# Product Design QA Principles")
    expect(prompt).toContain("component-truth")
    expect(prompt).toContain("reference-structure")
    expect(prompt).not.toContain("Blocker examples:")
    expect(prompt).not.toContain("low-fidelity-map-surface.png")
    expect(prompt).not.toContain("clipped-primary-navigation.png")
    expect(prompt).not.toContain("codex-clipboard-326e150e")
    expect(prompt).not.toContain("codex-clipboard-de608ec0")
  })
})
