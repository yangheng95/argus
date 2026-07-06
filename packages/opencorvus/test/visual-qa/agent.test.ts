import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { VisualQaTestHooks } from "../../src/visual-qa"
import { createVisualQaOutputTools } from "../../src/visual-qa/output-tools"
import { VISUAL_QA_SESSION_TOOL_IDS } from "../../src/visual-qa/static-tools"
import { BrowserPreviewTool } from "../../src/tool/browser-preview"
import { BrowserPreviewReferenceRegionsTool } from "../../src/tool/browser-preview-reference-regions"
import { BrowserPreviewCompareScrollSlicesTool } from "../../src/tool/browser-preview-compare-scroll-slices"
import { BrowserPreviewLayoutGeometryTool } from "../../src/tool/browser-preview-layout-geometry"
import { textContextPacket } from "../../src/agent/context-packet"
import { visualQaDispatchContextPacket } from "../../src/visual-qa/context"

describe("visual-qa agent", () => {
  test("runtime tool surface matches the dedicated static contract", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const contextTools = await VisualQaTestHooks.createVisualQaContextTools({})
        const evidenceTools = await VisualQaTestHooks.createVisualQaEvidenceTools({})
        const utilityTools = await VisualQaTestHooks.createVisualQaUtilityTools({})
        const tools = {
          ...contextTools,
          ...evidenceTools,
          ...utilityTools,
          ...createVisualQaOutputTools().tools,
        }
        VisualQaTestHooks.assertVisualQaStaticToolSurface(tools)
        expect(Object.keys(tools).sort()).toEqual([...VISUAL_QA_SESSION_TOOL_IDS].sort())
        expect(Object.keys(tools)).toContain("skill")
        expect(Object.keys(tools)).toContain("browser_preview")
        expect(Object.keys(tools)).toContain("browser_preview_reference_regions")
        expect(Object.keys(tools)).toContain("browser_preview_compare_scroll_slices")
        expect(Object.keys(tools)).toContain("browser_preview_layout_geometry")
        expect(Object.keys(tools)).not.toContain("bash")
        expect(Object.keys(tools)).not.toContain("edit")
        expect(Object.keys(tools)).not.toContain("write")
        expect(Object.keys(tools)).not.toContain("apply_patch")
        expect(Object.keys(tools)).not.toContain("register_visual_qa_repair")
        expect(Object.keys(tools)).not.toContain("register_visual_qa_changed_file")
        expect(Object.keys(tools)).not.toContain("webpage_render")
        expect(Object.keys(tools)).not.toContain("webpage_evaluate")
        expect(Object.keys(tools)).not.toContain("webpage_vision_judge")
        expect(Object.keys(tools)).not.toContain("webpage_extract")

        for (const info of [
          BrowserPreviewTool,
          BrowserPreviewReferenceRegionsTool,
          BrowserPreviewCompareScrollSlicesTool,
          BrowserPreviewLayoutGeometryTool,
        ]) {
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
      contextPackets: [
        textContextPacket({
          id: "integrity-review",
          title: "Integrity Review Context",
          source: "integrity",
          body: "Integrity says the fake chart must become a real data-bound chart.",
        })!,
        textContextPacket({
          id: "frontend-design",
          title: "Frontend Design Context",
          source: "frontend_design",
          body: "visual_consistency_contract",
        })!,
        textContextPacket({
          id: "agent-outcomes",
          title: "Agent Outcome Context",
          source: "agent_outcomes",
          body: "Implementation report",
        })!,
        visualQaDispatchContextPacket({
          previewCommand: "npm run dev",
        })!,
      ],
    })
    expect(prompt).toContain("frontend visual GUI and functional product review")
    expect(prompt).toContain("Visual QA and integrity are peer post-implementation review agents")
    expect(prompt).toContain("focused frontend visual/product-design review evidence")
    expect(prompt).toContain("GUI means Graphical User Interface")
    expect(prompt).not.toContain("UX means User Experience")
    expect(prompt).toContain("picky professional product designer")
    expect(prompt).toContain("Do not give draft-quality")
    expect(prompt).toContain("not a style-only pass")
    expect(prompt).toContain("removing/replacing/rebuilding that component")
    expect(prompt).toContain("instead of CSS tweaking")
    expect(prompt).toContain("Integrity Review Context")
    expect(prompt).toContain("context_packet_id: integrity-review")
    expect(prompt).toContain("source: integrity")
    expect(prompt).toContain("fake chart must become a real data-bound chart")
    expect(prompt).toContain("Visual QA is report-only")
    expect(prompt).toContain("do not edit files")
    expect(prompt).toContain("do not edit files, run shell repair commands, or claim code repair")
    expect(prompt).toContain("Review coarse-to-fine")
    expect(prompt).not.toContain("Repair coarse-to-fine")
    expect(prompt).not.toContain("If you repair files")
    expect(prompt).toContain("component truth and visible functionality first")
    expect(prompt).toContain("layout/composition second")
    expect(prompt).toContain("state-style polish last")
    expect(prompt).toContain("Do not chase visual scores or external judge verdicts")
    expect(prompt).toContain("structured report's own accepted/blocker fields")
    expect(prompt).toContain("problem_dom_regions")
    expect(prompt).toContain("Document Object Model (DOM)")
    expect(prompt).toContain("code-search terms")
    expect(prompt).toContain("screenshots remain the visual proof")
    expect(prompt).toContain("current workflow's implementation owner")
    expect(prompt).toContain("register evidence rows only after you actually captured or inspected")
    expect(prompt).toContain("must reuse refs from registered `register_visual_qa_evidence` rows")
    expect(prompt).toContain("Do not fill schema refs from intent")
    expect(prompt).toContain("Tool result acceptance discipline")
    expect(prompt).toContain("`state.status=completed`, returned attachments, job IDs, or registered evidence rows are not acceptance proof")
    expect(prompt).toContain("cite the returned `browser_preview_evidence:<evidenceID>` ref")
    expect(prompt).toContain("Reference/clone fidelity is in scope only when")
    expect(prompt).toContain("prioritize screenshot comparison")
    expect(prompt).toContain("browser_preview_reference_regions")
    expect(prompt).toContain("one source-binding module comparison")
    expect(prompt).toContain("Browser MCP screenshot/observe evidence")
    expect(prompt).toContain("browser_preview_compare_scroll_slices")
    expect(prompt).toContain("concrete component or module regions")
    expect(prompt).toContain("page-shell locator")
    expect(prompt).toContain("For first-viewport and screen-by-screen checks")
    expect(prompt).toContain("`scrollY` and `sliceHeight` aligned")
    expect(prompt).toContain("comparison_guidance.side_by_side_legend")
    expect(prompt).toContain("LEFT is the source/reference image")
    expect(prompt).toContain("RIGHT is the rendered/local implementation")
    expect(prompt).toContain("missing or wrong icons/assets")
    expect(prompt).toContain("hallucinated or missing content")
    expect(prompt).toContain("browser_preview_layout_geometry")
    expect(prompt).toContain("supporting geometry evidence")
    expect(prompt).toContain("inspect the page screen by screen")
    expect(prompt).toContain("Do not judge the whole webpage from one full-page screenshot")
    expect(prompt).toContain("supporting visual_diff evidence")
    expect(prompt).toContain("multi-viewport-alignment")
    expect(prompt).toContain("shared layout anchors")
    expect(prompt).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(prompt).toContain("instead of inventing proof or reference-comparison refs")
    expect(prompt).toContain("formal `reference-comparison` evidence")
    expect(prompt).toContain("fresh screenshot-bearing durable evidence refs")
    expect(prompt).toContain("do not put bare filesystem paths")
    expect(prompt).toContain("per-screen screenshots or scroll-slice comparisons")
    expect(prompt).toContain("Frontend Design Context")
    expect(prompt).toContain("context_packet_id: frontend-design")
    expect(prompt).not.toContain("Frontend Research Work Packets")
    expect(prompt).toContain("Use Node for Playwright")
    expect(prompt).toContain("no unresolved_code_module_problems")
    expect(prompt).toContain("report unresolved_code_module_problems tied to blocker IDs")
    expect(prompt).toContain("outer_html_excerpt")
    expect(prompt).toContain("computed_style")
    expect(prompt).toContain("code_search_terms")
    expect(prompt).toContain("do not submit a new-task request")
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
