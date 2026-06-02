import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PNG } from "pngjs"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { FrontendDesignTestHooks } from "../../src/frontend-design/agent"
import { createFrontendSkeletonProjectTool } from "../../src/frontend-design/skeleton-project-tool"
import { createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"
import {
  FRONTEND_DESIGN_CONTEXT_TOOL_IDS,
  FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS,
  FRONTEND_DESIGN_MIRROR_ANALYSIS_TOOL_IDS,
  FRONTEND_DESIGN_UTILITY_TOOL_IDS,
} from "../../src/frontend-design/static-tools"
import { MIRROR_ANALYSIS_TOOL_IDS } from "../../src/mirror/tools/ids"
import { generateWebCloneSkeletonProject } from "../../src/web-clone"
import { tmpdir } from "../fixture/fixture"

describe("frontend-design prompt assembly", () => {
  test("core prompt pins maintainable rawproject refactor algorithm", async () => {
    const prompt = await fs.readFile(path.join(process.cwd(), "src", "prompt", "core", "frontend-design-core.txt"), "utf8")

    expect(prompt).toContain("## Maintainable Rawproject Refactor Algorithm")
    expect(prompt).toContain("Source map")
    expect(prompt).toContain("Region map")
    expect(prompt).toContain("Baseline-first replacement workflow")
    expect(prompt).toContain("normal agent tool flow")
    expect(prompt).toContain("not by creating project-internal state machines")
    expect(prompt).toContain("static first-candidate metadata")
    expect(prompt).toContain("does not ask the generated project to self-iterate")
    expect(prompt).toContain("sourceDomIterationState.ts")
    expect(prompt).toContain("nextSourceDomReplacement")
    expect(prompt).toContain("sourceMap")
    expect(prompt).toContain("generatedCleanupTargets")
    expect(prompt).toContain("verticalSliceSteps")
    expect(prompt).toContain("Replacement decision")
    expect(prompt).toContain("Vertical slice")
    expect(prompt).toContain("Stop condition")
    expect(prompt).toContain("maintainable_replacement_required")
    expect(prompt).toContain("Pre-selection browsing is only for choosing the next source region")
    expect(prompt).toContain("Do not read sibling semantic components, page wrappers, root package/config files, or broad source-IR/style/data inventories before selection")
    expect(prompt).toContain("when the candidate is `HeaderNavigation`, reading `FooterNavigation`, `App.tsx`, `package.json`, `tsconfig.json`, or full source-IR/style catalogs before recording the header selection is off-process evidence hoarding")
    expect(prompt).toContain("data modules, mock fixtures, and API adapters are region-owned source slices")
    expect(prompt).toContain("must contain only records proven by the currently selected replacement-plan row")
    expect(prompt).toContain("App wiring is part of region ownership")
    expect(prompt).toContain("Do not call `record_frontend_region_selection` for another region until the current region has a factual `record_frontend_replacement_result`")
    expect(prompt).toContain("After a region is selected, switch from evidence browsing to target-source extraction")
    expect(prompt).toContain("If the selected region file has already been read, the next file-changing action should populate the target vertical slice")
    expect(prompt).toContain("Further reads must be limited to direct imports or explicitly named data/style/asset sidecars for that selected region only")
    expect(prompt).toContain("Do not exhaustively chase every `AssetPath`, `svgPaths`, `asset_*.path.txt`, CSS token, or `critical.css` variable before the first target write")
    expect(prompt).toContain("Selection is the start of a source-migration transaction")
    expect(prompt).toContain("Future regions may be named only as non-rendering comments/source debt")
    expect(prompt).toContain("never as visible placeholder panels, fake spacers, `min-height` filler, placeholder text")
    expect(prompt).toContain("Before styling a region, inspect the reference pixel evidence for that region/viewport")
    expect(prompt).toContain("wrong theme, wrong header color, wrong density, or wrong first-viewport background means the region is not ready")
    expect(prompt).toContain("Completed/deferred status must cite target-project render evidence")
    expect(prompt).toContain("Do not record a region as completed from source inspection alone")
    expect(prompt).toContain("Do not record a region as completed if the target source contains placeholder UI")
    expect(prompt).toContain("For charts, maps, calendars, tables, or other complex controls, completion requires a real semantic implementation")
    expect(prompt).toContain("If the selected skeleton file is already a semantic component")
    expect(prompt).toContain("Preserve the source data object shape")
    expect(prompt).toContain("AssetPath`/asset resolver usage")
    expect(prompt).toContain("replace `AssetPath` with inline guessed SVG paths")
    expect(prompt).toContain("For render evidence, use one explicit target URL")
    expect(prompt).toContain("do not use `skill`, research reports, shell listing, or build success as a substitute")
    expect(prompt).toContain("## Agent-Owned Rawproject Refinement")
    expect(prompt).toContain("frontend_design is not a report writer")
    expect(prompt).toContain("Build should only fine-tune or integrate the source frontend_design delivers")
    expect(prompt).toContain("edit the target delivery project")
    expect(prompt).toContain("Build is not the primary rawproject-to-maintainable-code worker")
    expect(prompt).toContain("The target project plus the frontend_design iteration-state artifact are part of the deliverable surface")
    expect(prompt).toContain("Do not move, rename, install, build, render, or start a dev/preview server inside `frontend-design-skeleton`")
    expect(prompt).toContain("Baseline-first rule")
    expect(prompt).toContain("Region iteration algorithm")
    expect(prompt).toContain("at least 90% visual similarity")
    expect(prompt).toContain("no relevant rawcode/source-dom debt")
    expect(prompt).toContain("Benchmark is mainline")
    expect(prompt).toContain("visual_baseline_allowed")
    expect(prompt).toContain("maintainable_replacement_required")
    expect(prompt).toContain("Process monitoring is part of the benchmark evidence")
    expect(prompt).toContain("which evidence acquisition tool ran")
    expect(prompt).toContain("which source region was selected")
    expect(prompt).toContain("off-track process defect")
    expect(prompt).toContain("Do not solve benchmark failures by lowering thresholds")
    expect(prompt).not.toContain("Do not loop through render/evaluation attempts")
    expect(prompt).toContain("Do not change other agent prompts, communication paths, evaluator scoring, runtime source packages, raw mirror evidence, or generated evidence outputs")
    expect(prompt).not.toContain("overallScore >=80/100")
    expect(prompt).not.toContain("100/100")
    expect(prompt).not.toContain("96/100")
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
    expect(parts[0]?.text).toContain("Use the task-runtime webpage evidence and mirror analysis tools")
    expect(parts[0]?.text).toContain("assistant.auto_iteration=false")
    expect(parts[0]?.text).not.toContain("webpage_extract")
    expect(parts[0]?.text).not.toContain("webpage_compile")
    expect(parts[0]?.text).not.toContain("webpage_analyze")
    expect(parts[0]?.text).not.toContain("[inlined as file part]")
  })

  test("webpage rawproject prompts make frontend_design materialize the source project itself", () => {
    const prompt = FrontendDesignTestHooks.buildUserPrompt({
      title: "World economy replica",
      request: "Clone https://www.tradingview.com/markets/world-economy/ into a maintainable rawproject replacement.",
      taskID: "tsk_web_clone",
    })

    expect(prompt).toContain("call `create_frontend_skeleton_project`")
    expect(prompt).toContain("Do not pass `web-clone-target` or any target app root to `create_frontend_skeleton_project`")
    expect(prompt).toContain("record_frontend_region_selection")
    expect(prompt).toContain("record_frontend_replacement_result")
    expect(prompt).toContain(".opencorvus/runtime/tasks/tsk_web_clone/frontend-design/web-clone-source/")
    expect(prompt).toContain(".opencorvus/runtime/tasks/tsk_web_clone/frontend-design/frontend-design-skeleton/")
    expect(prompt).toContain("After the source project tool returns")
    expect(prompt).toContain("extract only that selected source region's source-dom/rawcode evidence into the target delivery project")
    expect(prompt).toContain("Build should receive the target project that frontend_design already populated")
    expect(prompt).toContain("Default target delivery project root: `web-clone-target`")
    expect(prompt).toContain("React + Vite + TypeScript")
    expect(prompt).toContain("Default scoped styling approach: CSS Modules")
    expect(prompt).toContain("Root files alone are not a real frontend app")
    expect(prompt).toContain("benchmark workspaces often contain minimal `package.json`, `tsconfig.json`, `data/`, `.git/`, and `.opencorvus/` shell files")
    expect(prompt).toContain("those shell files should not become the delivery project")
    expect(prompt).toContain("create the runnable target app in the default target directory")
    expect(prompt).toContain("Populate the target delivery project directly with file-edit tools for source files")
    expect(prompt).not.toContain("Populate the target delivery project directly with file-edit tools (`package.json`")
    expect(prompt).toContain("instead of running project scaffolding commands")
    expect(prompt).toContain("Pre-selection browsing is only for choosing the next source region")
    expect(prompt).toContain("when the candidate is `HeaderNavigation`, do not read `FooterNavigation`, `App.tsx`, `package.json`, `tsconfig.json`, or full source-IR/style catalogs before recording the header selection")
    expect(prompt).toContain("Configuration manifests and package-manager commands are late-stage integration work, not the first workload")
    expect(prompt).toContain("After the skeleton exists, the first target-project editing pass creates source files only")
    expect(prompt).toContain("Before the first target-project write, call `record_frontend_region_selection`")
    expect(prompt).toContain("target writes without a recorded source region are off-track")
    expect(prompt).toContain("After region selection, change pace from source browsing to target extraction")
    expect(prompt).toContain("the next file-changing action should write the selected vertical slice into the target project")
    expect(prompt).toContain("do not read unrelated skeleton page wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive asset/style catalogs before the selected component/data/style/App slice exists")
    expect(prompt).toContain("Do not chase every `AssetPath`, `svgPaths`, `asset_*.path.txt`, CSS token, or `critical.css` variable before the first target write")
    expect(prompt).toContain("Selection starts a source-migration transaction")
    expect(prompt).toContain("One region selection authorizes edits only for that named source region's data, component, style, assets, and App wiring")
    expect(prompt).toContain("Before writing files for a different source region such as footer, economy tables, news, calendar, FAQ, map, chart, or card/list groups")
    expect(prompt).toContain("A data module, mock fixture, or API adapter is not a neutral shared setup file during region extraction")
    expect(prompt).toContain("must not include footer/economy/news/calendar/FAQ/map/chart/card/list records from regions that have not been selected and recorded yet")
    expect(prompt).toContain("App wiring is also region-scoped")
    expect(prompt).toContain("may import and mount only the current region's component plus components whose regions already have completed replacement results")
    expect(prompt).toContain("future region slots may be non-rendering comments/source debt only")
    expect(prompt).toContain("never visible placeholder panels, fake spacers, `min-height` filler, placeholder text")
    expect(prompt).toContain("Cross-region combined data indexes may be created only after each included region has its own completed replacement result")
    expect(prompt).toContain("Before styling the selected region, inspect `reference.png`/reference-pixel evidence")
    expect(prompt).toContain("visible pixels override generic site-theme assumptions")
    expect(prompt).toContain("The first filesystem-changing operation for a new default target directory must be the source vertical slice itself")
    expect(prompt).toContain("not a directory-only shell command followed by root config")
    expect(prompt).toContain("The file write tools create parent directories for new files")
    expect(prompt).toContain("do not start with `bash mkdir web-clone-target`")
    expect(prompt).toContain("The first write inside a new default target directory should be one of those source files")
    expect(prompt).toContain("not `package.json`, `tsconfig.json`, `index.html`, or bundler config")
    expect(prompt).toContain("Do not write `index.html` until `src/App.tsx`, at least one semantic component, at least one data/mock module")
    expect(prompt).toContain("Do not write imports for future components")
    expect(prompt).toContain("Do not run install/build/render/dev-server commands until the target project already has `src/App.tsx`")
    expect(prompt).toContain("Do not call `write`, `edit`, or `apply_patch` for `package.json`, `tsconfig.json`, or bundler config during that source-coverage pass")
    expect(prompt).toContain("When a target-root file already exists, read that exact file first with `read_file`")
    expect(prompt).toContain("use direct `write` only for genuinely new target-project source files and assets")
    expect(prompt).toContain("Before any install/build/render/server command, create or populate the target delivery project specified by the Target Delivery Project Contract")
    expect(prompt).toContain("frontend_project.project_root` should be `web-clone-target`")
    expect(prompt).toContain("Source coverage comes before manifest/config tuning and package installation")
    expect(prompt).toContain("before spending turns on root config edits, directory-only setup commands, or package-manager commands")
    expect(prompt).toContain("extract only that selected source region's source-dom/rawcode evidence")
    expect(prompt).toContain("After selecting a row, do not continue open-ended reading")
    expect(prompt).toContain("write the target component/data/style/App slice next")
    expect(prompt).toContain("Additional reads after selection must be direct imports or explicitly named data/style/asset sidecars")
    expect(prompt).toContain("Target code must be a maintainable refactor of the selected source component/row")
    expect(prompt).toContain("do not invent simplified SVGs, remembered menu labels, approximate table values, or generic site styling")
    expect(prompt).toContain("If the selected skeleton file is already semantic, first port that component faithfully")
    expect(prompt).toContain("preserve its data object shape")
    expect(prompt).toContain("AssetPath` or asset resolver usage")
    expect(prompt).toContain("Do not replace asset references with guessed inline SVG paths")
    expect(prompt).toContain("Do not batch unrelated region files under a previous region selection")
    expect(prompt).toContain("writing footer, economy table, FAQ, map, chart, card/list, root data, or combined data files while `HeaderNavigation` is the selected region is off-region work")
    expect(prompt).toContain("Keep data/mock/API adapter files region-owned during extraction")
    expect(prompt).toContain("If the selected row is navigation, do not create economy/table/news/footer data")
    expect(prompt).toContain("if a file name sounds shared, its contents still must be limited to the selected region")
    expect(prompt).toContain("App imports are part of the same region ownership")
    expect(prompt).toContain("do not import components or data modules for regions that have not been created in the current pass or completed earlier")
    expect(prompt).toContain("After each replacement, build the target project, use one explicit running target URL")
    expect(prompt).toContain("call `webpage_vision_judge` for visual/semantic mismatches such as wrong light/dark theme")
    expect(prompt).toContain("placeholder UI, or fake spacers")
    expect(prompt).toContain("repair the same region before selecting another region")
    expect(prompt).toContain("start one target server for one chosen URL and then immediately call `webpage_render`")
    expect(prompt).toContain("long-lived Vite/dev/preview servers must be started by passing the tool parameter `background: true`")
    expect(prompt).toContain("the command string itself must not contain shell background operators such as `&`")
    expect(prompt).toContain("if curl succeeds inside the start command but `webpage_render` gets connection refused afterward")
    expect(prompt).toContain("Do not try multiple dev/preview/Python/Vite servers")
    expect(prompt).toContain("do not call `skill` for visual verification")
    expect(prompt).toContain("Verification must include target project build evidence, `webpage_render` screenshot evidence")
    expect(prompt).toContain("Do not record completed for target source that still contains placeholder UI/text/classes")
    expect(prompt).toContain("Do not describe a build as final while `remainingSourceDebt` is non-empty")
    expect(prompt).toContain("Do not read `sourceData.ts`, `svgPaths.ts`, raw HTML, or generated CSS wholesale")
    expect(prompt).toContain("use search/excerpt reads only for the current region's named data/style/asset evidence")
    expect(prompt).toContain("Treat `nextSourceDomReplacement` as the first queue item only")
    expect(prompt).not.toContain("The host already prepared the frontend-design high-fidelity editable source project before this model turn.")
    expect(prompt).not.toContain("Do not call `create_frontend_skeleton_project` again")
  })

  test("skeleton project tool returns bounded source evidence entrypoints", async () => {
    await using tmp = await tmpdir()
    const sourcePackage = await writeAuditFixtureSourcePackage(tmp.path)
    const outputDir = path.join(tmp.path, "frontend-design-skeleton")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tools = createFrontendSkeletonProjectTool()
        const result = await (tools.create_frontend_skeleton_project as any).execute({
          sourcePackageDir: sourcePackage,
          outputDir,
        }, {})

        expect(result.output).toContain("Bounded next action for frontend_design")
        expect(result.output).toContain("Do not move, rename, or repurpose this skeleton output as the target delivery project")
        expect(result.output).toContain("sourceProjectManifest.json")
        expect(result.output).toContain("sourceDomIterationState.ts")
        expect(result.output).toContain("sourceDomReplacementPlan.ts")
        expect(result.output).toContain("Pre-selection browsing is only for choosing the next source region")
        expect(result.output).toContain("Do not read sibling semantic components, page wrappers, root package/config files, or broad source-IR/style/data inventories before selection")
        expect(result.output).toContain("If the candidate is `HeaderNavigation`, do not read `FooterNavigation`, `App.tsx`, `package.json`, `tsconfig.json`, or full source-IR/style catalogs before recording the header selection")
        expect(result.output).not.toContain("target root `package.json`")
        expect(result.output).toContain("Do not read `src/data/sourceData.ts`, `src/data/svgPaths.ts`, raw HTML, or generated CSS in full")
        expect(result.output).toContain("Populate target source files next")
        expect(result.output).toContain("Before writing target project source, call `record_frontend_region_selection`")
        expect(result.output).toContain("The next target-project filesystem-changing operation should be a source vertical-slice file write")
        expect(result.output).toContain("If the selected region file has already been read, stop broad evidence browsing and write the target vertical slice")
        expect(result.output).toContain("before reading unrelated skeleton page wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive asset/style catalogs")
        expect(result.output).toContain("Do not chase every `AssetPath`, `svgPaths`, `asset_*.path.txt`, CSS token, or `critical.css` variable before the first target write")
        expect(result.output).toContain("preserve observed asset IDs/token names through a target-owned resolver/data module")
        expect(result.output).toContain("Further reads after selection should be only direct imports or explicitly named data/style/asset sidecars")
        expect(result.output).toContain("not `bash mkdir`, `index.html`, `package.json`, `tsconfig.json`, or bundler config")
        expect(result.output).toContain("The write tool creates parent directories for new files")
        expect(result.output).toContain("One region selection covers only that selected region's data/component/style/assets/App wiring")
        expect(result.output).toContain("record a replacement result and call `record_frontend_region_selection` again before writing another region")
        expect(result.output).toContain("Data modules, mock fixtures, and API adapters are part of the selected region slice")
        expect(result.output).toContain("If the selected row is navigation, do not create economy/table/news/footer data")
        expect(result.output).toContain("Refactor the selected source component/row by transcribing its actual labels")
        expect(result.output).toContain("If the selected skeleton file is already semantic, first port that component faithfully")
        expect(result.output).toContain("keep its data object shape")
        expect(result.output).toContain("AssetPath` or asset resolver helper")
        expect(result.output).toContain("Do not replace asset references with guessed inline SVG paths")
        expect(result.output).toContain("App wiring belongs to the same slice")
        expect(result.output).toContain("Future region slots may be non-rendering comments/source debt only")
        expect(result.output).toContain("do not render placeholder panels, fake spacers, `min-height` filler, placeholder text")
        expect(result.output).toContain("Cross-region combined data files belong after the included regions each have a completed replacement result")
        expect(result.output).toContain("Do not run install/build/render/dev-server commands yet")
        expect(result.output).toContain("Package-manager commands start only after `src/App.tsx`")
        expect(result.output).toContain("Treat root config files (`package.json`, `tsconfig.json`, bundler config) as late integration edits")
        expect(result.output).toContain("use one explicit running target URL, call `webpage_render`")
        expect(result.output).toContain("call `webpage_vision_judge` for visible theme/layout/density/control mismatches, placeholder UI, or fake spacers")
        expect(result.output).toContain("Do not record completed for charts, maps, tables, calendars, or other complex controls that are only labeled placeholder boxes")
        expect(result.output).toContain("repair the same region from source evidence")
        expect(result.output).toContain("Start one target server only if needed")
        expect(result.output).toContain("use `background: true` and no shell `&`")
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
        expect(Object.keys(tools)).toEqual(expect.arrayContaining([
          "bash",
          "edit",
          "write",
          "apply_patch",
          "web_clone_source_audit",
          "webpage_render",
          "webpage_evaluate",
          "webpage_text_diff",
          "webpage_vision_judge",
        ]))
      },
    })
  })

  test("frontend_design runtime tool groups are static and complete", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-static-tools-"))
    await Instance.provide({
      directory: dir,
      fn: async () => {
        const contextTools = FrontendDesignTestHooks.createFrontendDesignContextTools()
        const mirrorTools = await FrontendDesignTestHooks.createMirrorAnalysisTools({})
        const implementationTools = await FrontendDesignTestHooks.createFrontendImplementationTools({})
        const utilityTools = await FrontendDesignTestHooks.createFrontendUtilityTools({})

        expect(Object.keys(contextTools)).toEqual([...FRONTEND_DESIGN_CONTEXT_TOOL_IDS])
        expect(Object.keys(mirrorTools)).toEqual([...FRONTEND_DESIGN_MIRROR_ANALYSIS_TOOL_IDS])
        expect(Object.keys(implementationTools)).toEqual([...FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS])
        expect(Object.keys(utilityTools)).toEqual([...FRONTEND_DESIGN_UTILITY_TOOL_IDS])

        const tools = {
          ...implementationTools,
          ...contextTools,
          ...utilityTools,
          ...mirrorTools,
        }
        expect(Object.keys(tools)).not.toContain("skill")
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

    const report = FrontendDesignTestHooks.appendFrontendProcessTrace({
      summary: "summary",
      detail: "detail",
    }, trace)

    expect(report.detail).toContain("## Frontend Design Process Trace")
    expect(report.detail).toContain("passed: create_frontend_skeleton_project")
    expect(report.detail).toContain("passed: edit")
  })

  test("frontend_design process trace writes task runtime artifact", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-design-trace-"))
    await Instance.provide({
      directory: tmp,
      fn: async () => {
        const trace = FrontendDesignTestHooks.createFrontendProcessTrace()
        FrontendDesignTestHooks.recordFrontendProcessEvent(trace, {
          name: "frontend_design_static_tool_surface",
          status: "passed",
        })

        const artifact = await FrontendDesignTestHooks.writeFrontendProcessTraceArtifact("tsk_frontend_trace", trace)
        expect(artifact).toContain("frontend-design-process-trace.json")
        const persisted = JSON.parse(await fs.readFile(artifact!, "utf8"))
        expect(persisted.purpose).toBe("frontend-design-process-trace")
        expect(persisted.events[0].name).toBe("frontend_design_static_tool_surface")
        const iterationArtifact = await FrontendDesignTestHooks.writeFrontendIterationStateArtifact("tsk_frontend_trace", trace)
        expect(iterationArtifact).toContain("frontend-design-iteration-state.json")
        const iterationState = JSON.parse(await fs.readFile(iterationArtifact!, "utf8"))
        expect(iterationState.purpose).toBe("frontend-design-rawproject-iteration-state")
        const report = FrontendDesignTestHooks.appendFrontendProcessTrace({ summary: "summary", detail: "detail" }, trace, {
          processTraceArtifact: artifact,
          iterationStateArtifact: iterationArtifact,
        })
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
    expect(selectionResult.output).toContain("Next target edits should stay inside this selected region's data, component, style, assets, and App wiring")
    expect(selectionResult.output).toContain("If you already read this selected region file, the next file-changing action should write the target vertical slice")
    expect(selectionResult.output).toContain("Additional reads before that write must be direct imports or explicitly named data/style/asset sidecars")
    expect(selectionResult.output).toContain("not unrelated skeleton wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive `AssetPath`/`svgPaths`/`asset_*.path.txt`/CSS-token scans")
    expect(selectionResult.output).toContain("Do not pre-read every asset path or CSS token before writing")
    expect(selectionResult.output).toContain("Preserve observed asset IDs/token names in target-owned resolver/data modules first")
    expect(selectionResult.output).toContain("The next filesystem-changing target edits must belong to this selected region only")
    expect(selectionResult.output).toContain("Do not write footer, economy table, FAQ, map, chart, card/list, root data, or combined data files")
    expect(selectionResult.output).toContain("Refactor the selected source component/row into target-owned modules")
    expect(selectionResult.output).toContain("faithfully port it first")
    expect(selectionResult.output).toContain("AssetPath` or asset resolver usage")
    expect(selectionResult.output).toContain("Do not replace asset references with guessed inline SVG paths")
    expect(selectionResult.output).toContain("Data modules, mock fixtures, and API adapters are region-owned during extraction")
    expect(selectionResult.output).toContain("Do not select another region until you record this region's replacement result")
    expect(selectionResult.output).toContain("App wiring may import only this region's component and previously completed region components")
    expect(selectionResult.output).toContain("Before writing files for another region, build and render this region through one explicit target URL")
    expect(selectionResult.output).toContain("start one server only if needed with bash `background: true` and no shell `&`")
    expect(selectionResult.output).toContain("call webpage_render")
    expect(selectionResult.output).toContain("feed its screenshot into webpage_evaluate")
    FrontendDesignTestHooks.recordFrontendToolResultEvents(trace, "edit", {
      filePath: "src/components/SourceDomPage.tsx",
    }, {
      title: "src/components/SourceDomPage.tsx",
    })
    FrontendDesignTestHooks.recordFrontendToolResultEvents(trace, "bash", {
      command: "bun run build",
      workdir: "frontend-design-skeleton",
    }, {
      title: "Command completed",
    })
    await (tools.record_frontend_replacement_result as any).execute({
      regionComponentName: "HeroRegion",
      replacementStatus: "completed",
      replacementComponentName: "HeroSection",
      filesChanged: ["src/components/semantic/HeroSection.tsx"],
      dataModules: ["src/data/sourceData.ts"],
      styleModules: ["src/styles.css"],
      removedGeneratedBoundaries: ["src/components/source-dom/HeroRegion.tsx"],
      visualEvidence: ["acceptance/hero-webpage-evaluate.json"],
      auditEvidence: ["acceptance/web-clone-source-maintainable-audit.json"],
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
    const tools = FrontendDesignTestHooks.createFrontendSubmitTools(createFrontendTemplateOutputTools())

    expect(Object.keys(tools)).toEqual(["submit_frontend_template"])
    expect(Object.keys(tools).some((name) => name.startsWith("register_"))).toBe(false)
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

  test("host-prepared prompt embeds compact evidence and requires bounded evidence inspection", () => {
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
        visualIterationMatrix:
          "desktop-reference 1366x768 (primary_reference, capture_viewport): Run measured webpage_evaluate against web-clone-source/reference.png after each region replacement. mobile-review 390x844 (responsive_review, default): Capture and inspect the root app at this viewport; use measured comparison when matching reference evidence exists, otherwise record the evidence gap. wide-review 1920x1080 (responsive_review, default): Capture and inspect the root app at this viewport; use measured comparison when matching reference evidence exists, otherwise record the evidence gap.",
        compactEvidence: [
          "## source-ir/component-tree.json",
          "{\"components\":[{\"name\":\"ProductPage\"}]}",
          "## source-ir/content-model.json",
          "{\"lists\":[{\"name\":\"Feature list\"}]}",
        ].join("\n"),
      } as any,
    )

    expect(prompt).toContain("Host-prepared means source evidence exists; it does not mean the frontend template is already designed")
    expect(prompt).toContain("Use `read_file`, `list_directory`, `find_files`, and `search_code`")
    expect(prompt).toContain("obvious target project/package/component structure")
    expect(prompt).toContain("## source-ir/component-tree.json")
    expect(prompt).toContain("## source-ir/content-model.json")
    expect(prompt).toContain("call `submit_frontend_template` with the full frontend-design contract")
    expect(prompt).not.toContain("Only `submit_frontend_template` is available")
    expect(prompt).not.toContain("schema is intentionally lightweight")
    expect(prompt).not.toContain("terminal-only host-prepared turn")
    expect(prompt).not.toContain("discovery tools are intentionally unavailable")
    expect(prompt).toContain("maintainable project source")
    expect(prompt).toContain("Do not output a standalone component checklist or advice-only report")
    expect(prompt).toContain("maintainable rawproject refactor algorithm")
    expect(prompt).toContain("normal frontend-design agent flow")
    expect(prompt).toContain("Build receives the target project for integration and precision fixes")
    expect(prompt).toContain("Do not install, build, render, or start a dev/preview server inside `frontend-design-skeleton`")
    expect(prompt).toContain("Do not replace this judgment with host-side deterministic selector/card/table/map extraction rules.")
    expect(prompt).toContain("source map, region map, one replacement decision per region")
    expect(prompt).toContain("vertical-slice extraction into the target project with source data extraction")
    expect(prompt).toContain("scoped style ownership")
    expect(prompt).toContain("no generated fixed-layout boundary in target source")
    expect(prompt).toContain("desktop-reference 1366x768")
    expect(prompt).toContain("capture_viewport")
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

  test("runtime host-prepared resolver loads compact evidence from task paths", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_frontend_runtime_evidence"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-ir"), { recursive: true })
        await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-skeleton"), { recursive: true })
        await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "data"), { recursive: true })
        await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "components", "source-dom"), { recursive: true })
        const png = new PNG({ width: 8, height: 8 })
        png.data.fill(255)
        await fs.writeFile(path.join(paths.sourcePackageAbsolute, "reference.png"), PNG.sync.write(png))
        await fs.writeFile(path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceProjectManifest.json"), JSON.stringify({
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
            comparisonTool: "webpage_evaluate",
            viewportMatrix: [{ name: "desktop-reference", width: 1366, height: 768, evidenceRole: "primary_reference" }],
          },
        }, null, 2))
        await fs.writeFile(path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomIterationState.ts"), [
          "export const sourceDomIterationState = " + JSON.stringify({
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
          }, null, 2) + " as const",
          "",
        ].join("\n"))
        await fs.writeFile(path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomReplacementPlan.ts"), [
          "export const sourceDomReplacementPlan = " + JSON.stringify([{
            regionComponentName: "GenericRegion",
            regionFilePath: "src/components/source-dom/GenericRegion.tsx",
            priority: "high",
            replacementKind: "card_collection_component",
            firstReplacementStep: "Extract repeated cards into target project source.",
          }], null, 2) + " as const",
          "",
        ].join("\n"))

        const resolved = await FrontendDesignTestHooks.resolveHostPreparedFrontendProject(taskID)

        expect(resolved?.status).toBe("created")
        expect(resolved?.projectRoot).toBe(paths.skeletonProjectAbsolute)
        expect(resolved?.sourcePackage).toBe(paths.sourcePackageAbsolute)
        expect(resolved?.projectRootRef).toBe(paths.skeletonProjectRelative)
        expect(resolved?.sourcePackageRef).toBe(paths.sourcePackageRelative)
        expect(resolved?.compactEvidence).toContain("source-project-handoff-summary.md")
        expect(resolved?.compactEvidence).toContain("nextReplacement: GenericRegion -> GenericCards")
        expect(resolved?.compactEvidence).toContain("source-audit-supervision.md")
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
      expect(summary).toContain("Extraction rule")
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
