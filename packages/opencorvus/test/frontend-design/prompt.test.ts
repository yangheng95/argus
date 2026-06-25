import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PNG } from "pngjs"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { persistTaskFrontendResearchBrief } from "../../src/engine/persist"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"
import { Worktree } from "../../src/worktree"
import { FrontendDesignTestHooks } from "../../src/frontend-design/agent"
import { createFrontendSkeletonProjectTool } from "../../src/frontend-design/skeleton-project-tool"
import { createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"
import {
  FRONTEND_DESIGN_CONTEXT_TOOL_IDS,
  FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS,
  FRONTEND_DESIGN_SESSION_TOOL_IDS,
  FRONTEND_DESIGN_WEBPAGE_EVIDENCE_TOOL_IDS,
  FRONTEND_DESIGN_UTILITY_TOOL_IDS,
} from "../../src/frontend-design/static-tools"
import { WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS } from "../../src/frontend-design/tools/ids"
import { generateWebCloneSkeletonProject } from "../../src/web-clone"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { validResearchBrief } from "../research/fixtures"

async function updatePromptTestFrontendResult(
  kit: ReturnType<typeof createFrontendTemplateOutputTools>,
  notes: readonly string[],
) {
  const tools = kit.tools as any
  await tools.update_frontend_basics.execute({
    design_system: "custom financial dashboard",
    tech_stack: ["React", "mock API"],
    final_acceptance_mode: "visual_baseline_allowed",
  })
  await tools.update_frontend_text.execute({ section: "frontend_template", content: "frontend replica scope" })
  await tools.update_frontend_text.execute({
    section: "fillable_modules",
    content: "frontend implementation source handoff",
  })
  await tools.update_frontend_text.execute({ section: "component_inventory", content: "component inventory" })
  await tools.update_frontend_component_reuse.execute({
    family_id: "comp-chart-panel",
    name: "Chart panel",
    observed_surface: "Primary chart panel",
    source_refs: ["webpage-evidence/reference.png"],
    implementation_strategy: "extracted_baseline_defer",
    reuse_source: "frontend-design-skeleton/src/components/SourceClonePage.tsx",
    mature_library_candidates: [],
    props_states: "static baseline until replacement keeps parity",
    replacement_boundary: "main chart DOM subtree",
    parity_guard: "desktop reference screenshot remains within threshold",
    project_specific_reason: "not applicable",
  })
  await tools.update_frontend_text.execute({ section: "material_inventory", content: "material inventory" })
  await tools.update_frontend_material.execute({
    title: "Reference materials",
    detail: "Use reference pixels and source artifacts needed by the frontend replica.",
    source_refs: ["webpage-evidence/reference.png"],
  })
  await tools.update_frontend_text.execute({
    section: "visual_consistency_contract",
    content: "visual consistency contract",
  })
  await tools.update_frontend_text.execute({ section: "ui_data_contract", content: "UI data contract" })
  for (const note of notes) {
    await tools.update_frontend_iteration_note.execute({ value: note })
  }
  await tools.update_frontend_text.execute({
    section: "completeness_review",
    content: "frontend template complete enough for handoff",
  })
  await tools.update_frontend_reference.execute({ value: "webpage-evidence/reference.png" })
}

describe("frontend-design prompt assembly", () => {
  test("core prompt pins visual HTML skeleton restoration workflow", async () => {
    const prompt = await fs.readFile(new URL("../../src/prompt/core/frontend-design-core.txt", import.meta.url), "utf8")

    expect(prompt).toContain("## Visual HTML Skeleton Restoration Algorithm")
    expect(prompt).toContain("Source map")
    expect(prompt).toContain("Region map")
    expect(prompt).toContain("Baseline-first restoration workflow")
    expect(prompt).toContain("normal agent tool flow")
    expect(prompt).toContain("not by creating project-internal state machines")
    expect(prompt).toContain("static first-candidate metadata")
    expect(prompt).toContain("sourceDomIterationState.ts")
    expect(prompt).toContain("nextSourceDomReplacement")
    expect(prompt).toContain("Visual skeleton drafting is screenshot-first")
    expect(prompt).toContain(
      "inspect desktop `web-clone-source/reference.png` and the current rendered skeleton screenshot",
    )
    expect(prompt).toContain("read only the direct source code/CSS/data evidence needed")
    expect(prompt).toContain("Do not spend turns reading broad source-IR inventories")
    expect(prompt).toContain("screenshot-derived visible page-region outline")
    expect(prompt).toContain("Frontend Research Page Skeleton Blueprint")
    expect(prompt).toContain("page information-architecture input")
    expect(prompt).toContain("must record those conflicts instead of inventing, reordering, or demoting major sections")
    expect(prompt).toContain("preserve its visible-flow order/count")
    expect(prompt).toContain(
      "Establish the page skeleton from `Frontend Research Page Skeleton Blueprint` when present",
    )
    expect(prompt).toContain("major content-section order/count")
    expect(prompt).toContain("not the page skeleton order")
    expect(prompt).toContain("The queue must not reorder the page")
    expect(prompt).toContain("demote major source sections into nav/footer labels")
    expect(prompt).toContain("sourceMap")
    expect(prompt).toContain("generatedCleanupTargets")
    expect(prompt).toContain("verticalSliceSteps")
    expect(prompt).toContain("Replacement decision")
    expect(prompt).toContain("Visual slice")
    expect(prompt).toContain("Stop condition")
    expect(prompt).toContain("visual_baseline_allowed")
    expect(prompt).toContain("`frontend_project.role=visual_baseline_input`")
    expect(prompt).toContain("maintainable_replacement_required")
    expect(prompt).toContain("implementation_phase_outcomes")
    expect(prompt).toContain("evidence_lock")
    expect(prompt).toContain("runtime_visual_verification")
    expect(prompt).toContain("Pre-selection browsing is only for choosing the next source region")
    expect(prompt).toContain("The candidate component read is the last source component read before selection")
    expect(prompt).toContain("reading a second `src/components/source-dom/*` file")
    expect(prompt).toContain("any `src/components/semantic/*` file")
    expect(prompt).toContain(
      "When the candidate is a large table/map/content region, do not read neighboring generated regions or global header/footer semantic components before selection",
    )
    expect(prompt).toContain(
      "when the candidate is `HeaderNavigation`, reading `FooterNavigation`, `App.tsx`, `package.json`, `tsconfig.json`, or full source-IR/style catalogs before recording the header selection is off-process evidence hoarding",
    )
    expect(prompt).toContain("Div-soup boundary")
    expect(prompt).toContain("`<div>` is a valid semantic-neutral layout primitive")
    expect(prompt).toContain("future transcription debt rather than final app source")
    expect(prompt).toContain("`SourceDomPage`, `src/components/source-dom/*`, `src/data/sourceDom*`")
    expect(prompt).toContain("pervasive `data-source-node-id`")
    expect(prompt).toContain("Component-kind fidelity is mandatory")
    expect(prompt).toContain("chart, map, heatmap, geographic visualization")
    expect(prompt).toContain("must not be delivered as a flat copied SVG, image, or decorative vector")
    expect(prompt).toContain("All visible content in the HTML skeleton must be traceable")
    expect(prompt).toContain("later component/data transcription obligation")
    expect(prompt).toContain("data/content snippets are region-owned evidence slices")
    expect(prompt).toContain("must contain only records proven by the currently selected replacement-plan row")
    expect(prompt).toContain("Skeleton root wiring is part of region ownership")
    expect(prompt).toContain(
      "Do not call `record_frontend_region_selection` for another region until the current region has a factual `record_frontend_replacement_result`",
    )
    expect(prompt).toContain("After a region is selected, switch from evidence browsing to visual-skeleton restoration")
    expect(prompt).toContain(
      "the next file-changing action should populate or repair that region's HTML/CSS/assets/content",
    )
    expect(prompt).toContain(
      "Further reads must be limited to direct imports or explicitly named data/style/asset sidecars for that selected region only",
    )
    expect(prompt).toContain(
      "Do not exhaustively chase every `AssetPath`, `svgPaths`, `asset_*.path.txt`, CSS token, or `critical.css` variable before the first selected-region write",
    )
    expect(prompt).toContain("Selection is the start of a visual-restoration transaction")
    expect(prompt).toContain("Future regions may be named only as non-rendering comments/visual debt")
    expect(prompt).toContain("never as visible placeholder panels, fake spacers, `min-height` filler, placeholder text")
    expect(prompt).toContain("Before styling a region, inspect the reference pixel evidence for that region/viewport")
    expect(prompt).toContain(
      "wrong theme, wrong header color, wrong density, or wrong first-viewport background means the region is not ready",
    )
    expect(prompt).toContain("Completed/deferred status must cite task-scoped preview or screenshot evidence")
    expect(prompt).toContain("Do not record a region as completed from source inspection alone")
    expect(prompt).toContain("Do not record a region as completed if the skeleton contains placeholder UI")
    expect(prompt).toContain("completion requires a faithful static representation from source data/assets")
    expect(prompt).toContain("If the selected skeleton file is already a semantic component")
    expect(prompt).toContain("Preserve the source data object shape")
    expect(prompt).toContain("AssetPath`/asset resolver usage")
    expect(prompt).toContain("replace `AssetPath` with inline guessed SVG paths")
    expect(prompt).toContain(
      "For render evidence, use task-scoped preview or screenshot evidence for the HTML skeleton",
    )
    expect(prompt).toContain(
      "do not use `skill`, research reports, shell listing, build success, legacy webpage visual tool output, or external judge verdicts as a substitute",
    )
    expect(prompt).toContain("## Agent-Owned Rawproject Refinement")
    expect(prompt).toContain("frontend_design is not a report writer")
    expect(prompt).toContain("high-fidelity visual HTML skeleton")
    expect(prompt).toContain("Later workflow stages own maintainable project-source transcription")
    expect(prompt).toContain("Source authority for maintainable webpage replicas")
    expect(prompt).toContain("define user-facing semantics")
    expect(prompt).toContain("defines implementation facts")
    expect(prompt).toContain("`source-ir/style-profile.json` is the deterministic region-scoped style source")
    expect(prompt).toContain(
      "preserve the component kind and use source evidence to repair measured style/layout/assets",
    )
    expect(prompt).toContain("edit the static HTML/CSS visual skeleton")
    expect(prompt).toContain(
      "The visual HTML skeleton plus the frontend_design contract are part of the deliverable surface",
    )
    expect(prompt).toContain("Do not treat `frontend-design-skeleton` as the final app")
    expect(prompt).toContain("Baseline-first rule")
    expect(prompt).toContain("Region iteration algorithm")
    expect(prompt).toContain("inspected visual parity")
    expect(prompt).toContain(
      "Do not use a fixed numeric score, legacy webpage visual tool output, or external judge verdict as the completion condition",
    )
    expect(prompt).toContain("screenshot review shows mismatches")
    expect(prompt).toContain("VisualRegionBinding package rule")
    expect(prompt).toContain("first call `create_visual_region_coordinate_atlas`")
    expect(prompt).toContain("read the returned atlas image attachments")
    expect(prompt).toContain("call `create_visual_region_binding_package`")
    expect(prompt).toContain("real PNG crop generated by `create_visual_region_binding_package`")
    expect(prompt).toContain("bbox overlay/contact sheet image attachments")
    expect(prompt).toContain("not a handwritten SVG wrapper")
    expect(prompt).toContain("DOM parent-container crop")
    expect(prompt).toContain(
      "do not call the skeleton usable, accepted, ready, complete, or good enough for downstream transcription",
    )
    expect(prompt).toContain("no relevant placeholder/fake visual debt")
    expect(prompt).toContain("Visual token extraction protocol")
    expect(prompt).toContain("Write source-editable tokens into `visual-html-skeleton/styles/tokens.css`")
    expect(prompt).toContain("Token extraction is iterative")
    expect(prompt).toContain("Benchmark is mainline")
    expect(prompt).toContain("Visual HTML skeleton mode")
    expect(prompt).toContain("It is not an independent design source")
    expect(prompt).toContain(
      "If the skeleton conflicts with source IR, source skeleton CSS, assets, or visible pixels in `reference.png`, those original artifacts win",
    )
    expect(prompt).toContain("Process monitoring is part of the benchmark evidence")
    expect(prompt).toContain("which evidence acquisition tool ran")
    expect(prompt).toContain("which source region was selected")
    expect(prompt).toContain("off-track process defect")
    expect(prompt).toContain("Do not solve benchmark failures by suppressing audit findings")
    expect(prompt).not.toContain("Do not loop through render/evaluation attempts")
    expect(prompt).toContain(
      "Do not change other agent prompts, communication paths, evaluator scoring, runtime source packages, raw webpage evidence, or generated evidence outputs",
    )
    expect(prompt).not.toContain("overallScore >=80/100")
    expect(prompt).not.toContain("100/100")
    expect(prompt).not.toContain("loop state")
    expect(prompt.toLowerCase()).not.toContain("gate")
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
    expect(parts[0]?.text).toContain("Use the task-runtime webpage evidence and webpage evidence tools")
    expect(parts[0]?.text).toContain("do at least two frontend template review passes")
    expect(parts[0]?.text).not.toContain("webpage_extract")
    expect(parts[0]?.text).not.toContain("webpage_compile")
    expect(parts[0]?.text).not.toContain("webpage_analyze")
    expect(parts[0]?.text).not.toContain("[inlined as file part]")
  })

  test("webpage rawproject prompts make frontend_design materialize visual HTML skeleton first", () => {
    const prompt = FrontendDesignTestHooks.buildUserPrompt({
      title: "World economy replica",
      request: "Clone https://www.tradingview.com/markets/world-economy/ into a maintainable rawproject replacement.",
      taskID: "tsk_web_clone",
    })

    expect(prompt).toContain("call `create_frontend_skeleton_project`")
    expect(prompt).toContain("# Visual HTML Skeleton Contract")
    expect(prompt).toContain(
      "frontend_design's first workflow deliverable is a source-editable static HTML/CSS visual skeleton",
    )
    expect(prompt).toContain(
      'Report visual-only work through `update_frontend_project({ role: "visual_baseline_input", ... })`',
    )
    expect(prompt).toContain(
      "For production/component-system tasks, set `final_acceptance_mode=maintainable_replacement_required`",
    )
    expect(prompt).toContain("submit `implementation_phase_outcomes`")
    expect(prompt).toContain("package.json or source imports prove it")
    expect(prompt).toContain("not the implementation target or acceptance app root")
    expect(prompt).toContain(
      "if the skeleton conflicts with those artifacts or visible pixels, the original source evidence wins",
    )
    expect(prompt).toContain(
      "Later workflow stages transcribe this HTML skeleton into project source only after the skeleton is screenshot-validated",
    )
    expect(prompt).toContain("Do not pass `web-clone-target`")
    const webClonePaths = ProjectRuntimePaths.frontendDesignPaths("", "tsk_web_clone")
    const visualSkeleton = ProjectRuntimePaths.taskRelative("tsk_web_clone", "fd", "visual-html-skeleton")
    expect(prompt).toContain(visualSkeleton)
    expect(prompt).toContain("or any target app root to `create_frontend_skeleton_project`")
    expect(prompt).toContain("record_frontend_region_selection")
    expect(prompt).toContain("record_frontend_replacement_result")
    expect(prompt).toContain(`${webClonePaths.sourcePackageRelative}/`)
    expect(prompt).toContain(`${webClonePaths.skeletonProjectRelative}/`)
    expect(prompt).toContain("After the source project tool returns")
    expect(prompt).toContain("restore the static HTML/CSS skeleton")
    expect(prompt).toContain("Treat `nextSourceDomReplacement` as the first visual-region queue item")
    expect(prompt).toContain("not as a target-project extraction command")
    expect(prompt).toContain(`Default visual HTML skeleton root: \`${visualSkeleton}\``)
    expect(prompt).toContain("Report the public project root as `visual-html-skeleton`")
    expect(prompt).toContain(
      "do not name `web-clone-target`, a framework app root, or `frontend-design-skeleton` as the current workflow deliverable",
    )
    expect(prompt).toContain("visual-html-skeleton/index.html")
    expect(prompt).toContain("Root files alone are not a real frontend app")
    expect(prompt).toContain(
      "benchmark workspaces often contain minimal `package.json`, `tsconfig.json`, `data/`, `.git/`, and `.opencorvus/` shell files",
    )
    expect(prompt).toContain("those shell files should not become the skeleton deliverable")
    expect(prompt).toContain("Populate the visual HTML skeleton directly with file-edit tools")
    expect(prompt).toContain("the first editing pass is visual skeleton adoption")
    expect(prompt).toContain("create/adapt bounded static `index.html`, external CSS files, asset references")
    expect(prompt).toContain("source-editable static HTML/CSS visual skeleton")
    expect(prompt).toContain("visual-html-skeleton/styles/tokens.css")
    expect(prompt).toContain("color roles, typography, spacing/density, radii, borders, shadows/elevation")
    expect(prompt).toContain("Do not invent tokens from brand memory")
    expect(prompt).toContain("paste a giant original CSS bundle")
    expect(prompt).toContain("visible pixels plus region style-profile win")
    expect(prompt).toContain("Do not submit `dist/`, `build/`, `out/`, `/src/main.tsx`")
    expect(prompt).toContain("capture/source replay")
    expect(prompt).toContain("`SourceDomPage`/`src/components/source-dom/*` dumps")
    expect(prompt).toContain("Render that HTML skeleton through a real static harness or browser path")
    expect(prompt).toContain(
      "For high-fidelity acceptance, render the current skeleton and inspect the rendered screenshot",
    )
    expect(prompt).toContain("Do not use a fixed numeric score or external judge verdict as the completion condition")
    expect(prompt).toContain("If the task requires VisualRegionBinding or per-region source bbox bindings")
    expect(prompt).toContain("first call `create_visual_region_coordinate_atlas`")
    expect(prompt).toContain("author bbox JSON from visible screenshot region boundaries")
    expect(prompt).toContain("Do not satisfy VisualRegionBinding with handwritten SVG crop wrappers")
    expect(prompt).toContain("DOM parent-container crops")
    expect(prompt).toContain("misleading viewport-based crop filenames")
    expect(prompt).toContain(
      "do not call the skeleton accepted, ready, complete, usable, or good enough for downstream transcription",
    )
    expect(prompt).toContain("visual replacement work should happen source-region by source-region")
    expect(prompt).toContain(
      "For every major in-scope visual region, call `record_frontend_region_selection` before editing that region's HTML/CSS/assets/content",
    )
    expect(prompt).toContain(
      "Additional reads after selection must be direct imports or explicitly named data/style/asset sidecars",
    )
    expect(prompt).toContain("Do not implement by freehand redrawing")
    expect(prompt).toContain(
      "copy/transcribe observed labels, numeric data, source IDs, class responsibilities, SVG paths/assets",
    )
    expect(prompt).toContain(
      "Do not use shell listings, build success, or legacy `webpage_*` visual tools as visual evidence",
    )
    expect(prompt).toContain("Inspect task-scoped preview or screenshot evidence against the reference evidence")
    expect(prompt).toContain(
      "repair the same region before selecting another region when screenshot review names mismatches",
    )
    expect(prompt).toContain(
      "Do not use shell listings, build success, or legacy `webpage_*` visual tools as visual evidence",
    )
    expect(prompt).toContain(
      "A visual baseline must explicitly say it is source-editable static HTML/CSS, not compiled output, not raw source DOM replay",
    )
    expect(prompt).toContain(
      "Put later React/Vue/etc. project transcription constraints into `quality_project_contract`, not into the current skeleton source",
    )
    expect(prompt).not.toContain("React + Vite + TypeScript")
    expect(prompt).not.toContain("Populate the target acceptance project directly")
    expect(prompt).not.toContain("Build should receive the target project that frontend_design already populated")
    expect(prompt).not.toContain(
      "The host already prepared the frontend-design high-fidelity editable source project before this model turn.",
    )
    expect(prompt).not.toContain("Do not call `create_frontend_skeleton_project` again")
  })

  test("webpage rawproject prompts consume frontend_research page skeleton blueprint", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_frontend_design_blueprint"
    const request = "Clone https://www.tradingview.com/markets/world-economy/ into a visual HTML skeleton."
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          seedFrontendPromptTask(taskID)
          const frontendResearchPaths = ProjectRuntimePaths.frontendResearchPaths(
            "",
            taskID,
            "ses_frontend_design_blueprint",
          )
          const artifactID = persistTaskFrontendResearchBrief({
            taskID,
            brief: validResearchBrief(request, {
              summary: "Frontend research owns page skeleton facts.",
              metadata: {
                research_session_id: "ses_frontend_design_blueprint",
              },
              bundle: {
                full_markdown_path: `${frontendResearchPaths.relativeDir}/research-bundle.md`,
                evidence_json_path: `${frontendResearchPaths.relativeDir}/evidence.json`,
                citation_map_path: `${frontendResearchPaths.relativeDir}/citation-map.json`,
              },
              webpage_contract: frontendDesignPromptWebpageContract(),
            }),
            now: Date.now(),
          })

          const prompt = FrontendDesignTestHooks.buildUserPrompt({
            title: "World economy replica",
            request,
            taskID,
          })
          const evidenceRef = `frontend_research:${artifactID}:ev_1`

          expect(prompt).toContain("# Frontend Research Page Skeleton Blueprint")
          expect(prompt).toContain(`"artifact_id": "${artifactID}"`)
          expect(prompt).toContain('"page_skeleton_blueprint"')
          expect(prompt).toContain('"visible_flow"')
          expect(prompt).toContain('"region_count": 1')
          expect(prompt).toContain('"major_surfaces"')
          expect(prompt).toContain('"data_content_anchors"')
          expect(prompt).toContain('"component_kind_hypotheses"')
          expect(prompt).toContain('"hypothesis": "financial data table with tabs and filters"')
          expect(prompt).toContain(evidenceRef)
          expect(prompt).toContain(
            "Frontend_design consumes this as the page information-architecture input and materializes it into visual-html-skeleton",
          )
          expect(prompt.indexOf("# Frontend Research Page Skeleton Blueprint")).toBeLessThan(
            prompt.indexOf("# Visual HTML Skeleton Contract"),
          )
          expect(prompt).not.toContain('"webpage_contract"')
        },
      })
    } finally {
      await Instance.disposeAll()
      await resetDatabase()
    }
  }, 30_000)

  test("visual HTML skeleton prompts keep static baseline below source evidence", () => {
    const prompt = FrontendDesignTestHooks.buildUserPrompt({
      title: "Visual draft",
      request:
        "先从 https://example.com/page 抽取骨架生成 visual-only HTML design draft，只负责视觉还原，之后再转完整项目。",
      taskID: "tsk_visual_draft",
    })

    expect(prompt).toContain("# Visual HTML Skeleton Contract")
    expect(prompt).toContain("source-editable static HTML/CSS visual skeleton")
    expect(prompt).toContain("visual-html-skeleton/index.html")
    expect(prompt).toContain("visual-html-skeleton/styles/tokens.css")
    expect(prompt).toContain("Do not invent tokens from brand memory")
    expect(prompt).toContain("`final_acceptance_mode=visual_baseline_allowed`")
    expect(prompt).toContain("`frontend_project.role=visual_baseline_input`")
    expect(prompt).toContain("do not describe the HTML skeleton as Build's implementation target")
    expect(prompt).toContain("`web-clone-source/source-ir/*`")
    expect(prompt).toContain("`web-clone-source/reference.png`")
    expect(prompt).toContain("original source evidence wins")
    expect(prompt).toContain("Later workflow stages transcribe this HTML skeleton into project source")
  })

  test("skeleton project tool returns bounded source evidence entrypoints", async () => {
    await using tmp = await tmpdir()
    const sourcePackage = await writeAuditFixtureSourcePackage(tmp.path)
    const outputDir = path.join(tmp.path, "frontend-design-skeleton")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = createFrontendSkeletonProjectTool()
        const result = await (tools.create_frontend_skeleton_project as any).execute(
          {
            sourcePackageDir: sourcePackage,
            outputDir,
          },
          {},
        )

        expect(result.output).toContain("Bounded next action for frontend_design")
        expect(result.output).toContain(
          "Do not move, rename, or repurpose this skeleton output as the visual HTML skeleton or target acceptance project",
        )
        expect(result.output).toContain("sourceProjectManifest.json")
        expect(result.output).toContain("sourceDomIterationState.ts")
        expect(result.output).toContain("sourceDomReplacementPlan.ts")
        expect(result.output).toContain("Pre-selection browsing is only for choosing the next source region")
        expect(result.output).toContain(
          "The candidate component read is the last source component read before selection",
        )
        expect(result.output).toContain("do not read a second `src/components/source-dom/*` file")
        expect(result.output).toContain("any `src/components/semantic/*` file")
        expect(result.output).toContain(
          "If the candidate is a large table/map/content region, do not read neighboring generated regions or global header/footer semantic components before recording that selection",
        )
        expect(result.output).toContain(
          "If the candidate is `HeaderNavigation`, do not read `FooterNavigation`, `App.tsx`, `package.json`, `tsconfig.json`, or full source-IR/style catalogs before recording the header selection",
        )
        expect(result.output).not.toContain("target root `package.json`")
        expect(result.output).toContain(
          "Do not read `src/data/sourceData.ts`, `src/data/svgPaths.ts`, raw HTML, or generated CSS in full",
        )
        expect(result.output).toContain(
          "First populate the visual HTML skeleton with source-editable static HTML/CSS/assets",
        )
        expect(result.output).toContain("visual-html-skeleton/styles/tokens.css")
        expect(result.output).toContain("Extract visual tokens before broad region styling")
        expect(result.output).toContain("source-ir/style-tokens.json")
        expect(result.output).toContain("source-ir/style-profile.json")
        expect(result.output).toContain("Region CSS should consume `tokens.css`")
        expect(result.output).toContain("visual-html-skeleton/index.html")
        expect(result.output).toContain("This is the required pre-region visual write sequence")
        expect(result.output).toContain("Do not start from an empty app scaffold")
        expect(result.output).toContain(
          "After the visual skeleton baseline exists, render it through one explicit static URL or file path",
        )
        expect(result.output).toContain(
          "Do not run build/render inside `frontend-design-skeleton` as the final deliverable",
        )
        expect(result.output).toContain("Then call `record_frontend_region_selection`")
        expect(result.output).toContain("Skeleton writes after selection must be owned by that selected region")
        expect(result.output).not.toContain(
          "The next target-project filesystem-changing operation should be a source vertical-slice file write",
        )
        expect(result.output).not.toContain(
          "Before writing target project source, call `record_frontend_region_selection`",
        )
        expect(result.output).not.toContain("not `src/main.tsx`, global reset/theme CSS")
        expect(result.output).toContain(
          "Populate the selected HTML/CSS/assets/content slice by replacing the corresponding visual boundary",
        )
        expect(result.output).toContain("not by adding unrelated placeholder panels or future-region imports")
        expect(result.output).toContain("Data/content snippets are part of the selected region slice")
        expect(result.output).toContain(
          "do not put records from unselected footer/economy/news/calendar/FAQ/map/chart/card/list regions into the current region's data/content file",
        )
        expect(result.output).not.toContain(
          "not `src/main.tsx`, global reset/theme CSS, `bash mkdir`, `index.html`, `package.json`, `tsconfig.json`, or bundler config",
        )
        expect(result.output).not.toContain("The write tool creates parent directories for new files")
        expect(result.output).not.toContain(
          "One region selection covers only that selected region's data/component/style/assets/App wiring",
        )
        expect(result.output).toContain("then record the replacement result")
        expect(result.output).toContain("Restore the selected source component/row by transcribing its actual labels")
        expect(result.output).toContain(
          "If the selected skeleton file is already semantic, use it as source evidence first",
        )
        expect(result.output).toContain(
          "preserve source IDs, ARIA/data attributes, wrapper nesting, asset resolver usage",
        )
        expect(result.output).toContain(
          "Do not invent simplified SVGs, approximate values, generic styling, fake spacers, or labeled placeholder boxes",
        )
        expect(result.output).not.toContain("Do not run install/build/render/dev-server commands yet")
        expect(result.output).not.toContain("Package-manager commands start only after `src/App.tsx`")
        expect(result.output).not.toContain(
          "Treat root config files (`package.json`, `tsconfig.json`, bundler config) as late integration edits",
        )
        expect(result.output).toContain("render it through one explicit static URL or file path")
        expect(result.output).toContain(
          "inspect task-scoped preview or screenshot evidence against the visual skeleton and `reference.png`",
        )
        expect(result.output).toContain(
          "Do not record completed for charts, maps, tables, calendars, or other complex controls that are only labeled placeholder boxes",
        )
        expect(result.output).toContain("repair the same region from source evidence")
        expect(result.output).toContain("Do not try multiple dev/preview/Python/Vite servers")
      },
    })
  }, 30_000)

  test("frontend_design analyze toolkit includes source refinement tools", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-implementation-tools-"))
    await Instance.provide({
      directory: dir,
      fn: async () => {
        const tools = await FrontendDesignTestHooks.createFrontendImplementationTools({})
        expect(Object.keys(tools)).toEqual(expect.arrayContaining(["bash", "edit", "write", "apply_patch"]))
        expect(Object.keys(tools)).not.toContain("web_clone_source_audit")
        expect(Object.keys(tools)).not.toContain("webpage_render")
        expect(Object.keys(tools)).not.toContain("webpage_evaluate")
        expect(Object.keys(tools)).not.toContain("webpage_text_diff")
        expect(Object.keys(tools)).not.toContain("webpage_vision_judge")
      },
    })
  })

  test("skeleton project tool uses the task primary runtime defaults from a managed worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_frontend_skeleton_worktree"
    let worktreeDir = ""
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          seedFrontendPromptTask(taskID)
          const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
          await writeAuditFixtureSourcePackage(path.dirname(paths.sourcePackageAbsolute))
          const worktree = await Worktree.create({
            name: `frontend-skeleton-${Date.now().toString(36)}`,
            taskID,
            goalID: "gol_frontend_skeleton",
            runID: "run_frontend_skeleton",
          })
          worktreeDir = worktree.directory
        },
      })

      await Instance.provide({
        directory: worktreeDir,
        fn: async () => {
          const tools = createFrontendSkeletonProjectTool({ taskID })
          const result = await (tools.create_frontend_skeleton_project as any).execute({ overwrite: true }, {})
          const primaryPaths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
          const worktreePaths = ProjectRuntimePaths.frontendDesignPaths(worktreeDir, taskID)

          expect(result.metadata.outputDir).toBe(primaryPaths.skeletonProjectAbsolute)
          expect(result.metadata.webpageEvidenceDir).toBe(primaryPaths.sourcePackageAbsolute)
          expect(await Filesystem.exists(path.join(primaryPaths.skeletonProjectAbsolute, "README.md"))).toBe(true)
          expect(await Filesystem.exists(worktreePaths.skeletonProjectAbsolute)).toBe(false)
        },
      })
    } finally {
      await Instance.disposeAll()
      await resetDatabase()
    }
  }, 30_000)

  test("task-scoped skeleton project tool rejects output outside frontend-design-skeleton evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_frontend_skeleton_output_guard"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedFrontendPromptTask(taskID)
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        await writeAuditFixtureSourcePackage(path.dirname(paths.sourcePackageAbsolute))
        const tools = createFrontendSkeletonProjectTool({ taskID })
        const outsideName = `outside-${Date.now().toString(36)}`

        await expect(
          (tools.create_frontend_skeleton_project as any).execute(
            {
              outputDir: "web-clone-target",
              overwrite: true,
            },
            {},
          ),
        ).rejects.toThrow("outputDir must be the frontend-design-skeleton evidence directory")
        await expect(
          (tools.create_frontend_skeleton_project as any).execute(
            {
              outputDir: `../${outsideName}`,
              overwrite: true,
            },
            {},
          ),
        ).rejects.toThrow("outputDir must be the frontend-design-skeleton evidence directory")

        expect(await Filesystem.exists(path.join(tmp.path, "web-clone-target"))).toBe(false)
        expect(await Filesystem.exists(path.resolve(tmp.path, "..", outsideName))).toBe(false)

        const result = await (tools.create_frontend_skeleton_project as any).execute({ overwrite: true }, {})
        expect(result.metadata.outputDir).toBe(paths.skeletonProjectAbsolute)
      },
    })
  }, 30_000)

  test("frontend_design runtime tool groups are static and complete", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-static-tools-"))
    await Instance.provide({
      directory: dir,
      fn: async () => {
        const contextTools = FrontendDesignTestHooks.createFrontendDesignContextTools()
        const mirrorTools = await FrontendDesignTestHooks.createWebpageEvidenceTools({})
        const implementationTools = await FrontendDesignTestHooks.createFrontendImplementationTools({})
        const utilityTools = await FrontendDesignTestHooks.createFrontendUtilityTools({})

        expect(Object.keys(contextTools)).toEqual([...FRONTEND_DESIGN_CONTEXT_TOOL_IDS])
        expect(Object.keys(mirrorTools)).toEqual([...FRONTEND_DESIGN_WEBPAGE_EVIDENCE_TOOL_IDS])
        expect(Object.keys(implementationTools)).toEqual([...FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS])
        expect(Object.keys(utilityTools)).toEqual([...FRONTEND_DESIGN_UTILITY_TOOL_IDS])
        expect(FRONTEND_DESIGN_SESSION_TOOL_IDS).toContain("create_visual_region_coordinate_atlas")
        expect(FRONTEND_DESIGN_SESSION_TOOL_IDS).toContain("create_visual_region_binding_package")

        const tools = {
          ...implementationTools,
          ...contextTools,
          ...utilityTools,
          ...mirrorTools,
        }
        expect(Object.keys(tools)).toContain("skill")
        expect(Object.keys(tools)).not.toContain("webfetch")
        expect(Object.keys(tools)).not.toContain("websearch")
        expect(Object.keys(tools)).not.toContain("todoread")
      },
    })
  })

  test("frontend_design report includes process trace events", () => {
    const trace = FrontendDesignTestHooks.createFrontendProcessTrace()
    FrontendDesignTestHooks.recordFrontendProcessEvent(trace, {
      name: "create_frontend_skeleton_project",
      status: "passed",
      details: { outputDir: "frontend-design-skeleton" },
    })
    FrontendDesignTestHooks.recordFrontendProcessEvent(trace, {
      name: "edit",
      status: "passed",
      details: { title: "Edited source region" },
    })

    const report = FrontendDesignTestHooks.appendFrontendProcessTrace(
      {
        summary: "summary",
        detail: "detail",
      },
      trace,
    )

    expect(report.detail).toContain("## Frontend Design Process Trace")
    expect(report.detail).toContain("passed: create_frontend_skeleton_project")
    expect(report.detail).toContain("passed: edit")
  })

  test("frontend_design process trace writes task runtime artifact", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-design-trace-"))
    await Instance.provide({
      directory: tmp,
      fn: async () => {
        const taskID = "tsk_frontend_trace"
        seedFrontendPromptTask(taskID)
        const trace = FrontendDesignTestHooks.createFrontendProcessTrace()
        FrontendDesignTestHooks.recordFrontendProcessEvent(trace, {
          name: "frontend_design_static_tool_surface",
          status: "passed",
        })

        const artifact = await FrontendDesignTestHooks.writeFrontendProcessTraceArtifact(taskID, trace)
        expect(artifact).toContain("frontend-design-process-trace.json")
        const persisted = JSON.parse(await fs.readFile(artifact!, "utf8"))
        expect(persisted.purpose).toBe("frontend-design-process-trace")
        expect(persisted.events[0].name).toBe("frontend_design_static_tool_surface")
        const iterationArtifact = await FrontendDesignTestHooks.writeFrontendIterationStateArtifact(taskID, trace)
        expect(iterationArtifact).toContain("frontend-design-iteration-state.json")
        const iterationState = JSON.parse(await fs.readFile(iterationArtifact!, "utf8"))
        expect(iterationState.purpose).toBe("frontend-design-rawproject-iteration-state")
        const report = FrontendDesignTestHooks.appendFrontendProcessTrace(
          { summary: "summary", detail: "detail" },
          trace,
          {
            processTraceArtifact: artifact,
            iterationStateArtifact: iterationArtifact,
          },
        )
        expect(report.detail).toContain(`Process trace artifact: ${artifact}`)
        expect(report.detail).toContain(`Iteration state artifact: ${iterationArtifact}`)
      },
    })
  })

  test("frontend_design process trace records region selection and source edits", async () => {
    const trace = FrontendDesignTestHooks.createFrontendProcessTrace()
    const tools = FrontendDesignTestHooks.createFrontendProcessTraceTools(trace)
    const selectionResult = await (tools.record_frontend_region_selection as any).execute({
      regionComponentName: "HeroRegion",
      regionFilePath: "src/components/source-dom/HeroRegion.tsx",
      replacementPlanFile: "src/data/sourceDomReplacementPlan.ts",
      iterationStateFile: "src/data/sourceDomIterationState.ts",
      recommendedComponentName: "HeroSection",
      replacementKind: "card_collection_component",
      reason: "nextSourceDomReplacement points at the hero source region.",
    })
    expect(selectionResult.output).toContain(
      "Next skeleton edits should stay inside this selected region's HTML, CSS, assets, visible content, and representative interaction-state visuals",
    )
    expect(selectionResult.output).toContain(
      "If you already read this selected region file, the next file-changing action should write or repair the visual skeleton slice",
    )
    expect(selectionResult.output).toContain(
      "Additional reads before that write must be direct imports or explicitly named data/style/asset sidecars",
    )
    expect(selectionResult.output).toContain(
      "not unrelated skeleton wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive `AssetPath`/`svgPaths`/`asset_*.path.txt`/CSS-token scans",
    )
    expect(selectionResult.output).toContain("Do not pre-read every asset path or CSS token before writing")
    expect(selectionResult.output).toContain("Preserve observed asset IDs/token names and source IDs")
    expect(selectionResult.output).toContain(
      "The next filesystem-changing skeleton edits must belong to this selected region only",
    )
    expect(selectionResult.output).toContain(
      "Do not write footer, economy table, FAQ, map, chart, card/list, combined content, or unrelated CSS",
    )
    expect(selectionResult.output).toContain("Restore the selected source component/row into HTML/CSS/assets")
    expect(selectionResult.output).toContain("faithful HTML/CSS restoration")
    expect(selectionResult.output).toContain("AssetPath` or asset resolver usage")
    expect(selectionResult.output).toContain("Do not replace asset references with guessed inline SVG paths")
    expect(selectionResult.output).toContain("Data/content snippets are region-owned during restoration")
    expect(selectionResult.output).toContain(
      "Do not select another region until you record this region's replacement result",
    )
    expect(selectionResult.output).toContain(
      "Skeleton root wiring may include only this region and previously completed region visuals",
    )
    expect(selectionResult.output).toContain(
      "Before writing files for another region, inspect task-scoped preview or screenshot evidence",
    )
    expect(selectionResult.output).toContain("inspect task-scoped preview or screenshot evidence")
    expect(selectionResult.output).toContain("repair this same region when screenshot review names mismatches")
    FrontendDesignTestHooks.recordFrontendToolResultEvents(
      trace,
      "edit",
      {
        filePath: "src/components/SourceDomPage.tsx",
      },
      {
        title: "src/components/SourceDomPage.tsx",
      },
    )
    FrontendDesignTestHooks.recordFrontendToolResultEvents(
      trace,
      "bash",
      {
        command: "bun run build",
        workdir: "frontend-design-skeleton",
      },
      {
        title: "Command completed",
      },
    )
    await (tools.record_frontend_replacement_result as any).execute({
      regionComponentName: "HeroRegion",
      replacementStatus: "completed",
      replacementComponentName: "HeroSection",
      filesChanged: ["src/components/semantic/HeroSection.tsx"],
      dataModules: ["src/data/sourceData.ts"],
      styleModules: ["src/styles.css"],
      removedGeneratedBoundaries: ["src/components/source-dom/HeroRegion.tsx"],
      visualEvidence: ["acceptance/hero-preview-screenshot.json"],
      sourceEvidence: ["acceptance/source-evidence-review.json"],
      remainingSourceDebt: ["FooterRegion"],
      nextRegionComponentName: "FooterRegion",
    })

    expect(trace.events.map((event) => event.name)).toContain("frontend_design_region_selection")
    expect(trace.events.map((event) => event.name)).toContain("frontend_design_source_edit")
    expect(trace.events.map((event) => event.name)).toContain("frontend_design_replacement_result")
    expect(trace.events.map((event) => event.name)).toContain("bun run build")
    const sourceEdit = trace.events.find((event) => event.name === "frontend_design_source_edit")
    expect(sourceEdit?.details?.files).toEqual(["src/components/SourceDomPage.tsx"])
    const iterationState = FrontendDesignTestHooks.buildFrontendIterationState(trace)
    expect(iterationState.completedReplacements[0]?.regionComponentName).toBe("HeroRegion")
    expect(iterationState.remainingSourceDebt).toEqual(["FooterRegion"])
  })

  test("terminal frontend template submit tool requires two review notes", async () => {
    const kit = createFrontendTemplateOutputTools()
    const submit = kit.tools.submit_frontend_template as any

    await updatePromptTestFrontendResult(kit, ["pass 1 inventory complete"])

    const missing = await submit.execute({ final: true }, {})

    expect(missing).toContain("MISSING_FRONTEND_TEMPLATE_RESULT")
    expect(missing).toContain("update_frontend_iteration_note")
    expect(kit.getCollector().final).toBeUndefined()

    await (kit.tools.update_frontend_iteration_note as any).execute(
      { value: "pass 2 implementation handoff complete" },
      {},
    )
    await submit.execute({ final: true }, {})

    expect(kit.getCollector().final?.template_iteration_notes).toHaveLength(2)
  })

  test("agent exposes incremental frontend result update tools plus small submit", () => {
    const tools = FrontendDesignTestHooks.createFrontendSubmitTools(createFrontendTemplateOutputTools())

    expect(Object.keys(tools)).toEqual([
      "update_frontend_basics",
      "update_frontend_text",
      "update_frontend_item",
      "update_frontend_material",
      "update_frontend_project",
      "update_frontend_component_reuse",
      "update_frontend_baseline",
      "update_frontend_phase",
      "update_frontend_visual_evidence",
      "update_frontend_iteration_note",
      "update_frontend_reference",
      "update_frontend_question",
      "inspect_frontend_result_status",
      "submit_frontend_template",
    ])
    expect(Object.keys(tools).some((name) => name.startsWith("register_"))).toBe(false)
  })

  test("text-only turns pin frontend_design to direct public report submission", () => {
    expect(
      FrontendDesignTestHooks.isTextOnlyNoVisualSource({
        request: "Build a docs landing page from this written brief.",
      }),
    ).toBe(true)
    expect(
      FrontendDesignTestHooks.isTextOnlyNoVisualSource({
        request: "Clone https://example.com/docs",
      }),
    ).toBe(false)
    expect(
      FrontendDesignTestHooks.isTextOnlyNoVisualSource({
        request: "Clone the attached screenshot",
        attachments: [{ mime: "image/png", intent: "visual_reference" }],
      }),
    ).toBe(false)

    const prompt = FrontendDesignTestHooks.buildUserPrompt({
      title: "Text page",
      request: "Build a docs landing page from this written brief.",
    })

    expect(prompt).toContain("Text-only frontend_design turn")
    expect(prompt).toContain("Produce the public frontend_design report directly from the textual brief")
  })

  test("host-prepared prompt embeds compact evidence and requires bounded evidence inspection", () => {
    const prompt = FrontendDesignTestHooks.buildUserPrompt(
      { title: "Reference page", request: "clone https://example.com/product" },
      {
        status: "created",
        projectRoot: "frontend-design-skeleton",
        sourcePackage: "web-clone-source",
        projectRootRef: ProjectRuntimePaths.frontendDesignPaths("", "tsk_test").skeletonProjectRelative,
        sourcePackageRef: ProjectRuntimePaths.frontendDesignPaths("", "tsk_test").sourcePackageRelative,
        entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
        generationTool: "host-prepared:create_frontend_skeleton_project",
        warnings: [],
        visualIterationMatrix:
          "desktop-reference 1366x768 (primary_reference, capture_viewport): Capture and inspect a task-scoped preview screenshot against web-clone-source/reference.png after each region replacement.",
        compactEvidence: [
          "## source-ir/component-tree.json",
          '{"components":[{"name":"ProductPage"}]}',
          "## source-ir/content-model.json",
          '{"lists":[{"name":"Feature list"}]}',
        ].join("\n"),
      } as any,
    )

    expect(prompt).toContain(
      "Host-prepared means source evidence exists; it does not mean the frontend template or visual HTML skeleton is already designed",
    )
    expect(prompt).toContain("Use `read`, `list`, `glob`, and `search_code`")
    expect(prompt).toContain("any existing frontend app constraints")
    expect(prompt).toContain("## source-ir/component-tree.json")
    expect(prompt).toContain("## source-ir/content-model.json")
    expect(prompt).toContain("Populate the contract through `update_frontend_*` tools")
    expect(prompt).not.toContain("Only `submit_frontend_template` is available")
    expect(prompt).not.toContain("schema is intentionally lightweight")
    expect(prompt).not.toContain("terminal-only host-prepared turn")
    expect(prompt).not.toContain("discovery tools are intentionally unavailable")
    expect(prompt).toContain("later maintainable project transcription")
    expect(prompt).toContain("Do not output a standalone component checklist or advice-only report")
    expect(prompt).toContain("visual HTML skeleton restoration algorithm")
    expect(prompt).toContain("normal frontend-design agent flow")
    expect(prompt).toContain(
      "Do not install, build, render, or start a dev/preview server inside `frontend-design-skeleton` as the final deliverable",
    )
    expect(prompt).toContain(
      "Do not replace this judgment with host-side deterministic selector/card/table/map extraction rules.",
    )
    expect(prompt).toContain("source map, region map, one replacement decision per visual region")
    expect(prompt).toContain("HTML/CSS/assets/content restoration with source data/content extraction")
    expect(prompt).toContain("scoped style ownership")
    expect(prompt).toContain("interaction-state visuals")
    expect(prompt).toContain("desktop-reference 1366x768")
    expect(prompt).toContain("capture_viewport")
    expect(prompt).not.toContain("mobile-review")
    expect(prompt).not.toContain("web-clone-source/reference-mobile.png")
    expect(prompt).not.toContain("wide-review 1920x1080")
    expect(prompt).toContain("source-region traceable visual restoration")
    expect(prompt).toContain("rawproject source nodes/regions/assets/reference screenshots")
    expect(prompt).toContain("A region replacement is complete only after source content/data extraction")
    expect(prompt).toContain("rendered screenshot inspection")
    expect(prompt).toContain(
      "Do not alter evaluators, other agent prompts, communication paths, generated outputs, or runtime source packages to satisfy the report.",
    )
    expect(prompt).toContain("Webpage/source evidence stays in task runtime paths")
    expect(prompt).toContain("Do not instruct downstream agents to move or clean `web-clone-source/`")
    expect(prompt).toContain("restore visual parity first")
    expect(prompt).toContain("mature maintained libraries only as later transcription constraints")
    expect(prompt).toContain(
      "Host-prepared webpage rawproject refinement uses `final_acceptance_mode=visual_baseline_allowed`",
    )
    expect(prompt).toContain("deferred regions must be reported as unfinished visual/source debt")
    expect(prompt).not.toContain(
      "use `visual_baseline_allowed` only when the operator explicitly accepts captured source regions",
    )
    expect(prompt).toContain("sourceDomIterationState.ts")
    expect(prompt).toContain("sourceDomReplacementPlan.ts")
    expect(prompt).toContain("sourceDomRegions.ts")
    expect(prompt).toContain("static progress metadata")
    expect(prompt).toContain("sourceSvgAssetGroups.ts")
    expect(prompt).toContain("sourceFaqGroups.ts")
    expect(prompt).toContain("PRD delta boundaries")
    expect(prompt.toLowerCase()).not.toContain("gate")
    expect(prompt).not.toContain("loop state")
    expect(prompt).not.toContain("new webpage build")
    expect(prompt).not.toContain("from scratch")
    expect(prompt).not.toContain("blank page")
    expect(prompt).toContain("Do not implement by freehand redrawing")
    expect(prompt).not.toContain("greenfield")
    expect(prompt).not.toContain("overallScore >=80/100")
    expect(prompt).not.toContain("100/100")
    expect(prompt).not.toContain("TradingView")
    expect(prompt).not.toContain("world-economy")
  })

  test("host-prepared prompt reports missing viewport matrix instead of inventing dimensions", () => {
    const prompt = FrontendDesignTestHooks.buildUserPrompt(
      { title: "Reference page", request: "clone https://example.com/product" },
      {
        status: "created",
        projectRoot: "frontend-design-skeleton",
        sourcePackage: "web-clone-source",
        projectRootRef: ProjectRuntimePaths.frontendDesignPaths("", "tsk_test").skeletonProjectRelative,
        sourcePackageRef: ProjectRuntimePaths.frontendDesignPaths("", "tsk_test").sourcePackageRelative,
        entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
        generationTool: "host-prepared:create_frontend_skeleton_project",
        warnings: [],
        compactEvidence: "",
        sourceReplacementPlan: [],
      },
    )

    expect(prompt).toContain("did not expose visualIteration.viewportMatrix with captured viewport dimensions")
    expect(prompt).not.toContain("desktop-reference 1440x900")
  })

  test("runtime host-prepared resolver loads compact evidence from task paths", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_frontend_runtime_evidence"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedFrontendPromptTask(taskID)
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-ir"), { recursive: true })
        await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-skeleton"), { recursive: true })
        await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "data"), { recursive: true })
        await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "components", "source-dom"), { recursive: true })
        const png = new PNG({ width: 8, height: 8 })
        png.data.fill(255)
        await fs.writeFile(path.join(paths.sourcePackageAbsolute, "reference.png"), PNG.sync.write(png))
        await fs.writeFile(
          path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceProjectManifest.json"),
          JSON.stringify(
            {
              sourceDomRegions: {
                count: 1,
                largestBytes: 24000,
                highPriorityCount: 1,
                replacementPlanCount: 1,
                iterationStateModule: "src/data/sourceDomIterationState.ts",
                semanticReplacementCount: 0,
              },
              visualIteration: {
                referenceImage: "reference.png",
                evidenceMethod: "task_scoped_preview_screenshots",
                viewportMatrix: [
                  {
                    name: "desktop-reference",
                    width: 1366,
                    height: 768,
                    evidenceRole: "primary_reference",
                    evidenceSource: "capture_viewport",
                    comparison:
                      "Capture and inspect a task-scoped preview screenshot against web-clone-source/reference.png after each region replacement.",
                  },
                ],
                layoutWidthContract: {
                  mode: "full_width",
                  viewportWidth: 1366,
                  referenceImageWidth: 1366,
                  fullWidthElementCount: 3,
                  centeredElementCount: 0,
                  evidence: ["body#root x=0 w=1366", "header#top-band x=0 w=1366"],
                  rule: "Treat the page canvas and major bands as viewport-width.",
                },
              },
            },
            null,
            2,
          ),
        )
        await fs.writeFile(
          path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomIterationState.ts"),
          [
            "export const sourceDomIterationState = " +
              JSON.stringify(
                {
                  generatedRegionCount: 1,
                  semanticReplacementCount: 0,
                  remainingRegionCount: 1,
                  nextReplacement: {
                    regionComponentName: "GenericRegion",
                    regionFilePath: "src/components/source-dom/GenericRegion.tsx",
                    priority: "high",
                    replacementKind: "card_collection_component",
                    recommendedComponentName: "GenericCards",
                  },
                },
                null,
                2,
              ) +
              " as const",
            "",
          ].join("\n"),
        )
        await fs.writeFile(
          path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomReplacementPlan.ts"),
          [
            "export const sourceDomReplacementPlan = " +
              JSON.stringify(
                [
                  {
                    regionComponentName: "GenericRegion",
                    regionFilePath: "src/components/source-dom/GenericRegion.tsx",
                    priority: "high",
                    replacementKind: "card_collection_component",
                    firstReplacementStep: "Extract repeated cards into target project source.",
                  },
                ],
                null,
                2,
              ) +
              " as const",
            "",
          ].join("\n"),
        )

        const resolved = await FrontendDesignTestHooks.resolveHostPreparedFrontendProject(taskID)

        expect(resolved?.status).toBe("created")
        expect(resolved?.projectRoot).toBe(paths.skeletonProjectAbsolute)
        expect(resolved?.sourcePackage).toBe(paths.sourcePackageAbsolute)
        expect(resolved?.projectRootRef).toBe(paths.skeletonProjectRelative)
        expect(resolved?.sourcePackageRef).toBe(paths.sourcePackageRelative)
        expect(resolved?.visualIterationMatrix).toContain("desktop-reference 1366x768")
        expect(resolved?.compactEvidence).toContain("source-project-handoff-summary.md")
        expect(resolved?.compactEvidence).toContain("nextReplacement: GenericRegion -> GenericCards")
        expect(resolved?.compactEvidence).not.toContain("source-audit-supervision.md")
      },
    })
  }, 30_000)

  test("host-prepared source project summary exposes replacement sidecars and known region work", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-source-summary-"))
    try {
      await fs.mkdir(path.join(dir, "src", "data"), { recursive: true })
      await fs.mkdir(path.join(dir, "src", "components", "source-dom"), { recursive: true })
      await fs.mkdir(path.join(dir, "src", "styles"), { recursive: true })
      await fs.mkdir(path.join(dir, "public", "assets"), { recursive: true })
      await fs.writeFile(
        path.join(dir, "src", "components", "source-dom", "NewsRegion.tsx"),
        "export function NewsRegion() { return null }\n",
      )
      await fs.writeFile(path.join(dir, "src", "styles", "source-critical.css"), ".page{}\n")
      await fs.writeFile(path.join(dir, "src", "data", "sourceData.ts"), "export const sourceLists = [] as const\n")
      await fs.writeFile(path.join(dir, "src", "data", "svgPaths.ts"), "export const svgPaths = {} as const\n")
      await fs.writeFile(
        path.join(dir, "src", "data", "sourceSvgAssetGroups.ts"),
        "export const sourceSvgAssetGroups = {} as const\n",
      )
      await fs.writeFile(
        path.join(dir, "src", "data", "sourceFaqGroups.ts"),
        "export const sourceFaqGroups = {} as const\n",
      )
      await fs.writeFile(
        path.join(dir, "src", "data", "sourceDomRegions.ts"),
        "export const sourceDomRegions = [] as const\n",
      )
      await fs.writeFile(
        path.join(dir, "src", "data", "sourceProjectManifest.json"),
        JSON.stringify(
          {
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
              evidenceMethod: "task_scoped_preview_screenshots",
              viewportMatrix: [
                {
                  name: "desktop-reference",
                  width: 1440,
                  height: 900,
                  evidenceRole: "primary_reference",
                  evidenceSource: "capture_viewport",
                  comparison:
                    "Capture and inspect a task-scoped preview screenshot against web-clone-source/reference.png after each region replacement.",
                },
              ],
              layoutWidthContract: {
                mode: "full_width",
                viewportWidth: 1440,
                referenceImageWidth: 1440,
                fullWidthElementCount: 4,
                centeredElementCount: 0,
                evidence: ["body#root x=0 w=1440", "section#hero x=0 w=1440"],
                rule: "Treat the page canvas and major bands as viewport-width.",
              },
              rule: "Use desktop-reference before claiming final parity.",
            },
          },
          null,
          2,
        ),
      )
      await fs.writeFile(
        path.join(dir, "src", "data", "sourceDomIterationState.ts"),
        [
          "export const sourceDomIterationState = " +
            JSON.stringify(
              {
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
              },
              null,
              2,
            ) +
            " as const",
          "",
        ].join("\n"),
      )
      await fs.writeFile(
        path.join(dir, "src", "data", "sourceDomReplacementPlan.ts"),
        [
          "export const sourceDomReplacementPlan = " +
            JSON.stringify(
              [
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
              ],
              null,
              2,
            ) +
            " as const",
          "",
        ].join("\n"),
      )

      const summary = await FrontendDesignTestHooks.summarizeHostPreparedSourceProject(dir)

      expect(summary).toContain("Source-dom region stats")
      expect(summary).toContain("Visual iteration matrix")
      expect(summary).toContain("desktop-reference: 1440x900 (primary_reference, capture_viewport)")
      expect(summary).toContain("layoutWidthContract: full_width viewport=1440px")
      expect(summary).toContain("evidenceMethod: task_scoped_preview_screenshots")
      expect(summary).toContain("largestBytes: 44123")
      expect(summary).toContain("Maintainable iteration state")
      expect(summary).toContain("remainingRegionCount: 11")
      expect(summary).toContain("nextReplacement: NewsRegion -> NewsList")
      expect(summary).toContain("sourceDomIterationState.ts")
      expect(summary).toContain("sourceDomReplacementPlan.ts")
      expect(summary).toContain("sourceFaqGroups.ts")
      expect(summary).toContain("NewsRegion: priority=high")
      expect(summary).toContain("firstReplacementStep: Render NewsList")
      expect(summary).toContain("Extraction rule")
      expect(summary).toContain("Frontend Research Page Skeleton Blueprint")
      expect(summary).toContain("per-region selection and repair metadata")
      expect(summary).toContain("not the page information architecture")
      expect(summary).not.toContain("should start from sourceDomIterationState.ts")
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
      await fs.writeFile(
        path.join(projectRoot, "src", "data", "sourceProjectManifest.json"),
        JSON.stringify({
          sourceDomRegions: {
            count: 1,
            largestBytes: 65000,
            highPriorityCount: 1,
            replacementPlanCount: 1,
            iterationStateModule: "src/data/sourceDomIterationState.ts",
          },
        }),
      )
      await fs.writeFile(
        path.join(projectRoot, "src", "data", "sourceDomIterationState.ts"),
        [
          "export const sourceDomIterationState = " +
            JSON.stringify({
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
            }) +
            " as const",
          "",
        ].join("\n"),
      )
      await fs.writeFile(
        path.join(projectRoot, "src", "data", "sourceDomReplacementPlan.ts"),
        [
          "export const sourceDomReplacementPlan = " +
            JSON.stringify([
              {
                regionComponentName: "HugeRegion",
                regionFilePath: "src/components/source-dom/HugeRegion.tsx",
                priority: "high",
                replacementKind: "baseline_defer",
                firstReplacementStep: "Keep baseline until parity is proven.",
              },
            ]) +
            " as const",
          "",
        ].join("\n"),
      )
      await fs.writeFile(
        path.join(projectRoot, "src", "data", "sourceData.ts"),
        [
          "export const sourceLists = [",
          ...Array.from({ length: 200 }, (_, index) => `  "HUGE_INLINE_MARKER_${index}",`),
          "] as const",
          "",
        ].join("\n"),
      )

      const compact = await FrontendDesignTestHooks.readHostPreparedCompactEvidence({ sourcePackage, projectRoot })

      expect(compact).toContain("reference-pixel-summary.md")
      expect(compact).toContain("source-project-handoff-summary.md")
      expect(compact).toContain("sourceDomIterationState.ts")
      expect(compact).toContain("nextReplacement: HugeRegion")
      expect(compact).toContain("host-prepared-evidence-index.md")
      expect(compact).toContain("frontend-design-skeleton/src/data/sourceData.ts")
      expect(compact).toContain("Large source files are not inlined")
      expect(compact).not.toContain("source-audit-supervision.md")
      expect(compact).not.toContain("web_clone_source_audit")
      expect(compact).not.toContain("HUGE_INLINE_MARKER")
      expect(compact).not.toContain("[clipped:")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

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

  test("agent runtime exposes webpage evidence tools for missing webpage evidence", async () => {
    const tools = await FrontendDesignTestHooks.createWebpageEvidenceTools({})

    for (const id of WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS) {
      expect(Object.keys(tools)).toContain(id)
    }
  })

  test("task request injection forwards the full request and points at the intent bundle", () => {
    const request = Array.from({ length: 505 }, (_, index) => `templateword${index + 1}`).join(" ")
    const prompt = FrontendDesignTestHooks.buildUserPrompt({ title: "Large template", request })

    expect(prompt).toContain("templateword500")
    expect(prompt).toContain("templateword505")
    expect(prompt).toContain(".opencorvus/r/t/<task-key>/intent/request.md")
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
  await fs.writeFile(
    path.join(sourcePackage, "source-skeleton", "index.html"),
    `
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
  `,
  )
  await fs.writeFile(
    path.join(sourcePackage, "source-skeleton", "critical.css"),
    `
    .economic-calendar { display: grid; grid-template-columns: 180px 1fr; gap: 16px; color: #111827; }
    table { border-collapse: collapse; width: 100%; }
  `,
  )
  await fs.writeFile(
    path.join(sourcePackage, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        version: 1,
        purpose: "web-clone-component-tree",
        components: [
          { id: "segment-nav", name: "NavigationRegion", textPreview: ["Markets"] },
          {
            id: "segment-main",
            name: "EconomicCalendarSection",
            textPreview: ["Economic calendar", "08:30", "GDP Growth Rate"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await fs.writeFile(
    path.join(sourcePackage, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        version: 1,
        purpose: "web-clone-content-model",
        tables: [
          {
            nodeId: "table-1",
            headers: ["Time", "Country", "Event", "Actual"],
            rows: [
              ["08:30", "US", "GDP Growth Rate", "2.1%"],
              ["09:45", "US", "Manufacturing PMI", "51.3"],
            ],
          },
        ],
        lists: [],
        cards: [],
        controls: [],
        links: [{ nodeId: "link-1", text: "Markets", href: "/markets" }],
        media: [],
        repeatedGroups: [
          {
            parentNodeId: "tbody-1",
            count: 2,
            sampleTexts: ["08:30 US GDP Growth Rate 2.1%", "09:45 US Manufacturing PMI 51.3"],
          },
        ],
        stats: {
          totalTables: 1,
          totalLists: 0,
          totalCards: 0,
          totalRepeatedGroups: 1,
        },
      },
      null,
      2,
    ),
  )
  const referenceSha256 = createHash("sha256").update(referenceBytes).digest("hex")
  await fs.writeFile(
    path.join(sourcePackage, "web-clone-source-manifest.json"),
    JSON.stringify(
      {
        version: 1,
        purpose: "web-clone-visible-source-package",
        provenance: {
          source: "webpage-evidence",
          webpageEvidenceDir: sourcePackage,
          captureViewport: {
            width: 1366,
            height: 768,
          },
          reference: {
            path: "reference.png",
            sha256: referenceSha256,
            width: 1,
            height: 1,
            bytes: referenceBytes.length,
          },
        },
        files: [
          {
            path: "reference.png",
            sha256: referenceSha256,
            bytes: referenceBytes.length,
            source: "webpage-evidence/reference.png",
          },
        ],
      },
      null,
      2,
    ),
  )
  return sourcePackage
}

function frontendDesignPromptWebpageContract(): NonNullable<ReturnType<typeof validResearchBrief>["webpage_contract"]> {
  return {
    source_url: "https://www.tradingview.com/markets/world-economy/",
    reference_image_evidence_ids: ["ev_1"],
    functional_surfaces: [
      {
        id: "surface_world_economy_table",
        title: "World economy market table",
        user_visible_behavior: "Shows the primary economy table and filters in the first-page flow.",
        component_kind_hypothesis: "financial data table with tabs and filters",
        required_interactions: ["Table tabs and filters remain visible and clickable."],
        evidence_ids: ["ev_1"],
      },
    ],
    visual_layout: [
      {
        id: "layout_desktop_world_economy",
        viewport: "desktop",
        region: "Header, page title, tabs, and market table in source order",
        layout_contract: "The first viewport preserves the TradingView world economy page section order.",
        spacing_and_alignment: "Dense financial-table spacing and column alignment match the reference screenshot.",
        evidence_ids: ["ev_1"],
      },
    ],
    style_requirements: [
      {
        id: "style_table_density",
        token_or_selector: "market table density",
        requirement: "Preserve compact financial table typography, borders, and row rhythm.",
        evidence_ids: ["ev_1"],
      },
    ],
    interaction_states: [
      {
        id: "state_tab_selected",
        component: "Market tab",
        state: "selected",
        behavior: "Selected tab state remains visually distinct from inactive tabs.",
        evidence_ids: ["ev_1"],
      },
    ],
    data_content_inventory: [
      {
        id: "data_table_rows",
        surface: "World economy market table",
        content_contract: "Visible columns, labels, and representative rows are preserved.",
        evidence_ids: ["ev_1"],
      },
    ],
    fidelity_acceptance: [
      {
        id: "accept_world_economy_first_viewport",
        target: "Desktop first viewport",
        criterion: "The skeleton preserves section order and financial-table density.",
        evidence_ids: ["ev_1"],
      },
    ],
    fidelity_risks: [
      {
        id: "risk_dynamic_market_values",
        risk: "Market values can change between captures.",
        impact: "Use representative source data without changing the layout skeleton.",
        evidence_ids: ["ev_1"],
      },
    ],
  }
}

function seedFrontendPromptTask(taskID: string): void {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "test",
        title: "frontend skeleton worktree task",
        request: "frontend skeleton worktree task",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}
