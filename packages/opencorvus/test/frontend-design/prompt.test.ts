import { describe, expect, test } from "bun:test"
import { FrontendDesignTestHooks } from "../../src/frontend-design/agent"
import { createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"
import { MIRROR_ANALYSIS_TOOL_IDS } from "../../src/mirror/tools/ids"

describe("frontend-design prompt assembly", () => {
  test("live URL tasks do not inline system URL screenshots", async () => {
    const parts = await FrontendDesignTestHooks.buildPromptParts({
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
    expect(parts[0]?.text).toContain("Use the matched webpage reference skill")
    expect(parts[0]?.text).toContain("assistant.auto_iteration=false")
    expect(parts[0]?.text).not.toContain("webpage_extract")
    expect(parts[0]?.text).not.toContain("webpage_compile")
    expect(parts[0]?.text).not.toContain("webpage_analyze")
    expect(parts[0]?.text).not.toContain("[inlined as file part]")
  })

  test("terminal frontend template submit tool accepts bounded review notes when auto iteration is off", async () => {
    const kit = createFrontendTemplateOutputTools()
    const submit = kit.tools.submit_frontend_template as any

    await submit.execute({
      design_system: "custom financial dashboard",
      tech_stack: ["React", "mock API"],
      final_delivery_mode: "visual_baseline_allowed",
      frontend_template: "frontend replica scope",
      fillable_modules: "frontend implementation source handoff",
      component_inventory: "component inventory",
      component_reuse_plan: [
        {
          family_id: "comp-chart-panel",
          name: "Chart panel",
          observed_surface: "Primary chart panel",
          source_refs: ["mirror/reference.png"],
          implementation_strategy: "extracted_baseline_defer",
          reuse_source: "frontend-design-skeleton/src/generated/singlefile-body.html",
          mature_library_candidates: [],
          props_states: "static baseline until replacement keeps parity",
          replacement_boundary: "main chart DOM subtree",
          parity_guard: "desktop reference screenshot remains within threshold",
          custom_fallback_reason: "not applicable",
        },
      ],
      material_inventory: "material inventory",
      visual_consistency_contract: "visual consistency contract",
      ui_data_contract: "UI data contract",
      template_iteration_notes: ["bounded inventory and implementation review complete"],
      completeness_review: "frontend template complete enough for handoff",
      reference_artifacts: ["mirror/reference.png", "mirror/prd-evidence-summary.md"],
      open_questions: [],
    }, {})

    const collector = kit.getCollector()
    expect(collector.final?.visual_consistency_contract).toBe("visual consistency contract")
    expect(collector.final?.template_iteration_notes).toHaveLength(1)
  })

  test("terminal frontend template submit tool requires two review notes when auto iteration is on", async () => {
    const kit = createFrontendTemplateOutputTools({ autoIteration: true })
    const submit = kit.tools.submit_frontend_template as any

    const payload = {
      design_system: "custom financial dashboard",
      tech_stack: ["React", "mock API"],
      final_delivery_mode: "visual_baseline_allowed",
      frontend_template: "frontend replica scope",
      fillable_modules: "frontend implementation source handoff",
      component_inventory: "component inventory",
      component_reuse_plan: [
        {
          family_id: "comp-chart-panel",
          name: "Chart panel",
          observed_surface: "Primary chart panel",
          source_refs: ["mirror/reference.png"],
          implementation_strategy: "extracted_baseline_defer",
          reuse_source: "frontend-design-skeleton/src/generated/singlefile-body.html",
          mature_library_candidates: [],
          props_states: "static baseline until replacement keeps parity",
          replacement_boundary: "main chart DOM subtree",
          parity_guard: "desktop reference screenshot remains within threshold",
          custom_fallback_reason: "not applicable",
        },
      ],
      material_inventory: "material inventory",
      visual_consistency_contract: "visual consistency contract",
      ui_data_contract: "UI data contract",
      template_iteration_notes: ["pass 1 inventory complete"],
      completeness_review: "frontend template complete enough for handoff",
      reference_artifacts: ["mirror/reference.png"],
      open_questions: [],
    }

    await expect(submit.execute(payload, {})).rejects.toThrow("requires at least two")

    await submit.execute({
      ...payload,
      template_iteration_notes: ["pass 1 inventory complete", "pass 2 implementation handoff complete"],
    }, {})

    expect(kit.getCollector().final?.template_iteration_notes).toHaveLength(2)
  })

  test("agent exposes direct frontend template submit instead of register tools", () => {
    const tools = FrontendDesignTestHooks.selectFrontendTemplateSubmitTool(createFrontendTemplateOutputTools())

    expect(Object.keys(tools)).toEqual(["submit_frontend_template"])
    expect(Object.keys(tools).some((name) => name.startsWith("register_"))).toBe(false)
  })

  test("agent keeps evidence read tools available before frontend template submission", () => {
    expect(FrontendDesignTestHooks.shouldScopeFrontendTemplateSubmitTool()).toBe(false)
    expect(FrontendDesignTestHooks.shouldScopeFrontendTemplateSubmitTool(true)).toBe(true)
  })

  test("host-prepared prompt embeds compact evidence and forbids unavailable discovery tools", () => {
    const prompt = FrontendDesignTestHooks.buildUserPrompt(
      { title: "TradingView", request: "clone https://www.tradingview.com/markets/world-economy/" },
      false,
      {
        status: "created",
        projectRoot: "frontend-design-skeleton",
        sourcePackage: "web-clone-source",
        entrypoints: ["README.md", "src/slots.json"],
        generationTool: "host-prepared:create_frontend_skeleton_project",
        warnings: [],
        compactEvidence: [
          "## source-ir/component-tree.json",
          "{\"components\":[{\"name\":\"MarketsPage\"}]}",
          "## source-ir/content-model.json",
          "{\"tables\":[{\"name\":\"Economic calendar\"}]}",
        ].join("\n"),
      } as any,
    )

    expect(prompt).toContain("This is a terminal-only host-prepared turn")
    expect(prompt).toContain("`read_file`, `list_files`, shell, browser, and mirror acquisition tools are intentionally unavailable")
    expect(prompt).toContain("## source-ir/component-tree.json")
    expect(prompt).toContain("## source-ir/content-model.json")
    expect(prompt).toContain("Only `submit_frontend_template` is available")
  })

  test("agent runtime exposes mirror analysis tools for missing webpage evidence", async () => {
    const tools = await FrontendDesignTestHooks.createMirrorAnalysisTools({})

    for (const id of MIRROR_ANALYSIS_TOOL_IDS) {
      expect(Object.keys(tools)).toContain(id)
    }
  })

  test("task request injection forwards the full request and points at the intent bundle", () => {
    const request = Array.from({ length: 505 }, (_, index) => `templateword${index + 1}`).join(" ")
    const prompt = FrontendDesignTestHooks.buildUserPrompt({ title: "Large template", request })

    expect(prompt).toContain("templateword500")
    expect(prompt).toContain("templateword505")
    expect(prompt).toContain(".opencorvus/runtime/tasks/<taskID>/intent/request.md")
    expect(prompt).toContain("Audit copy:")
    expect(prompt).not.toContain("Request excerpt")
  })
})
