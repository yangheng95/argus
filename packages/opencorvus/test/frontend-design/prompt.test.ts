import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PNG } from "pngjs"
import { FrontendDesignTestHooks } from "../../src/frontend-design/agent"
import { createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"
import { MIRROR_ANALYSIS_TOOL_IDS } from "../../src/mirror/tools/ids"
import { generateWebCloneSkeletonProject } from "../../src/web-clone"

describe("frontend-design prompt assembly", () => {
  test("core prompt pins maintainable rawproject refactor algorithm", async () => {
    const prompt = await fs.readFile(path.join(process.cwd(), "src", "prompt", "core", "frontend-design-core.txt"), "utf8")

    expect(prompt).toContain("## Maintainable Rawproject Refactor Algorithm")
    expect(prompt).toContain("Source map")
    expect(prompt).toContain("Region map")
    expect(prompt).toContain("Baseline-first iteration loop")
    expect(prompt).toContain("sourceDomIterationState.ts")
    expect(prompt).toContain("nextSourceDomReplacement")
    expect(prompt).toContain("Replacement decision")
    expect(prompt).toContain("Vertical slice")
    expect(prompt).toContain("Stop condition")
    expect(prompt).toContain("maintainable_replacement_required")
    expect(prompt).not.toContain("Do not loop through render/evaluation attempts")
    expect(prompt).toContain("Do not change other agent prompts, communication paths, evaluator scoring, runtime source packages, or generated outputs")
    expect(prompt).not.toContain("overallScore >=80/100")
    expect(prompt).not.toContain("100/100")
    expect(prompt).not.toContain("96/100")
  })

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
          reuse_source: "frontend-design-skeleton/src/components/SourceClonePage.tsx",
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
          reuse_source: "frontend-design-skeleton/src/components/SourceClonePage.tsx",
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

  test("host-prepared submit tool accepts empty input and materializes source-baseline handoff", async () => {
    const kit = createFrontendTemplateOutputTools({ autoIteration: true })
    const tools = FrontendDesignTestHooks.selectFrontendTemplateSubmitTool(kit, {
      status: "created",
      projectRoot: "C:\\tmp\\project\\frontend-design-skeleton",
      sourcePackage: "C:\\tmp\\project\\web-clone-source",
      projectRootRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton",
      sourcePackageRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source",
      entrypoints: ["README.md", "index.html", "src/App.tsx", "src/styles.css"],
      generationTool: "host-prepared:create_frontend_skeleton_project",
      warnings: [],
      compactEvidence: "compact source evidence",
      sourceAuditEvidence: [
        "Host-prepared source audit supervision.",
        "- visual_baseline_allowed: passed=true; generatedBaseline=true; finalBaselineOnly=false; sourceDomRegions=3; largestSourceDomRegionBytes=1200; oversizedGeneratedRegions=0",
        "- maintainable_replacement_required: passed=false; generatedBaseline=true; finalBaselineOnly=true; sourceDomRegions=3; largestSourceDomRegionBytes=1200; oversizedGeneratedRegions=0",
      ].join("\n"),
      sourceReplacementPlan: [
        {
          regionComponentName: "FooterRegion",
          regionFilePath: "src/components/source-dom/FooterRegion.tsx",
          priority: "high",
          replacementKind: "navigation_or_footer_component",
          dataSources: ["src/data/sourceData.ts"],
          assetSources: [],
          parityGuard: "footer visual parity",
        },
      ],
    } as any)

    const result = await (tools.submit_frontend_template as any).execute({}, {})

    expect(result).toContain("OK")
    expect(kit.getCollector().final?.frontend_project.role).toBe("source_baseline_input")
    expect(kit.getCollector().final?.frontend_project.project_root).toContain("frontend-design-skeleton")
    expect(kit.getCollector().final?.quality_project_contract).toContain("root-level")
    expect(kit.getCollector().final?.quality_project_contract).toContain("PRD")
    expect(kit.getCollector().final?.quality_project_contract).toContain("measured visual evidence")
    expect(kit.getCollector().final?.quality_project_contract).toContain("source audit has zero findings before claiming final maintainability")
    expect(kit.getCollector().final?.quality_project_contract).toContain("deferred source-dom region remains source debt")
    expect(kit.getCollector().final?.quality_project_contract).toContain("desktop-reference 1440x900")
    expect(kit.getCollector().final?.quality_project_contract).toContain("mobile-review 390x844")
    expect(kit.getCollector().final?.quality_project_contract).toContain("Current source audit supervision")
    expect(kit.getCollector().final?.quality_project_contract).toContain("maintainable_replacement_required: passed=false")
    expect(kit.getCollector().final?.visual_consistency_contract).toContain("measured webpage_evaluate evidence")
    expect(kit.getCollector().final?.visual_consistency_contract).toContain("wide-review 1920x1080")
    expect(JSON.stringify(kit.getCollector().final)).not.toContain("100/100")
    expect(JSON.stringify(kit.getCollector().final)).not.toContain("overallScore >=80/100")
    expect(kit.getCollector().final?.component_inventory).toContain("Compatibility summary only")
    expect(kit.getCollector().final?.component_reuse_plan.map((item) => item.family_id)).toContain("comp-source-region-replacements")
    expect(kit.getCollector().final?.baseline_replacement_plan[0]?.source_region).toContain("FooterRegion")
    expect(kit.getCollector().final?.completeness_review).toContain("Public report handoff")
    expect(kit.getCollector().final?.completeness_review).toContain("maintainable_replacement_required")
    expect(kit.getCollector().final?.completeness_review).toContain("Deferred regions are unfinished source debt")
    expect(kit.getCollector().final?.completeness_review).toContain("Current source audit supervision")
    expect(kit.getCollector().final?.completeness_review).toContain("visual_baseline_allowed: passed=true")
    expect(kit.getCollector().final?.completeness_review).toContain("source-region")
    expect(kit.getCollector().final?.completeness_review).toContain("Known issue discipline")
    expect(kit.getCollector().final?.completeness_review).toContain("Known source issue: FooterRegion")
    expect(kit.getCollector().final?.completeness_review).toContain("reuse project components or mature libraries")
    expect(kit.getCollector().final?.completeness_review).toContain("PRD delta handoff")
    expect(kit.getCollector().final?.final_delivery_mode).toBe("maintainable_replacement_required")
    expect(JSON.stringify(kit.getCollector().final)).not.toContain("TradingView")
    expect(JSON.stringify(kit.getCollector().final)).not.toContain("SQLite")
    expect(JSON.stringify(kit.getCollector().final)).not.toContain("GDP")
    expect(kit.getCollector().final?.template_iteration_notes).toHaveLength(2)

    const report = kit.buildReport()
    expect(report.detail).toContain("## Implementation Problems And Agent Handoff")
    expect(report.detail).toContain("Public report handoff")
    expect(report.detail).toContain("sourceDomReplacementPlan.ts")
    expect(report.detail).toContain("## Source Region Evolution Plan")
  })

  test("host-prepared maintainable submit materializes page-level evolution plan when no region plan exists", async () => {
    const kit = createFrontendTemplateOutputTools({ autoIteration: true })
    const tools = FrontendDesignTestHooks.selectFrontendTemplateSubmitTool(kit, {
      status: "created",
      projectRoot: "C:\\tmp\\project\\frontend-design-skeleton",
      sourcePackage: "C:\\tmp\\project\\web-clone-source",
      projectRootRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton",
      sourcePackageRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source",
      entrypoints: ["README.md", "index.html", "src/App.tsx", "src/styles.css"],
      generationTool: "host-prepared:create_frontend_skeleton_project",
      warnings: [],
      compactEvidence: "compact source evidence with RightToolbar",
      sourceReplacementPlan: [],
    } as any)

    const result = await (tools.submit_frontend_template as any).execute({
      final_delivery_mode: "maintainable_replacement_required",
    }, {})

    expect(result).toContain("OK")
    expect(kit.getCollector().final?.baseline_replacement_plan[0]?.boundary_id).toBe("source-page-baseline")
    expect(kit.getCollector().final?.baseline_replacement_plan[0]?.component_family_id).toBe("comp-source-page-baseline")
    expect(kit.getCollector().final?.baseline_replacement_plan[0]?.source_refs.join("\n")).toContain("frontend-design-skeleton/src/components/SourceClonePage.tsx")
    expect(kit.buildReport().detail).toContain("source-page-baseline")
  })

  test("host-prepared submit cannot downgrade rawproject refactoring to visual baseline", async () => {
    const kit = createFrontendTemplateOutputTools({ autoIteration: true })
    const tools = FrontendDesignTestHooks.selectFrontendTemplateSubmitTool(kit, {
      status: "created",
      projectRoot: "C:\\tmp\\project\\frontend-design-skeleton",
      sourcePackage: "C:\\tmp\\project\\web-clone-source",
      projectRootRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton",
      sourcePackageRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source",
      entrypoints: ["README.md", "index.html", "src/App.tsx", "src/styles.css"],
      generationTool: "host-prepared:create_frontend_skeleton_project",
      warnings: [],
      compactEvidence: "compact source evidence",
      sourceReplacementPlan: [],
    } as any)

    const result = await (tools.submit_frontend_template as any).execute({
      final_delivery_mode: "visual_baseline_allowed",
    }, {})

    expect(result).toContain("OK")
    expect(kit.getCollector().final?.final_delivery_mode).toBe("maintainable_replacement_required")
    expect(kit.getCollector().final?.quality_project_contract).toContain("human-maintainable")
    expect(kit.getCollector().final?.completeness_review).toContain("maintainable_replacement_required")
    expect(kit.buildReport().detail).toContain("source-page-baseline")
  })

  test("host-prepared submit tolerates markdown string lists from provider retries", async () => {
    const kit = createFrontendTemplateOutputTools({ autoIteration: true })
    const tools = FrontendDesignTestHooks.selectFrontendTemplateSubmitTool(kit, {
      status: "created",
      projectRoot: "C:\\tmp\\project\\frontend-design-skeleton",
      sourcePackage: "C:\\tmp\\project\\web-clone-source",
      projectRootRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton",
      sourcePackageRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source",
      entrypoints: ["README.md", "index.html", "src/App.tsx", "src/styles.css"],
      generationTool: "host-prepared:create_frontend_skeleton_project",
      warnings: [],
      compactEvidence: "compact source evidence with RightToolbar",
      sourceReplacementPlan: [],
    } as any)

    const result = await (tools.submit_frontend_template as any).execute({
      implementation_risks: "- right toolbar may be outside viewport\n- exact mobile breakpoint unknown",
      agent_handoff_notes: "- reuse source baseline first\n- keep PRD deltas scoped",
      open_questions: "- right toolbar capture ambiguity\n- exact 1600px max width",
    }, {})

    expect(result).toContain("OK")
    expect(kit.getCollector().final?.open_questions).toEqual([
      "right toolbar capture ambiguity",
      "exact 1600px max width",
    ])
    expect(kit.getCollector().final?.completeness_review).toContain("Implementation risk: right toolbar may be outside viewport")
    expect(kit.getCollector().final?.completeness_review).toContain("Handoff note: reuse source baseline first")
  })

  test("agent keeps evidence read tools available before frontend template submission", () => {
    expect(FrontendDesignTestHooks.shouldScopeFrontendTemplateSubmitTool()).toBe(false)
    expect(FrontendDesignTestHooks.shouldScopeFrontendTemplateSubmitTool({ hostPrepared: true })).toBe(true)
    expect(FrontendDesignTestHooks.shouldScopeFrontendTemplateSubmitTool({ textOnlyNoVisualSource: true })).toBe(true)
    expect(FrontendDesignTestHooks.shouldScopeFrontendTemplateSubmitTool({
      hostPrepared: false,
      textOnlyNoVisualSource: false,
    })).toBe(false)
  })

  test("text-only turns pin frontend_design to direct public report submission", () => {
    expect(FrontendDesignTestHooks.isTextOnlyNoVisualSource({
      request: "Build a docs landing page from this written brief.",
    })).toBe(true)
    expect(FrontendDesignTestHooks.isTextOnlyNoVisualSource({
      request: "Clone https://example.com/docs",
    })).toBe(false)
    expect(FrontendDesignTestHooks.isTextOnlyNoVisualSource({
      request: "Clone the attached screenshot",
      attachments: [{ mime: "image/png", intent: "visual_reference" }],
    })).toBe(false)

    const prompt = FrontendDesignTestHooks.buildUserPrompt(
      { title: "Text page", request: "Build a docs landing page from this written brief." },
      false,
    )

    expect(prompt).toContain("Text-only frontend_design turn")
    expect(prompt).toContain("Produce the public frontend_design report directly from the textual brief")
  })

  test("text-only submit tool materializes the public report from the brief", async () => {
    const kit = createFrontendTemplateOutputTools({ autoIteration: true })
    const tools = FrontendDesignTestHooks.selectFrontendTemplateSubmitTool(kit, undefined, {
      textOnlyBrief: {
        title: "Docs page",
        request: "Build a docs page with a dark navy hero and teal CTA.",
      },
    })

    const result = await (tools.submit_frontend_template as any).execute({}, {})

    expect(result).toContain("OK")
    expect(kit.getCollector().final?.frontend_template).toContain("dark navy hero")
    expect(kit.getCollector().final?.component_reuse_plan[0]?.family_id).toBe("comp-text-brief-page")
    expect(kit.getCollector().final?.completeness_review).toContain("Text-only public report handoff")
    expect(kit.getCollector().final?.open_questions.join("\n")).toContain("No visual screenshot")
    expect(kit.buildReport().detail).toContain("## Implementation Problems And Agent Handoff")
  })

  test("host-prepared prompt embeds compact evidence and forbids unavailable discovery tools", () => {
    const prompt = FrontendDesignTestHooks.buildUserPrompt(
      { title: "Reference page", request: "clone https://example.com/product" },
      false,
      {
        status: "created",
        projectRoot: "frontend-design-skeleton",
        sourcePackage: "web-clone-source",
        projectRootRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/frontend-design-skeleton",
        sourcePackageRef: ".opencorvus/runtime/tasks/tsk_test/frontend-design/web-clone-source",
        entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
        generationTool: "host-prepared:create_frontend_skeleton_project",
        warnings: [],
        compactEvidence: [
          "## source-ir/component-tree.json",
          "{\"components\":[{\"name\":\"ProductPage\"}]}",
          "## source-ir/content-model.json",
          "{\"lists\":[{\"name\":\"Feature list\"}]}",
        ].join("\n"),
      } as any,
    )

    expect(prompt).toContain("This is a terminal-only host-prepared turn")
    expect(prompt).toContain("`read_file`, `list_files`, shell, browser, and mirror acquisition tools are intentionally unavailable")
    expect(prompt).toContain("## source-ir/component-tree.json")
    expect(prompt).toContain("## source-ir/content-model.json")
    expect(prompt).toContain("Only `submit_frontend_template` is available")
    expect(prompt).toContain("schema is intentionally lightweight")
    expect(prompt).toContain("public frontend_design report")
    expect(prompt).toContain("terminal report")
    expect(prompt).toContain("Do not output a standalone component checklist")
    expect(prompt).toContain("maintainable rawproject refactor algorithm")
    expect(prompt).toContain("source map, region map, one replacement decision per region")
    expect(prompt).toContain("vertical-slice replacement with source data extraction")
    expect(prompt).toContain("scoped style ownership")
    expect(prompt).toContain("generated fixed-layout cleanup")
    expect(prompt).toContain("desktop-reference 1440x900")
    expect(prompt).toContain("mobile-review 390x844")
    expect(prompt).toContain("wide-review 1920x1080")
    expect(prompt).toContain("source-region traceable refactoring")
    expect(prompt).toContain("rawproject source nodes/regions/assets/reference screenshots")
    expect(prompt).toContain("A region replacement is complete only after source data extraction")
    expect(prompt).toContain("measured webpage_evaluate evidence")
    expect(prompt).toContain("zero-finding web_clone_source_audit evidence")
    expect(prompt).toContain("Do not alter evaluators, other agent prompts, communication paths, generated outputs, or runtime source packages to satisfy the report.")
    expect(prompt).toContain("Mirror/source evidence stays in task runtime paths")
    expect(prompt).toContain("Do not instruct downstream agents to move or clean `web-clone-source/`")
    expect(prompt).toContain("reuse existing repository components/design-system primitives")
    expect(prompt).toContain("mature maintained libraries for hard UI domains")
    expect(prompt).toContain("Host-prepared webpage rawproject refinement stays in `final_delivery_mode=maintainable_replacement_required`")
    expect(prompt).toContain("deferred regions must be reported as unfinished source debt")
    expect(prompt).not.toContain("use `visual_baseline_allowed` only when the operator explicitly accepts captured source regions")
    expect(prompt).toContain("sourceDomIterationState.ts")
    expect(prompt).toContain("sourceDomReplacementPlan.ts")
    expect(prompt).toContain("sourceDomRegions.ts")
    expect(prompt).toContain("sourceSvgAssetGroups.ts")
    expect(prompt).toContain("sourceFaqGroups.ts")
    expect(prompt).toContain("PRD delta boundaries")
    expect(prompt.toLowerCase()).not.toContain("gate")
    expect(prompt).not.toContain("new webpage build")
    expect(prompt).not.toContain("from scratch")
    expect(prompt).not.toContain("blank page")
    expect(prompt).not.toContain("freehand")
    expect(prompt).not.toContain("greenfield")
    expect(prompt).not.toContain("overallScore >=80/100")
    expect(prompt).not.toContain("100/100")
    expect(prompt).not.toContain("TradingView")
    expect(prompt).not.toContain("world-economy")
  })

  test("host-prepared source project summary exposes replacement sidecars and known region work", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-source-summary-"))
    try {
      await fs.mkdir(path.join(dir, "src", "data"), { recursive: true })
      await fs.mkdir(path.join(dir, "src", "components", "source-dom"), { recursive: true })
      await fs.mkdir(path.join(dir, "src", "styles"), { recursive: true })
      await fs.mkdir(path.join(dir, "public", "assets"), { recursive: true })
      await fs.writeFile(path.join(dir, "src", "components", "source-dom", "NewsRegion.tsx"), "export function NewsRegion() { return null }\n")
      await fs.writeFile(path.join(dir, "src", "styles", "source-critical.css"), ".page{}\n")
      await fs.writeFile(path.join(dir, "src", "data", "sourceData.ts"), "export const sourceLists = [] as const\n")
      await fs.writeFile(path.join(dir, "src", "data", "svgPaths.ts"), "export const svgPaths = {} as const\n")
      await fs.writeFile(path.join(dir, "src", "data", "sourceSvgAssetGroups.ts"), "export const sourceSvgAssetGroups = {} as const\n")
      await fs.writeFile(path.join(dir, "src", "data", "sourceFaqGroups.ts"), "export const sourceFaqGroups = {} as const\n")
      await fs.writeFile(path.join(dir, "src", "data", "sourceDomRegions.ts"), "export const sourceDomRegions = [] as const\n")
      await fs.writeFile(path.join(dir, "src", "data", "sourceProjectManifest.json"), JSON.stringify({
        sourceDomRegions: {
          count: 12,
          largestBytes: 44123,
          highPriorityCount: 3,
          replacementPlanCount: 2,
          iterationStateModule: "src/data/sourceDomIterationState.ts",
          semanticReplacementCount: 1,
          svgAssetGroupCount: 1,
          faqGroupCount: 1,
        },
        semanticReplacements: {
          count: 1,
          iterationStateModule: "src/data/sourceDomIterationState.ts",
          components: ["ExistingNewsList"],
        },
        visualIteration: {
          referenceImage: "reference.png",
          comparisonTool: "webpage_evaluate",
          viewportMatrix: [
            {
              name: "desktop-reference",
              width: 1440,
              height: 900,
              evidenceRole: "primary_reference",
              comparison: "Run measured webpage_evaluate against web-clone-source/reference.png after each region replacement.",
            },
          ],
          rule: "Use desktop-reference before claiming final parity.",
        },
      }, null, 2))
      await fs.writeFile(path.join(dir, "src", "data", "sourceDomIterationState.ts"), [
        "export const sourceDomIterationState = " + JSON.stringify({
          generatedRegionCount: 12,
          semanticReplacementCount: 1,
          remainingRegionCount: 11,
          nextReplacement: {
            regionComponentName: "NewsRegion",
            regionFilePath: "src/components/source-dom/NewsRegion.tsx",
            priority: "high",
            replacementKind: "event_or_news_list_component",
            recommendedComponentName: "NewsList",
            firstReplacementStep: "Render NewsList from source lists and preserve density.",
            parityGuard: "Compare against reference.png before deleting NewsRegion.",
          },
        }, null, 2) + " as const",
        "",
      ].join("\n"))
      await fs.writeFile(path.join(dir, "src", "data", "sourceDomReplacementPlan.ts"), [
        "export const sourceDomReplacementPlan = " + JSON.stringify([
          {
            regionComponentName: "NewsRegion",
            regionFilePath: "src/components/source-dom/NewsRegion.tsx",
            priority: "high",
            replacementKind: "event_or_news_list_component",
            dataSources: ["src/data/sourceData.ts", "sourceLists"],
            assetSources: ["public/assets/images/"],
            firstReplacementStep: "Render NewsList from source lists and preserve density.",
            parityGuard: "Compare against reference.png before deleting NewsRegion.",
          },
        ], null, 2) + " as const",
        "",
      ].join("\n"))

      const summary = await FrontendDesignTestHooks.summarizeHostPreparedSourceProject(dir)

      expect(summary).toContain("Source-dom region stats")
      expect(summary).toContain("Visual iteration matrix")
      expect(summary).toContain("desktop-reference: 1440x900")
      expect(summary).toContain("comparisonTool: webpage_evaluate")
      expect(summary).toContain("largestBytes: 44123")
      expect(summary).toContain("Maintainable iteration state")
      expect(summary).toContain("remainingRegionCount: 11")
      expect(summary).toContain("nextReplacement: NewsRegion -> NewsList")
      expect(summary).toContain("sourceDomIterationState.ts")
      expect(summary).toContain("sourceDomReplacementPlan.ts")
      expect(summary).toContain("sourceFaqGroups.ts")
      expect(summary).toContain("NewsRegion: priority=high")
      expect(summary).toContain("firstReplacementStep: Render NewsList")
      expect(summary).toContain("Handoff rule")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("host-prepared compact evidence indexes large source files without inlining them", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-compact-evidence-"))
    const sourcePackage = path.join(dir, "web-clone-source")
    const projectRoot = path.join(dir, "frontend-design-skeleton")
    try {
      await fs.mkdir(path.join(sourcePackage, "source-ir"), { recursive: true })
      await fs.mkdir(path.join(sourcePackage, "source-skeleton"), { recursive: true })
      await fs.mkdir(path.join(projectRoot, "src", "data"), { recursive: true })
      await fs.mkdir(path.join(projectRoot, "src", "styles"), { recursive: true })
      await fs.mkdir(path.join(projectRoot, "src", "components", "source-dom"), { recursive: true })
      await fs.mkdir(path.join(projectRoot, "public", "assets"), { recursive: true })

      const png = new PNG({ width: 12, height: 12 })
      png.data.fill(255)
      await fs.writeFile(path.join(sourcePackage, "reference.png"), PNG.sync.write(png))
      await fs.writeFile(path.join(projectRoot, "src", "data", "sourceProjectManifest.json"), JSON.stringify({
        sourceDomRegions: { count: 1, largestBytes: 65000, highPriorityCount: 1, replacementPlanCount: 1, iterationStateModule: "src/data/sourceDomIterationState.ts" },
      }))
      await fs.writeFile(path.join(projectRoot, "src", "data", "sourceDomIterationState.ts"), [
        "export const sourceDomIterationState = " + JSON.stringify({
          generatedRegionCount: 1,
          semanticReplacementCount: 0,
          remainingRegionCount: 1,
          nextReplacement: {
            regionComponentName: "HugeRegion",
            regionFilePath: "src/components/source-dom/HugeRegion.tsx",
            priority: "high",
            replacementKind: "baseline_defer",
            recommendedComponentName: "HugeRegion",
            firstReplacementStep: "Keep baseline until parity is proven.",
          },
        }) + " as const",
        "",
      ].join("\n"))
      await fs.writeFile(path.join(projectRoot, "src", "data", "sourceDomReplacementPlan.ts"), [
        "export const sourceDomReplacementPlan = " + JSON.stringify([
          {
            regionComponentName: "HugeRegion",
            regionFilePath: "src/components/source-dom/HugeRegion.tsx",
            priority: "high",
            replacementKind: "baseline_defer",
            firstReplacementStep: "Keep baseline until parity is proven.",
          },
        ]) + " as const",
        "",
      ].join("\n"))
      await fs.writeFile(path.join(projectRoot, "src", "data", "sourceData.ts"), [
        "export const sourceLists = [",
        ...Array.from({ length: 200 }, (_, index) => `  "HUGE_INLINE_MARKER_${index}",`),
        "] as const",
        "",
      ].join("\n"))

      const compact = await FrontendDesignTestHooks.readHostPreparedCompactEvidence({ sourcePackage, projectRoot })

      expect(compact).toContain("reference-pixel-summary.md")
      expect(compact).toContain("source-project-handoff-summary.md")
      expect(compact).toContain("sourceDomIterationState.ts")
      expect(compact).toContain("nextReplacement: HugeRegion")
      expect(compact).toContain("host-prepared-evidence-index.md")
      expect(compact).toContain("frontend-design-skeleton/src/data/sourceData.ts")
      expect(compact).toContain("Large source files are not inlined")
      expect(compact).not.toContain("HUGE_INLINE_MARKER")
      expect(compact).not.toContain("[clipped:")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("host-prepared source audit supervision distinguishes visual baseline from maintainable final", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-source-audit-"))
    try {
      const sourcePackage = await writeAuditFixtureSourcePackage(dir)
      const projectRoot = path.join(dir, "frontend-design-skeleton")
      await generateWebCloneSkeletonProject({
        sourcePackageDir: sourcePackage,
        outputDir: projectRoot,
      })

      const summary = await FrontendDesignTestHooks.summarizeHostPreparedSourceAudit({ sourcePackage, projectRoot })

      expect(summary).toContain("Host-prepared source audit supervision")
      expect(summary).toContain("visual_baseline_allowed: passed=true")
      expect(summary).toContain("maintainable_replacement_required: passed=false")
      expect(summary).toContain("generatedBaseline=true")
      expect(summary).toContain("finalBaselineOnly=true")
      expect(summary).toContain("A maintainable final remains unproven")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("reference pixel summary exposes light first viewport separately from dark localized bands", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-reference-pixels-"))
    try {
      const file = path.join(dir, "reference.png")
      const png = new PNG({ width: 40, height: 1100 })
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const idx = (y * png.width + x) * 4
          const value = y < 900 ? 255 : 16
          png.data[idx] = value
          png.data[idx + 1] = value
          png.data[idx + 2] = value
          png.data[idx + 3] = 255
        }
      }
      await fs.writeFile(file, PNG.sync.write(png))

      const summary = await FrontendDesignTestHooks.summarizeReferencePixels(file)

      expect(summary).toContain("Source: reference.png (40x1100)")
      expect(summary).toContain("first viewport (0-900): light")
      expect(summary).toContain("bottom band")
      expect(summary).toContain(": dark;")
      expect(summary).toContain("Detected localized dark horizontal bands")
      expect(summary).toContain("Theme evidence: the visible first viewport/main fold is light")
      expect(summary).toContain("Dark CSS/token frequency maps to localized")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
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

async function writeAuditFixtureSourcePackage(root: string): Promise<string> {
  const sourcePackage = path.join(root, "web-clone-source")
  await fs.mkdir(path.join(sourcePackage, "source-skeleton"), { recursive: true })
  await fs.mkdir(path.join(sourcePackage, "source-ir"), { recursive: true })

  const png = new PNG({ width: 1, height: 1 })
  png.data.fill(255)
  const referenceBytes = PNG.sync.write(png)
  await fs.writeFile(path.join(sourcePackage, "reference.png"), referenceBytes)
  await fs.writeFile(path.join(sourcePackage, "source-skeleton", "index.html"), `
    <!doctype html>
    <html>
      <body data-reference-image="../reference.png">
        <main class="economic-calendar" data-source-segment-id="segment-main">
          <nav><a href="/markets">Markets</a></nav>
          <section>
            <h1>Economic calendar</h1>
            <table>
              <thead><tr><th>Time</th><th>Country</th><th>Event</th><th>Actual</th></tr></thead>
              <tbody>
                <tr><td>08:30</td><td>US</td><td>GDP Growth Rate</td><td>2.1%</td></tr>
                <tr><td>09:45</td><td>US</td><td>Manufacturing PMI</td><td>51.3</td></tr>
              </tbody>
            </table>
          </section>
        </main>
      </body>
    </html>
  `)
  await fs.writeFile(path.join(sourcePackage, "source-skeleton", "critical.css"), `
    .economic-calendar { display: grid; grid-template-columns: 180px 1fr; gap: 16px; color: #111827; }
    table { border-collapse: collapse; width: 100%; }
  `)
  await fs.writeFile(path.join(sourcePackage, "source-ir", "component-tree.json"), JSON.stringify({
    version: 1,
    purpose: "web-clone-component-tree",
    components: [
      { id: "segment-nav", name: "NavigationRegion", textPreview: ["Markets"] },
      { id: "segment-main", name: "EconomicCalendarSection", textPreview: ["Economic calendar", "08:30", "GDP Growth Rate"] },
    ],
  }, null, 2))
  await fs.writeFile(path.join(sourcePackage, "source-ir", "content-model.json"), JSON.stringify({
    version: 1,
    purpose: "web-clone-content-model",
    tables: [{
      nodeId: "table-1",
      headers: ["Time", "Country", "Event", "Actual"],
      rows: [
        ["08:30", "US", "GDP Growth Rate", "2.1%"],
        ["09:45", "US", "Manufacturing PMI", "51.3"],
      ],
    }],
    lists: [],
    cards: [],
    controls: [],
    links: [{ nodeId: "link-1", text: "Markets", href: "/markets" }],
    media: [],
    repeatedGroups: [{
      parentNodeId: "tbody-1",
      count: 2,
      sampleTexts: ["08:30 US GDP Growth Rate 2.1%", "09:45 US Manufacturing PMI 51.3"],
    }],
    stats: {
      totalTables: 1,
      totalLists: 0,
      totalCards: 0,
      totalRepeatedGroups: 1,
    },
  }, null, 2))
  const referenceSha256 = createHash("sha256").update(referenceBytes).digest("hex")
  await fs.writeFile(path.join(sourcePackage, "web-clone-source-manifest.json"), JSON.stringify({
    version: 1,
    purpose: "web-clone-visible-source-package",
    provenance: {
      source: "mirror",
      mirrorDir: sourcePackage,
      reference: { path: "reference.png", sha256: referenceSha256, width: 1, height: 1, bytes: referenceBytes.length },
    },
    files: [{ path: "reference.png", sha256: referenceSha256, bytes: referenceBytes.length, source: "mirror/reference.png" }],
  }, null, 2))
  return sourcePackage
}
