import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { VisualQaTestHooks } from "../../src/visual-qa"
import { VISUAL_QA_SESSION_TOOL_IDS } from "../../src/visual-qa/static-tools"

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
        expect(Object.keys(tools)).toContain("webpage_render")
        expect(Object.keys(tools)).not.toContain("webpage_extract")
      },
    })
  }, 30_000)

  test("prompt names UI/UX expansion and frontend_design evidence source", () => {
    const prompt = VisualQaTestHooks.buildVisualQaUserPrompt({
      taskTitle: "Clone page",
      taskRequest: "Replicate the visual page.",
      reason: "Need fresh desktop and mobile evidence.",
      frontendDesign: "visual_consistency_contract",
      buildEvidence: "Build report",
      previewCommand: "npm run dev",
    })
    expect(prompt).toContain("UI means User Interface")
    expect(prompt).toContain("UX means User Experience")
    expect(prompt).toContain("Frontend Design Evidence")
    expect(prompt).toContain("Use Node for Playwright")
  })
})
