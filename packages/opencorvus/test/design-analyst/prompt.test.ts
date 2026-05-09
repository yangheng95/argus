import { describe, expect, test } from "bun:test"
import { DesignAnalystTestHooks } from "../../src/design-analyst/agent"
import { createDesignOutputTools } from "../../src/design-analyst/output-tools"

describe("design-analyst prompt assembly", () => {
  test("live URL tasks do not inline system URL screenshots", async () => {
    const parts = await DesignAnalystTestHooks.buildPromptParts({
      title: "AMD replica",
      request: "复刻 https://chart.ainvest.com/NASDAQ-AMD/",
      attachments: [
        {
          sha: "abc",
          url: "/attachment/project/abc.png",
          mime: "image/png",
          size: 220_000,
          filename: "url-chart_ainvest_com.png",
          intent: "visual_reference",
          source: "url-screenshot",
        },
      ],
    })

    expect(parts).toHaveLength(1)
    expect(parts[0]?.type).toBe("text")
    expect(parts[0]?.text).toContain("stored for provenance but are not inlined")
    expect(parts[0]?.text).toContain("Use the mirror webpage pipeline first")
    expect(parts[0]?.text).not.toContain("[inlined as file part]")
  })

  test("terminal PRD/SPEC submit tool stores the authoritative handoff payload", async () => {
    const kit = createDesignOutputTools()
    const submit = kit.tools.submit_design_prd_spec as any

    await submit.execute({
      design_system: "custom financial dashboard",
      tech_stack: ["React", "mock API"],
      product_spec: "完整产品规格",
      frontend_spec: "完整前端规格",
      visual_consistency_spec: "视觉一致性规格",
      backend_spec: "后端/API 规格",
      prd_iteration_notes: ["pass 1 inventory complete", "pass 2 implementation handoff complete"],
      completeness_review: "PRD/SPEC complete enough for handoff",
      reference_artifacts: ["mirror/reference.png", "mirror/prd-evidence-summary.md"],
      open_questions: [],
    }, {})

    const collector = kit.getCollector()
    expect(collector.final?.visual_consistency_spec).toBe("视觉一致性规格")
    expect(collector.final?.prd_iteration_notes).toHaveLength(2)
  })

  test("agent exposes direct PRD/SPEC submit instead of register tools", () => {
    const tools = DesignAnalystTestHooks.selectDesignSubmitTool(createDesignOutputTools())

    expect(Object.keys(tools)).toEqual(["submit_design_prd_spec"])
    expect(Object.keys(tools).some((name) => name.startsWith("register_"))).toBe(false)
  })

  test("agent keeps evidence read tools available before PRD/SPEC submission", () => {
    expect(DesignAnalystTestHooks.shouldScopeDesignSubmitTool()).toBe(false)
  })
})
