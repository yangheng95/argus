import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { WebCloneGenerateSourceProjectTool } from "../../src/tool/web-clone-generate-source-project"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test-web-clone-generate-source-project",
  messageID: "message",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.web_clone_generate_source_project", () => {
  test("is not exposed through base or agent-private tool pools", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const globalIDs = await ToolRegistry.ids()
        expect(globalIDs).not.toContain("web_clone_generate_source_project")

        for (const agentID of ["coding", "coding-assistant", "general", "build"]) {
          const agent = await Agent.get(agentID)
          const tools = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent)
          expect(tools.map((tool) => tool.id)).not.toContain("web_clone_generate_source_project")
        }
      },
    })
  }, 30_000)

  test("writes editable React source from source-skeleton and preserves source evidence", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        const generated = await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        expect(generated.title).toBe("Web clone source project generated")
        expect(generated.output).toContain("Desktop visual iteration viewport")
        expect(generated.output).toContain("desktop-reference 1366x768")
        expect(generated.metadata.outputDir).toBe(outputDir)
        expect(await Bun.file(path.join(outputDir, "src", "components", "SourceClonePage.tsx")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "components", "ContentTable.tsx")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceData.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceDomRegions.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceDomReplacementPlan.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceDomIterationState.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceSvgAssetGroups.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceFaqGroups.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "components", "SourceAssetPathGroup.tsx")).exists()).toBe(
          true,
        )
        expect(await Bun.file(path.join(outputDir, "src", "components", "SourceFaqList.tsx")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "styles", "source-critical.css")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "vite-env.d.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "reference.png")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "reference-mobile.png")).exists()).toBe(false)
        expect(await Bun.file(path.join(outputDir, "tsconfig.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "vite.config.ts")).exists()).toBe(true)

        const packageJson = JSON.parse(await Bun.file(path.join(outputDir, "package.json")).text())
        const viteConfig = await Bun.file(path.join(outputDir, "vite.config.ts")).text()
        expect(packageJson.packageManager).toBe("npm@10.9.0")
        expect(packageJson.scripts.dev).toBe("vite --host 127.0.0.1")
        expect(packageJson.scripts.typecheck).toBe("tsc --noEmit")
        expect(packageJson.scripts.build).toBe("vite build")
        expect(packageJson.scripts.preview).toBe("vite preview --host 127.0.0.1 --strictPort")
        expect(JSON.stringify(packageJson.scripts)).not.toContain("bunx")
        expect(packageJson.devDependencies["@types/react"]).toBeDefined()
        expect(packageJson.devDependencies["@types/react-dom"]).toBeDefined()
        expect(viteConfig).toContain("cssMinify: false")
        expect(await Bun.file(path.join(outputDir, "src", "vite-env.d.ts")).text()).toContain("vite/client")
        const sourceClonePage = await Bun.file(path.join(outputDir, "src", "components", "SourceClonePage.tsx")).text()
        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const sourceDomRegions = await Bun.file(path.join(outputDir, "src", "data", "sourceDomRegions.ts")).text()
        const sourceDomReplacementPlan = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomReplacementPlan.ts"),
        ).text()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()
        const sourceSvgAssetGroups = await Bun.file(
          path.join(outputDir, "src", "data", "sourceSvgAssetGroups.ts"),
        ).text()
        const sourceFaqGroups = await Bun.file(path.join(outputDir, "src", "data", "sourceFaqGroups.ts")).text()
        const sourceProjectManifest = JSON.parse(
          await Bun.file(path.join(outputDir, "src", "data", "sourceProjectManifest.json")).text(),
        )
        const readme = await Bun.file(path.join(outputDir, "README.md")).text()
        expect(sourceClonePage).toContain("SourceDomPage")
        expect(sourceDomPage).toStartWith("// @ts-nocheck")
        expect(sourceDomPage).toContain('src={"/assets/images/asset_000002.webp"}')
        expect(sourceDomPage).toContain('tabIndex={"-1"}')
        expect(sourceDomPage).not.toContain("__WEB_CLONE_DATA_URI_ASSET__")
        expect(sourceDomPage).not.toContain("srcSet")
        expect(sourceDomPage).not.toContain("sizes")
        expect((sourceDomPage.match(/"--ui-card-bg"/g) ?? []).length).toBe(1)
        expect(sourceDomRegions).toContain("sourceDomRegions")
        expect(sourceDomReplacementPlan).toContain("sourceDomReplacementPlan")
        expect(sourceDomIterationState).toContain("sourceDomIterationState")
        expect(sourceDomIterationState).toContain("nextSourceDomReplacement")
        expect(sourceDomIterationState).toContain('"viewportMatrix"')
        expect(sourceDomIterationState).toContain('"desktop-reference"')
        expect(sourceDomIterationState).toContain('"width": 1366')
        expect(sourceDomIterationState).toContain('"height": 768')
        expect(sourceDomIterationState).toContain('"evidenceSource": "capture_viewport"')
        expect(sourceDomIterationState).not.toContain('"mobile-review"')
        expect(sourceDomIterationState).not.toContain('"referenceImage": "web-clone-source/reference-mobile.png"')
        expect(sourceDomIterationState).not.toContain('"wide-review"')
        expect(sourceProjectManifest.visualIteration.evidenceMethod).toBe("task_scoped_preview_screenshots")
        expect(sourceProjectManifest.generatedFrom).toContain("source-ir/style-profile.json")
        expect(sourceProjectManifest.visualIteration.viewportMatrix[0]).toMatchObject({
          name: "desktop-reference",
          width: 1366,
          height: 768,
          evidenceSource: "capture_viewport",
        })
        expect(sourceProjectManifest.visualIteration.viewportMatrix.map((item: { name: string }) => item.name)).toEqual(
          ["desktop-reference"],
        )
        expect(sourceProjectManifest.visualIteration.layoutWidthContract).toMatchObject({
          mode: "full_width",
          viewportWidth: 1366,
        })
        expect(readme).toContain("Desktop visual iteration viewport")
        expect(readme).toContain("desktop-reference 1366x768")
        expect(readme).toContain("Layout width contract")
        expect(readme).toContain("full_width viewport=1366px")
        expect(readme).toContain("Source-capture `x/y/w/h`, full-page height, scrollY, and footer transition coordinates are evidence-only")
        expect(readme).toContain("does not impose page height, footer y, scrollY, or blank vertical filler")
        expect(readme).not.toContain("web-clone-source/reference-mobile.png")
        expect(readme).toContain("source-ir/style-profile.json")
        expect(sourceSvgAssetGroups).toContain("sourceSvgAssetGroups")
        expect(sourceFaqGroups).toContain("sourceFaqGroups")
        expect(await Bun.file(path.join(outputDir, "public", "assets", "images", "asset_000002.webp")).exists()).toBe(
          true,
        )
        const projectSource = await readGeneratedSource(outputDir)
        const generatedComponentSource = await readGeneratedSourceDirectory(path.join(outputDir, "src", "components"))
        expect(projectSource.indexOf("Overview")).toBeGreaterThan(-1)
        expect(projectSource.indexOf('className={"arrowWrap-fixture"}')).toBeGreaterThan(-1)
        expect(projectSource.indexOf("Overview")).toBeLessThan(projectSource.indexOf('className={"arrowWrap-fixture"}'))
        expect(projectSource.indexOf('className={"divider-fixture"}')).toBeGreaterThan(-1)
        expect(projectSource.indexOf("Crumb target")).toBeGreaterThan(-1)
        expect(projectSource.indexOf('className={"divider-fixture"}')).toBeLessThan(
          projectSource.indexOf("Crumb target"),
        )
        const sourceCriticalCss = await Bun.file(path.join(outputDir, "src", "styles", "source-critical.css")).text()
        const sourceFullCss = await Bun.file(path.join(outputDir, "src", "styles", "source-full.css")).text()
        expect(projectSource).toContain("GDP Growth Rate")
        expect(projectSource).toContain("EconomicCalendarTable")
        expect(projectSource).not.toContain("dangerouslySetInnerHTML")
        expect(projectSource).not.toContain("innerHTML")
        expect(projectSource).not.toContain("data:image")
        expect(projectSource).not.toContain(";base64,")
        expect(generatedComponentSource).not.toContain("reference.png")
        expect(sourceCriticalCss).not.toContain("data:image")
        expect(sourceCriticalCss).not.toContain(";base64,")
        expect(sourceCriticalCss).not.toContain("data-source-node-id")
        expect(sourceCriticalCss).toContain("[data-theme=dark] .background-test:dir(rtl):after")
        expect(sourceCriticalCss).not.toContain("&:dir")
        expect(sourceFullCss).toContain("[data-theme=dark] .background-test:dir(rtl):before")
        expect(sourceFullCss).toContain(".fade-test:dir(rtl):after")
        expect(sourceFullCss).not.toContain("&:dir")
        expect(sourceFullCss).not.toContain(":after:dir")
      },
    })
  }, 30_000)

  test("does not require a mobile reference image for source project generation", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        const generated = await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)
        expect(generated.title).toBe("Web clone source project generated")
        expect(await Bun.file(path.join(outputDir, "reference.png")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "reference-mobile.png")).exists()).toBe(false)
      },
    })
  }, 30_000)

  test("rejects source project generation when captured viewport metadata is missing", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")
    await fs.rm(path.join(webpageEvidenceDir, "extracted-page.json"), { force: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await expect(generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)).rejects.toThrow(
          "requires captured viewport metadata",
        )
      },
    })
  }, 30_000)

  test("prefers source package capture viewport over raw extracted-page viewport", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")
    await Bun.write(
      path.join(webpageEvidenceDir, "web-clone-source-manifest.json"),
      JSON.stringify(
        {
          version: 1,
          purpose: "web-clone-visible-source-package",
          provenance: {
            captureViewport: { width: 1024, height: 700 },
            reference: { path: "reference.png", width: 1440, height: 2400 },
          },
        },
        null,
        2,
      ),
    )
    await Bun.write(
      path.join(webpageEvidenceDir, "extracted-page.json"),
      JSON.stringify(
        {
          url: "https://example.com/markets",
          viewport: { width: 1280, height: 720 },
        },
        null,
        2,
      ),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneGenerateSourceProjectTool.init()
        await tool.execute({ webpageEvidenceDir, outputDir }, ctx)
        const sourceProjectManifest = JSON.parse(
          await Bun.file(path.join(outputDir, "src", "data", "sourceProjectManifest.json")).text(),
        )

        expect(sourceProjectManifest.visualIteration.viewportMatrix[0]).toMatchObject({
          name: "desktop-reference",
          width: 1024,
          height: 700,
          evidenceSource: "capture_viewport",
        })
      },
    })
  })

  test("does not overwrite an existing output directory unless requested", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")
    await Bun.write(path.join(outputDir, "keep.txt"), "existing")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneGenerateSourceProjectTool.init()
        await expect(tool.execute({ webpageEvidenceDir, outputDir }, ctx)).rejects.toThrow(
          "Output directory is not empty",
        )

        const result = await tool.execute({ webpageEvidenceDir, outputDir, overwrite: true }, ctx)
        expect(result.title).toBe("Web clone source project generated")
        expect(await Bun.file(path.join(outputDir, "keep.txt")).exists()).toBe(false)
      },
    })
  })

  test("splits large generated DOM baselines into source-region components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeRegionizedFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneGenerateSourceProjectTool.init()
        await tool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const sourceDomRegions = await Bun.file(path.join(outputDir, "src", "data", "sourceDomRegions.ts")).text()
        const sourceDomReplacementPlan = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomReplacementPlan.ts"),
        ).text()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()
        const sourceSvgAssetGroups = await Bun.file(
          path.join(outputDir, "src", "data", "sourceSvgAssetGroups.ts"),
        ).text()
        const sourceFaqGroups = await Bun.file(path.join(outputDir, "src", "data", "sourceFaqGroups.ts")).text()
        const sourceProjectManifest = JSON.parse(
          await Bun.file(path.join(outputDir, "src", "data", "sourceProjectManifest.json")).text(),
        )
        const regionDir = path.join(outputDir, "src", "components", "source-dom")
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const regionFiles = (await fs.readdir(regionDir)).filter((file) => file.endsWith(".tsx"))
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const largestRegionBytes = Math.max(
          ...(await Promise.all(regionFiles.map(async (file) => (await fs.stat(path.join(regionDir, file))).size))),
        )

        expect(sourceDomPage).not.toContain('from "./source-dom/MainContentRegion"')
        expect(sourceDomPage).toContain('className={"dashboard"}')
        expect(sourceDomPage).not.toContain("data-source-node-id")
        expect(sourceDomPage.length).toBeLessThan(8_000)
        expect(regionFiles).toContain("OverviewRegion.tsx")
        expect(regionFiles).toContain("MarketsRegion.tsx")
        expect(regionFiles).not.toContain("MapRegion.tsx")
        expect(semanticFiles).toContain("MapSurface.tsx")
        expect(regionFiles).not.toContain("FrequentlyAskedQuestionsRegion.tsx")
        expect(semanticFiles).toContain("FrequentlyAskedQuestionsFAQ.tsx")
        expect(regionFiles.length).toBeGreaterThanOrEqual(6)
        expect(largestRegionBytes).toBeLessThan(80_000)
        const mapSurface = await Bun.file(path.join(semanticDir, "MapSurface.tsx")).text()
        expect(mapSurface).toContain("semantic-source-replacement")
        expect(mapSurface).toContain(".paths.map((path, index)")
        expect(mapSurface).toContain("AssetPath")
        expect(mapSurface).not.toContain("SourceAssetPathGroup")
        expect(mapSurface).not.toContain("data-source-node-id")
        expect(await Bun.file(path.join(semanticDir, "FrequentlyAskedQuestionsFAQ.tsx")).text()).toContain(
          "SourceFaqList",
        )
        expect(sourceSvgAssetGroups).toContain("sourceSvgAssetGroups")
        expect(sourceFaqGroups).toContain("What is GDP?")
        expect(sourceFaqGroups).toContain("How is GDP calculated?")
        expect(sourceDomRegions).toContain("replacementPriority")
        expect(sourceDomReplacementPlan).toContain("firstReplacementStep")
        expect(sourceDomReplacementPlan).toContain('"sourceMap"')
        expect(sourceDomReplacementPlan).toContain('"coordinateSpace": "source_capture_viewport_px"')
        expect(sourceDomReplacementPlan).toContain('"implementationUse": "evidence_only"')
        expect(sourceDomReplacementPlan).toContain('"bounds"')
        expect(sourceDomReplacementPlan).toContain('"styleSources"')
        expect(sourceDomReplacementPlan).toContain("Read web-clone-source/source-ir/style-profile.json")
        expect(sourceDomReplacementPlan).toContain("web-clone-source/source-ir/style-profile.json")
        expect(sourceDomReplacementPlan).toContain('"visualSources"')
        expect(sourceDomReplacementPlan).toContain('"generatedCleanupTargets"')
        expect(sourceDomReplacementPlan).toContain('"verticalSliceSteps"')
        expect(sourceDomReplacementPlan).toContain("parityGuard")
        expect(sourceDomIterationState).toContain('"remainingRegionCount"')
        expect(sourceDomIterationState).toContain("nextReplacement")
        expect(sourceDomIterationState).toContain('"visualIteration"')
        expect(sourceDomIterationState).toContain('"desktop-reference"')
        expect(sourceDomIterationState).toContain("Source-capture x/y/w/h bounds are evidence-only")
        expect(sourceDomIterationState).toContain('"replacementKind": "map_or_chart_asset_component"')
        expect(sourceProjectManifest.visualIteration.referenceImage).toBe("reference.png")
        expect(sourceProjectManifest.generatedFrom).toContain("source-ir/style-profile.json")
        expect(sourceProjectManifest.visualIteration.viewportMatrix[0].name).toBe("desktop-reference")
        expect(sourceProjectManifest.visualIteration.viewportMatrix[0].width).toBe(1366)
        expect(sourceProjectManifest.visualIteration.viewportMatrix[0].evidenceSource).toBe("capture_viewport")
        expect(sourceProjectManifest.sourceDomRegions.count).toBe(regionFiles.length)
        expect(sourceProjectManifest.sourceDomRegions.metricsModule).toBe("src/data/sourceDomRegions.ts")
        expect(sourceProjectManifest.sourceDomRegions.replacementPlanModule).toBe(
          "src/data/sourceDomReplacementPlan.ts",
        )
        expect(sourceProjectManifest.sourceDomRegions.iterationStateModule).toBe("src/data/sourceDomIterationState.ts")
        expect(sourceProjectManifest.sourceDomRegions.replacementPlanCount).toBeGreaterThan(0)
        expect(sourceProjectManifest.sourceDomRegions.semanticReplacementCount).toBe(2)
        expect(sourceProjectManifest.semanticReplacements.count).toBe(2)
        expect(sourceProjectManifest.sourceDomRegions.svgAssetGroupModule).toBe("src/data/sourceSvgAssetGroups.ts")
        expect(sourceProjectManifest.sourceDomRegions.faqGroupModule).toBe("src/data/sourceFaqGroups.ts")
        expect(sourceProjectManifest.sourceDomRegions.faqGroupCount).toBeGreaterThan(0)
      },
    })
  })

  test("turns repeated news card regions into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticNewsFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-news-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx"))
        expect(semanticFiles).toHaveLength(1)
        expect(sourceDomPage).toContain('from "./semantic/')

        const semanticComponent = await Bun.file(path.join(semanticDir, semanticFiles[0]!)).text()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()
        const sourceProjectManifest = JSON.parse(
          await Bun.file(path.join(outputDir, "src", "data", "sourceProjectManifest.json")).text(),
        )
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain(".map((item)")
        expect(semanticComponent).toContain('data-qa-id={"news-content"}')
        expect(semanticComponent).not.toContain("news-page")
        expect(semanticComponent).toContain("Factory Activity Expands")
        expect(semanticComponent).toContain("Construction Spending Increases")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomPage).toContain("<main")
        expect(sourceDomPage).toContain('className={"news-page"}')
        expect(await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()).toBe(false)
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"nextReplacement": null')
        expect(sourceProjectManifest.semanticReplacements.count).toBe(1)
      },
    })
  }, 30_000)

  test("turns BBC-style promo lists into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeBbcPromoFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-bbc-promo-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx"))
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()

        expect(semanticFiles).toHaveLength(1)
        expect(sourceDomPage).toContain('from "./semantic/')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, semanticFiles[0]!)).text()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain("promo_item")
        expect(semanticComponent).toContain(".map((item)")
        expect(semanticComponent).toContain("ssrcss-60rlar-Grid")
        expect(semanticComponent).toContain("ssrcss-ccqz3i-Promo")
        expect(semanticComponent).toContain("Massive Russian attack on cities across Ukraine kills at least 13 people")
        expect(semanticComponent).toContain("/assets/images/asset_000001.webp")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
      },
    })
  }, 30_000)

  test("turns source table heatmap regions into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticTableFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-table-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx"))
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toHaveLength(1)
        expect(semanticFiles[0]).toBe("EconomicIndicatorsHeatmapTable.tsx")
        expect(sourceDomPage).toContain('from "./semantic/EconomicIndicatorsHeatmapTable"')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, semanticFiles[0]!)).text()
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain(".headers.map((header)")
        expect(semanticComponent).toContain(".rows.map((row)")
        expect(semanticComponent).toContain("29.18 T")
        expect(semanticComponent).toContain("Government Debt to GDP")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"replacementKind": "data_table_or_heatmap_component"')
      },
    })
  }, 30_000)

  test("extracts structurally equivalent table, list, and navigation surfaces without business words", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeGenericStructureFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-generic-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()
        const generatedSource = await readGeneratedSource(outputDir)

        expect(semanticFiles).toContain("PlanComparisonTable.tsx")
        expect(semanticFiles).toContain("DeploymentQueueList.tsx")
        expect(semanticFiles).toContain("ResourceHubLinks.tsx")
        expect(sourceDomPage).toContain('from "./semantic/PlanComparisonTable"')
        expect(sourceDomPage).toContain('from "./semantic/DeploymentQueueList"')
        expect(sourceDomPage).toContain('from "./semantic/ResourceHubLinks"')
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 3')
        expect(sourceDomIterationState).toContain('"replacementKind": "data_table_or_heatmap_component"')
        expect(sourceDomIterationState).toContain('"replacementKind": "event_or_news_list_component"')
        expect(sourceDomIterationState).toContain('"replacementKind": "navigation_or_footer_component"')
        expect(generatedSource).toContain("Plan comparison")
        expect(generatedSource).toContain("Deployment queue")
        expect(generatedSource).toContain("Resource hub")
        expect(generatedSource).not.toContain("TradingView")
        expect(generatedSource).not.toContain("GDP")
        expect(generatedSource).not.toContain("Economic")
      },
    })
  }, 30_000)

  test("turns repeated economic event card regions into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticEventFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-events-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx"))
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toHaveLength(1)
        expect(semanticFiles[0]).toBe("EconomicCalendarList.tsx")
        expect(sourceDomPage).toContain('from "./semantic/EconomicCalendarList"')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, semanticFiles[0]!)).text()
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain(".items.map((item)")
        expect(semanticComponent).toContain("3-Month Bill Auction")
        expect(semanticComponent).toContain("Forecast")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"replacementKind": "event_or_news_list_component"')
      },
    })
  }, 30_000)

  test("turns repeated idea card regions into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticIdeaCardsFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-ideas-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx"))
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toContain("IdeasCards.tsx")
        expect(sourceDomPage).toContain('from "./semantic/IdeasCards"')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, "IdeasCards.tsx")).text()
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain("collection.cards.map((card)")
        expect(semanticComponent).toContain("US Savings Rate Collapsing!")
        expect(semanticComponent).toContain("See all popular ideas")
        expect(semanticComponent).toContain("asset_000002.webp")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"replacementKind": "card_collection_component"')
      },
    })
  }, 30_000)

  test("does not turn page shell regions into semantic news lists", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticNewsFixtureEvidence(tmp.path, { pageShell: true })
    const outputDir = path.join(tmp.path, "generated-news-page-shell-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx"))
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        expect(semanticFiles).toHaveLength(1)
        expect(semanticFiles[0]).not.toContain("PageShell")
        expect(sourceDomPage).not.toContain('from "./source-dom/PageShellRegion"')
        expect(sourceDomPage).toContain('className={"tv-main"}')
        expect(sourceDomPage).toContain('from "./semantic/')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, semanticFiles[0]!)).text()
        expect(semanticComponent).toContain('data-qa-id={"news-content"}')
        expect(semanticComponent).not.toContain("tv-main")
        expect(semanticComponent).not.toContain("page-shell")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"nextReplacement": null')
      },
    })
  }, 30_000)

  test("keeps composite widget shells out of the replacement queue and extracts their child surfaces", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeCompositeWidgetFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-composite-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()

        expect(sourceDomPage).not.toContain("CompositeWidgetRegion")
        expect(sourceDomIterationState).not.toContain("CompositeWidgetRegion")
        expect(semanticFiles).toContain("CompositeEventsList.tsx")
        expect(semanticFiles).toContain("CompositeHeatmapTable.tsx")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 2')
      },
    })
  }, 30_000)

  test("turns footer navigation regions into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticFooterFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-footer-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toContain("FooterNavigation.tsx")
        expect(sourceDomPage).toContain('from "./semantic/FooterNavigation"')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, "FooterNavigation.tsx")).text()
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain(".socialLinks.map((link)")
        expect(semanticComponent).toContain(".linkGroups.map((group")
        expect(semanticComponent).toContain(".columns.map((column)")
        expect(semanticComponent).toContain(".links.map((link)")
        expect(semanticComponent).toContain("footerLinksGroup-hezxxKBJ")
        expect(semanticComponent).toContain("footerLinksColumn-hezxxKBJ")
        expect(semanticComponent).toContain("lookFirstContainer-_gnlNXvh")
        expect(semanticComponent).toContain("TradingView on X")
        expect(semanticComponent).toContain("Select market data provided")
        expect(semanticComponent).not.toContain("semantic-source-footer-")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"replacementKind": "navigation_or_footer_component"')
      },
    })
  }, 30_000)

  test("turns SVG map asset regions into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticMapFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-map-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toContain("GlobalIndustrialMapSurface.tsx")
        expect(sourceDomPage).toContain('from "./semantic/GlobalIndustrialMapSurface"')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, "GlobalIndustrialMapSurface.tsx")).text()
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain("legend.items.map((item, index)")
        expect(semanticComponent).toContain("item.paths.map((path, pathIndex)")
        expect(semanticComponent).toContain(".paths.map((path, index)")
        expect(semanticComponent).toContain("surface.mapFrameNodes.findIndex")
        expect(semanticComponent).toContain("AssetPath")
        expect(semanticComponent).toContain("Global industrial map")
        expect(semanticComponent).toContain("See more global trends")
        expect(semanticComponent).toContain('"semanticRole": "mapContainer"')
        expect(semanticComponent).toContain('"className": "mapWrapper-PucT6CA9"')
        expect(semanticComponent).toContain('"className": "wrapper-RlLRHGou skeleton-PucT6CA9"')
        expect(semanticComponent).toContain('"data-qa-id": "core-map-content"')
        expect(semanticComponent).toContain('"legend": {')
        expect(semanticComponent).toContain('"viewBox": "0 0 600 34"')
        expect(semanticComponent).toContain('"svgViewBox": "0 0 745 372"')
        expect(semanticComponent).not.toContain('"svgViewBox": "0 0 600 34"')
        expect(semanticComponent).not.toContain('"assetPath": "../assets/svg/asset_000101.path.txt"')
        expect(semanticComponent).toContain('"strokeLinejoin": "miter"')
        expect(semanticComponent).not.toContain("SourceAssetPathGroup")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"replacementKind": "map_or_chart_asset_component"')
      },
    })
  }, 30_000)

  test("keeps mixed semantic section siblings when only part of the section can be replaced", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeMixedEconomicTrendsFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-mixed-economic-trends-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const sourceDomDir = path.join(outputDir, "src", "components", "source-dom")
        const sourceDomDirExists = (await fs.stat(sourceDomDir).catch(() => undefined))?.isDirectory() === true
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticTexts = await Promise.all(
          (await fs.readdir(semanticDir))
            .filter((file) => file.endsWith(".tsx"))
            .map((file) => Bun.file(path.join(semanticDir, file)).text()),
        )
        const generatedSource = [sourceDomPage, ...semanticTexts].join("\n")

        expect(sourceDomDirExists).toBe(false)
        expect(sourceDomPage).not.toContain("./source-dom/")
        expect(sourceDomPage).toContain('from "./semantic/InflationMapSurface"')
        expect(sourceDomPage).toContain('from "./semantic/GDPGrowthYoYRanking"')
        expect(sourceDomPage).toContain('from "./semantic/USUnemploymentRateMetricCard"')
        expect(generatedSource).toContain("InflationMap")
        expect(generatedSource).toContain("GDPGrowthYoY")
        expect(generatedSource).toContain("USUnemploymentRateMetricCard")
        expect(generatedSource).toContain("US unemployment rate")
        expect(generatedSource).toContain("4.3%")
        expect(generatedSource).toContain("Forecast")
      },
    })
  }, 30_000)

  test("turns metric ranking cards into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticMetricRankingFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-ranking-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toContain("GDPGrowthYoYRanking.tsx")
        expect(sourceDomPage).toContain('from "./semantic/GDPGrowthYoYRanking"')
        expect(sourceDomDirExists).toBe(false)

        const rankingComponent = await Bun.file(path.join(semanticDir, "GDPGrowthYoYRanking.tsx")).text()
        expect(rankingComponent).toContain("semantic-source-replacement")
        expect(rankingComponent).toContain("ranking.rows.map((row)")
        expect(rankingComponent).toContain("ranking.headerLabels.map((label)")
        expect(rankingComponent).toContain("GDP growth, YoY")
        expect(rankingComponent).toContain("Nominal GDP")
        expect(rankingComponent).toContain("India")
        expect(rankingComponent).toContain("7.80%")
        expect(rankingComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"replacementKind": "data_table_or_heatmap_component"')
      },
    })
  }, 30_000)

  test("turns repeated link-grid regions into semantic data-loop components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticLinkGridFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-link-grid-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toContain("CountriesLinks.tsx")
        expect(sourceDomPage).toContain('from "./semantic/CountriesLinks"')
        expect(sourceDomDirExists).toBe(false)

        const semanticComponent = await Bun.file(path.join(semanticDir, "CountriesLinks.tsx")).text()
        expect(semanticComponent).toContain("semantic-source-replacement")
        expect(semanticComponent).toContain(".links.map((link)")
        expect(semanticComponent).toContain("Argentina")
        expect(semanticComponent).toContain("United States")
        expect(semanticComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
        expect(sourceDomIterationState).toContain('"replacementKind": "navigation_or_footer_component"')
      },
    })
  }, 30_000)

  test("turns source header navigation into a semantic menu component", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticHeaderFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-header-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toContain("HeaderNavigation.tsx")
        expect(sourceDomPage).toContain('from "./semantic/HeaderNavigation"')
        expect(sourceDomDirExists).toBe(false)

        const headerComponent = await Bun.file(path.join(semanticDir, "HeaderNavigation.tsx")).text()
        expect(headerComponent).toContain("semantic-source-replacement")
        expect(headerComponent).toContain("header.menuItems.map((item)")
        expect(headerComponent).toContain('import { AssetPath } from "../AssetPath"')
        expect(headerComponent).toContain("Products")
        expect(headerComponent).toContain("{item.label}")
        expect(headerComponent.indexOf("{item.label}")).toBeLessThan(
          headerComponent.indexOf("<span className={item.chevronClassName}"),
        )
        expect(headerComponent).toContain('"logoTextFallback": "TradingView"')
        expect(headerComponent).toContain("semantic-source-header-logo-text")
        expect(headerComponent).toContain('"ariaLabel": "Open user menu"')
        expect(headerComponent).toContain('"label": ""')
        expect(headerComponent).toContain("Get started")
        expect(headerComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 1')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
      },
    })
  }, 30_000)

  test("turns section chrome around semantic child surfaces into semantic shell components", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeSemanticSectionShellFixtureEvidence(tmp.path)
    const outputDir = path.join(tmp.path, "generated-section-shell-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        await generateTool.execute({ webpageEvidenceDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const semanticDir = path.join(outputDir, "src", "components", "semantic")
        const semanticFiles = (await fs.readdir(semanticDir)).filter((file) => file.endsWith(".tsx")).sort()
        const sourceDomDirExists = await Bun.file(path.join(outputDir, "src", "components", "source-dom")).exists()
        const sourceDomIterationState = await Bun.file(
          path.join(outputDir, "src", "data", "sourceDomIterationState.ts"),
        ).text()

        expect(semanticFiles).toContain("IdeasSection.tsx")
        expect(sourceDomPage).toContain('from "./semantic/IdeasSection"')
        expect(sourceDomDirExists).toBe(false)

        const sectionComponent = await Bun.file(path.join(semanticDir, "IdeasSection.tsx")).text()
        expect(sectionComponent).toContain("semantic-source-replacement")
        expect(sectionComponent).toContain(".tabs.map((tab)")
        expect(sectionComponent).toContain("import {")
        expect(sectionComponent).toContain("Popular")
        expect(sectionComponent).toContain("See more ideas")
        expect(sectionComponent).not.toContain("data-source-node-id")
        expect(sourceDomIterationState).toContain('"semanticReplacementCount": 2')
        expect(sourceDomIterationState).toContain('"remainingRegionCount": 0')
      },
    })
  }, 30_000)
})

async function readGeneratedSource(outputDir: string): Promise<string> {
  return readGeneratedSourceDirectory(path.join(outputDir, "src"))
}

async function readGeneratedSourceDirectory(dir: string): Promise<string> {
  const files = await generatedSourceFiles(dir)
  return (await Promise.all(files.map((file) => Bun.file(file).text()))).join("\n")
}

async function generatedSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) return generatedSourceFiles(fullPath)
      return /\.(?:css|ts|tsx)$/.test(entry.name) ? [fullPath] : []
    }),
  )
  return files.flat().sort()
}

async function writeFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await Bun.write(
    path.join(webpageEvidenceDir, "extracted-page.json"),
    JSON.stringify(
      {
        url: "https://example.com/markets",
        viewport: { width: 1366, height: 768 },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="economic-calendar">
      <nav><a href="/markets">Markets</a></nav>
      <h1>Economic calendar</h1>
      <nav>
        <ol>
          <li data-source-node-id="crumb-current">
            <a data-source-node-id="crumb-link" href="/markets/economy">Crumb target</a>
          </li>
        </ol>
      </nav>
      <h2 data-source-node-id="mixed-title">
        <span data-source-node-id="mixed-wrap">
          Overview
          <span data-source-node-id="mixed-arrow" class="arrowWrap-fixture"></span>
        </span>
      </h2>
      <section data-source-node-id="style-1" style="--ui-card-bg: red; color: black">Styled card</section>
      <article class="preview-fSver7BK">
        <img class="image-fSver7BK" src="data:image/webp,__WEB_CLONE_DATA_URI_ASSET__" srcset="data:image/webp,__WEB_CLONE_DATA_URI_ASSET__ 1x" sizes="100vw" tabindex="-1" alt="">
        <h2>Market idea</h2>
      </article>
      <table>
        <thead><tr><th>Time</th><th>Country</th><th>Event</th><th>Actual</th></tr></thead>
        <tbody>
          <tr><td>08:30</td><td>US</td><td>GDP Growth Rate</td><td>2.1%</td></tr>
          <tr><td>09:45</td><td>US</td><td>Manufacturing PMI</td><td>51.3</td></tr>
        </tbody>
      </table>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    '.economic-calendar { display: grid; background-image: url(data:image/png;base64,AAAA); } [data-source-node-id="style-1"] { outline: 1px solid red; } [data-theme=dark] .background-test {background-position: 100% 100%,100%0}&:dir(rtl):after{background: red;};}',
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "full-source.css"),
    ".economic-calendar table { width: 100%; } [data-theme=dark] .background-test{&:dir(rtl):before{background: blue}&:dir(rtl):after{background: red}} .fade-test:after:dir(rtl){transform: rotate(-180deg);}",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "page.ir.json"),
    JSON.stringify(
      {
        root: {
          id: "root",
          tag: "body",
          layout: { bounds: { x: 0, y: 0, w: 1366, h: 768 } },
          attrs: [],
          children: [
            {
              id: "top-band",
              type: "element",
              tag: "header",
              layout: { bounds: { x: 0, y: 0, w: 1366, h: 64 } },
              attrs: [],
              children: [],
            },
            {
              id: "crumb-current",
              type: "element",
              tag: "li",
              attrs: [],
              children: [
                {
                  id: "crumb-divider",
                  type: "element",
                  tag: "span",
                  attrs: [
                    { name: "class", value: "divider-fixture" },
                    { name: "aria-hidden", value: "true" },
                  ],
                  children: [{ id: "crumb-divider-text", type: "text", text: "/" }],
                },
                {
                  id: "crumb-link",
                  type: "element",
                  tag: "a",
                  attrs: [{ name: "href", value: "/markets/economy" }],
                  children: [{ id: "crumb-link-text", type: "text", text: "Crumb target" }],
                },
              ],
            },
            {
              id: "mixed-wrap",
              type: "element",
              tag: "span",
              attrs: [],
              children: [
                {
                  id: "mixed-arrow",
                  type: "element",
                  tag: "span",
                  attrs: [{ name: "class", value: "arrowWrap-fixture" }],
                  children: [],
                },
              ],
            },
            {
              id: "style-1",
              type: "element",
              tag: "section",
              attrs: [{ name: "style", value: "--ui-card-bg: blue; color: green; display: block" }],
              children: [],
            },
          ],
        },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "images", "asset_000002.webp.txt"),
    "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        assets: [
          {
            id: "asset_000001",
            kind: "svg-path-data",
            path: "assets/svg/asset_000001.path.txt",
            sha256: "0".repeat(64),
            bytes: 12,
            chars: 12,
            semanticRole: "svg-geometry",
            preview: "M0 0H1V1",
            usedBy: [],
          },
          {
            id: "asset_000002",
            kind: "image-data-uri",
            mime: "image/webp",
            path: "assets/images/asset_000002.webp.txt",
            sha256: "1".repeat(64),
            bytes: 44,
            chars: 82,
            semanticRole: "preview-image",
            usedBy: [],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "EconomicCalendarShell",
            kind: "navigation",
            tag: "main",
            classNames: ["economic-calendar"],
            textPreview: ["Markets", "Economic calendar"],
          },
          {
            name: "EconomicCalendarTable",
            kind: "table",
            tag: "table",
            classNames: ["calendar-table"],
            textPreview: ["08:30", "GDP Growth Rate"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        tables: [
          {
            title: "Economic data",
            headers: ["Time", "Country", "Event", "Actual"],
            rows: [
              ["08:30", "US", "GDP Growth Rate", "2.1%"],
              ["09:45", "US", "Manufacturing PMI", "51.3"],
            ],
          },
        ],
        repeatedGroups: [
          { title: "Calendar rows", sampleTexts: ["08:30 US GDP Growth Rate 2.1%", "09:45 US Manufacturing PMI 51.3"] },
        ],
        stats: { totalTables: 1, totalLists: 0, totalCards: 0, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  return webpageEvidenceDir
}

async function writeRegionizedFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-regionized")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const mapPaths = Array.from({ length: 36 }, (_, index) => {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    return `<path data-source-node-id="map-${index + 1}" data-asset-d="../assets/svg/${assetId}.path.txt" id="land-${index + 1}" class="positive-s"></path>`
  }).join("")
  const sections = ["Overview", "Markets", "Ideas", "Indicators", "News", "Calendar"]
    .map(
      (title, sectionIndex) => `
      <section class="dashboard-section section-${sectionIndex}" data-source-node-id="${title.toLowerCase()}-region">
        <h2>${title}</h2>
        <div class="cards">
          ${Array.from(
            { length: 18 },
            (_, itemIndex) => `
            <article class="card">
              <h3>${title} item ${itemIndex + 1}</h3>
              <p>${title} row ${itemIndex + 1} GDP Growth Rate Manufacturing PMI Economic calendar</p>
            </article>
          `,
          ).join("")}
        </div>
      </section>
    `,
    )
    .join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="dashboard">
      ${sections}
      <section class="dashboard-section map-section">
        <h2>Map</h2>
        <svg viewBox="0 0 360 180" fill="currentColor">${mapPaths}</svg>
      </section>
      <section data-base-widget="true" data-container-name="faq" data-an-widget-id="faq" class="container-Gvxnai7n">
        <div class="header-Gvxnai7n header-l-Gvxnai7n">
          <div class="wrapper-BQZK4DnU center-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU">
                <h2 class="title-BQZK4DnU title-l-BQZK4DnU" id="faq">Frequently asked questions</h2>
              </div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n" data-qa-id="faq-content">
          <div class="wrapper-mGLyum4Y twoColumns-mGLyum4Y">
            <div class="column-mGLyum4Y">
              ${renderFixtureFaqItems(0, ["What is GDP?", "How is GDP calculated?", "What is inflation?"])}
            </div>
            <div class="column-mGLyum4Y">
              ${renderFixtureFaqItems(3, ["What is interest rate?", "How are interest rates calculated?", "What is real GDP?"])}
            </div>
          </div>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".dashboard { display: grid; gap: 24px; } .cards { display: grid; grid-template-columns: repeat(3, 1fr); }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "full-source.css"),
    ".card { border: 1px solid #ddd; padding: 12px; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "page.ir.json"),
    JSON.stringify(
      {
        root: {
          id: "root",
          type: "element",
          tag: "body",
          children: ["Overview", "Markets", "Ideas", "Indicators", "News", "Calendar"].map((title, index) => ({
            id: `${title.toLowerCase()}-region`,
            type: "element",
            tag: "section",
            layout: { bounds: { x: 0, y: index * 220, w: 1180, h: 180 } },
            children: [],
          })),
        },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "DashboardShell",
            kind: "page",
            tag: "main",
            classNames: ["dashboard"],
            textPreview: ["Overview", "Markets"],
          },
          ...["Overview", "Markets", "Ideas", "Indicators", "News", "Calendar"].map((name) => ({
            name: `${name}Region`,
            kind: "section",
            tag: "section",
            classNames: ["dashboard-section"],
            textPreview: [name, `${name} item 1`],
          })),
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: ["Overview", "Markets", "Ideas", "Indicators", "News", "Calendar"].map((title) => ({
          title,
          items: Array.from({ length: 18 }, (_, index) => `${title} item ${index + 1}`),
        })),
        repeatedGroups: [{ title: "Dashboard cards", sampleTexts: ["Overview item 1", "Markets item 1"] }],
        stats: { totalTables: 0, totalLists: 6, totalCards: 108, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  for (let index = 0; index < 36; index += 1) {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    await Bun.write(path.join(webpageEvidenceDir, "assets", "svg", `${assetId}.path.txt`), `M${index} ${index}h1v1z`)
  }
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticNewsFixtureEvidence(root: string, options: { pageShell?: boolean } = {}): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-news")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const cards = [
    ["Dow Jones Newswires", "Factory Activity Expands in May", "https://example.com/news/1"],
    ["dpa-AFX", "U.S. Construction Spending Increases", "https://example.com/news/2"],
    ["Reuters", "World Cup data dollars and drama", "https://example.com/news/3"],
    ["Mace News", "Manufacturing Index Rises", "https://example.com/news/4"],
  ]
    .map(
      ([source, title, href], index) => `
    <a data-source-role="card" href="${href}" target="_blank" class="card-news card-${index}">
      <article class="article-news" data-qa-id="news-headline-card">
        <div class="container-news">
          <div data-source-role="header" class="header-news">
            <span class="date-news"><relative-time class="apply-common-tooltip" title="Jun 1, 2026, 22:5${index} GMT+8"></relative-time></span>
            <span>${source}</span>
          </div>
          <div class="title-news" data-qa-id="news-headline-title" data-overflow-tooltip-text="${title}">
            ${title}
          </div>
        </div>
      </article>
    </a>
  `,
    )
    .join("")
  const mainHtml = `
    <main class="news-page" data-qa-id="news-page">
      <section class="ideas-region">
        <a data-source-role="card" href="https://example.com/ideas" class="idea-card">See all popular ideas</a>
      </section>
      <section class="content-news" data-source-node-id="news-region" data-qa-id="news-content">
        <div class="news-shell">
          <div data-source-role="grid" class="grid-news">
            ${cards}
          </div>
        </div>
      </section>
    </main>
  `
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    options.pageShell ? `<div class="tv-main" data-source-node-id="page-shell">${mainHtml}</div>` : mainHtml,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    `
    .news-page { display: block; }
    .content-news { color: #111827; }
    .grid-news { display: grid; gap: 8px; }
    .card-news { display: block; text-decoration: none; color: inherit; }
    .article-news { border-bottom: 1px solid #e5e7eb; padding: 8px 0; }
    .header-news { display: flex; gap: 8px; font-size: 12px; color: #6b7280; }
    .title-news { font-size: 14px; font-weight: 600; }
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "NewsPage",
            kind: "page",
            tag: "main",
            classNames: ["news-page"],
            textPreview: ["Factory Activity Expands in May"],
          },
          {
            name: "NewsList",
            kind: "list",
            tag: "section",
            classNames: ["content-news"],
            textPreview: ["Dow Jones Newswires", "Construction Spending Increases"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [
          {
            title: "News",
            items: [
              "Dow Jones Newswires Factory Activity Expands in May",
              "dpa-AFX U.S. Construction Spending Increases",
              "Reuters World Cup data dollars and drama",
              "Mace News Manufacturing Index Rises",
            ],
          },
        ],
        repeatedGroups: [
          { title: "News cards", sampleTexts: ["Factory Activity Expands in May", "Construction Spending Increases"] },
        ],
        stats: { totalTables: 0, totalLists: 1, totalCards: 4, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  return webpageEvidenceDir
}

async function writeBbcPromoFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-bbc-promo")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const rows = [
    [
      "Massive Russian attack on cities across Ukraine kills at least 13 people",
      "https://www.bbc.co.uk/news/articles/cx20p1",
      "asset_000001.webp",
      "People walk past a damaged building",
      "Europe",
    ],
    [
      "Prepare for El Nino - it could be the strongest in decades, UN warns",
      "https://www.bbc.co.uk/news/articles/cx20p2",
      "asset_000002.webp",
      "Firefighters stand in front of smoke",
      "Climate",
    ],
    [
      "Live Released Mandelson messages embarrassing, says minister",
      "https://www.bbc.co.uk/news/articles/cx20p3",
      "asset_000003.webp",
      "A minister speaks to camera",
      "Politics",
    ],
    [
      "Clashes continue in Lebanon despite Israel-Hezbollah ceasefire",
      "https://www.bbc.co.uk/news/articles/cx20p4",
      "asset_000004.webp",
      "A street scene in Lebanon",
      "World",
    ],
  ]
  const cards = rows
    .map(
      ([title, href, image, alt, source], index) => `
    <li data-source-node-id="promo-${index}" class="ssrcss-1dr5icq-ListItem e1gp961v0">
      <div data-testid="promo" type="article" class="ssrcss-ccqz3i-Promo e1vyq2e80">
        <div class="ssrcss-1je5cnc-PromoSwitchLayoutAtBreakpoints et5qctl0">
          <div class="ssrcss-vbl3xe-PromoContent exn3ah912">
            <div class="ssrcss-l0lt4o-Stack e1y4nx260">
              <h3>
                <a href="${href}" class="ssrcss-jrq4xn-PromoLink exn3ah94">
                  <span role="text">
                    <p class="ssrcss-6bmydz-PromoHeadline exn3ah99"><span aria-hidden="false">${title}</span></p>
                  </span>
                </a>
              </h3>
            </div>
            <div class="ssrcss-1gccci3-Stack e1y4nx260">
              <ul data-source-role="list" role="list" class="ssrcss-9tw7r1-MetadataStripContainer eh44mf03">
                <li role="listitem" class="ssrcss-sf7vdp-MetadataStripItem eh44mf01">
                  <span type="attribution" class="ssrcss-61mhsj-MetadataText e4wm5bw1">${source}</span>
                </li>
              </ul>
            </div>
          </div>
          <div class="ssrcss-z60stg-PromoImageContainer en81kx34">
            <div class="ssrcss-17h6w1t-PromoImageContainerInner en81kx32">
              <div class="ssrcss-fec6qv-ImageWrapper en81kx33">
                <span class="ssrcss-1f43yvp-Placeholder etlorgc0">
                  <picture><img alt="${alt}" src="/assets/images/${image}" width="240" height="135" class="ssrcss-egie1y-Image edrdn950"></picture>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </li>
  `,
    )
    .join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="bbc-page">
      <ul data-source-node-id="bbc-promo-list" data-source-role="list" role="list" class="ssrcss-60rlar-Grid e12imr580">
        ${cards}
      </ul>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    `
    .bbc-page { display: block; }
    .ssrcss-60rlar-Grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .ssrcss-1dr5icq-ListItem { list-style: none; }
    .ssrcss-ccqz3i-Promo { display: flex; flex-direction: column; }
    .ssrcss-jrq4xn-PromoLink { color: inherit; text-decoration: none; }
    .ssrcss-6bmydz-PromoHeadline { font-size: 16px; font-weight: 700; margin: 0; }
    .ssrcss-z60stg-PromoImageContainer { order: -1; }
    .ssrcss-egie1y-Image { display: block; width: 100%; height: auto; }
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "BbcPage",
            kind: "page",
            tag: "main",
            classNames: ["bbc-page"],
            textPreview: ["Massive Russian attack"],
          },
          {
            name: "BbcPromoList",
            kind: "list",
            tag: "ul",
            classNames: ["ssrcss-60rlar-Grid"],
            textPreview: rows.map((row) => row[0]),
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "BBC promos", items: rows.map((row) => `${row[4]} ${row[0]}`) }],
        repeatedGroups: [{ title: "BBC promo cards", sampleTexts: rows.slice(0, 2).map((row) => row[0]) }],
        stats: { totalTables: 0, totalLists: 1, totalCards: rows.length, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  for (const [, , image] of rows) {
    await Bun.write(path.join(webpageEvidenceDir, "assets", "images", image), minimalPngBytes())
  }
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticTableFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-table")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="economy-page">
      <section data-source-node-id="heatmap-region" data-base-widget="true" data-container-name="economic-indicators-heatmap" data-an-widget-id="economic-indicators-heatmap" class="container-Gvxnai7n">
        <div data-source-node-id="heatmap-header" data-source-role="header" class="header-Gvxnai7n header-m-Gvxnai7n">
          <div class="wrapper-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU">
                <a class="containerLink-BQZK4DnU" href="https://example.com/heatmap">
                  <h2 class="title-BQZK4DnU title-m-BQZK4DnU" id="economic-indicators-heatmap">Economic indicators heatmap</h2>
                </a>
              </div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n" data-qa-id="economic-indicators-heatmap-content">
          <div class="tableContainer-qfaqwkY6" style="--economic-cell-count: 3">
            <div class="container-ae3EQWDL">
              <table class="table-ae3EQWDL">
                <tbody class="tableBodyRow-ae3EQWDL">
                  <tr>
                    <th></th>
                    <th><a class="apply-overflow-tooltip" href="https://example.com/gdp"><span>GDP</span></a></th>
                    <th><a class="apply-overflow-tooltip" href="https://example.com/debt"><span>Government Debt to GDP</span></a></th>
                    <th><a class="apply-overflow-tooltip" href="https://example.com/inflation"><span>Inflation Rate</span></a></th>
                  </tr>
                  <tr>
                    <th><a class="container-DLeLhLqC" href="https://example.com/usa"><img class="logo-m0C6Ivpo" src="/assets/images/asset_000001.svg" alt=""><span class="country-DLeLhLqC">USA</span></a></th>
                    <td class="container-WOGqw5_Y tv-cross-table--neutral"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">29.18 T</span><span class="currency-VVOqFTlw">USD</span></div></span></td>
                    <td class="container-WOGqw5_Y tv-cross-table--negative-l"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">123.3</span><span class="currency-VVOqFTlw">% of GDP</span></div></span></td>
                    <td class="container-WOGqw5_Y tv-cross-table--positive-s"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">3.8</span><span class="currency-VVOqFTlw">%</span></div></span></td>
                  </tr>
                  <tr>
                    <th><a class="container-DLeLhLqC" href="https://example.com/india"><img class="logo-m0C6Ivpo" src="/assets/images/asset_000002.svg" alt=""><span class="country-DLeLhLqC">India</span></a></th>
                    <td class="container-WOGqw5_Y tv-cross-table--neutral"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">3.91 T</span><span class="currency-VVOqFTlw">USD</span></div></span></td>
                    <td class="container-WOGqw5_Y tv-cross-table--negative-m"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">81.92</span><span class="currency-VVOqFTlw">% of GDP</span></div></span></td>
                    <td class="container-WOGqw5_Y tv-cross-table--positive-m"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">3.48</span><span class="currency-VVOqFTlw">%</span></div></span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    `
    .economy-page { display: block; }
    .table-ae3EQWDL { border-collapse: collapse; width: 100%; }
    .table-ae3EQWDL th, .table-ae3EQWDL td { padding: 6px; }
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "EconomyPage",
            kind: "page",
            tag: "main",
            classNames: ["economy-page"],
            textPreview: ["Economic indicators heatmap"],
          },
          {
            name: "EconomicIndicatorsHeatmap",
            kind: "table",
            tag: "section",
            classNames: ["container-Gvxnai7n"],
            textPreview: ["GDP", "Government Debt to GDP"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        tables: [
          {
            title: "Economic indicators heatmap",
            headers: ["Country", "GDP", "Government Debt to GDP", "Inflation Rate"],
            rows: [
              ["USA", "29.18 T USD", "123.3 % of GDP", "3.8 %"],
              ["India", "3.91 T USD", "81.92 % of GDP", "3.48 %"],
            ],
          },
        ],
        repeatedGroups: [{ title: "Heatmap rows", sampleTexts: ["USA 29.18 T USD", "India 3.91 T USD"] }],
        stats: { totalTables: 1, totalLists: 0, totalCards: 0, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticEventFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-events")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const cards = [
    ["Today", "Jun 1, 2026, 23:30 GMT+8", "USA", "3-Month Bill Auction", "18:59", "—", "3.595", "%"],
    ["Today", "Jun 1, 2026, 23:30 GMT+8", "USA", "6-Month Bill Auction", "18:59", "—", "3.65", "%"],
    ["Tomorrow", "Jun 2, 2026, 10:00 GMT+8", "AR", "Tax Revenue", "—", "—", "17,400.8 B", "ARS"],
  ]
    .map(
      ([day, timestamp, country, title, actual, forecast, prior, unit], index) => `
    <a data-source-node-id="event-${index}" href="https://example.com/calendar/${index}" class="wrap-nj94V3ds">
      <div class="top-nj94V3ds">
        <div class="date-nj94V3ds">
          <div class="day-nj94V3ds">${day}</div>
          <div class="dot-RLEuHy6G">•</div>
          <div class="wrap-upK7dZLp apply-common-tooltip" title="${timestamp}">
            <span class="badge-upK7dZLp badge-SzX7mZwu large-SzX7mZwu hasChildren-SzX7mZwu">
              <span class="content-SzX7mZwu"></span>
            </span>
          </div>
        </div>
      </div>
      <div class="titleBlock-nj94V3ds">
        <img class="flagIcon-RLEuHy6G apply-common-tooltip icon-OJpk_CAQ" data-tooltip="${country}" src="/assets/images/asset_00000${index + 1}.svg">
        <div class="column-nj94V3ds">
          <span class="title-nj94V3ds apply-overflow-tooltip">${title}</span>
        </div>
      </div>
      <div class="stats-nj94V3ds">
        <div class="wrap-WQHPH4QV"><div class="title-WQHPH4QV">Actual</div><div class="valueWrap-jgbZPXpo"><div class="value-WQHPH4QV highlighted-WQHPH4QV">${actual}</div></div></div>
        <div class="wrap-jgbZPXpo"><div class="title-jgbZPXpo">Forecast</div><div class="valueWrap-jgbZPXpo"><div class="value-jgbZPXpo">${forecast}</div></div></div>
        <div class="wrap-jgbZPXpo"><div class="title-jgbZPXpo">Prior</div><div class="valueWrap-jgbZPXpo percent-jgbZPXpo"><div class="value-jgbZPXpo">${prior}</div><div class="unit-jgbZPXpo">${unit}</div></div></div>
      </div>
    </a>
  `,
    )
    .join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="events-page">
      <section data-source-node-id="calendar-region" data-base-widget="true" data-container-name="economic-calendar" data-an-widget-id="economic-calendar" class="container-Gvxnai7n">
        <div data-source-role="header" class="header-Gvxnai7n header-m-Gvxnai7n">
          <div class="wrapper-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU">
                <a class="containerLink-BQZK4DnU" href="https://example.com/calendar">
                  <h2 class="title-BQZK4DnU title-m-BQZK4DnU" id="economic-calendar">Economic Calendar</h2>
                </a>
              </div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n" data-qa-id="economic-calendar-content">
          <div class="wrapper-Shjakjnm">
            <div class="container-VfuW0jXu container-uOadWvgk">
              <div class="items-VfuW0jXu filmstripItems-uOadWvgk">
                <div class="offsetZone-VfuW0jXu internal-VfuW0jXu"></div>
                ${cards}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    `
    .events-page { display: block; }
    .items-VfuW0jXu { display: flex; gap: 8px; }
    .wrap-nj94V3ds { display: block; min-width: 160px; }
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "EventsPage",
            kind: "page",
            tag: "main",
            classNames: ["events-page"],
            textPreview: ["Economic Calendar"],
          },
          {
            name: "EconomicCalendar",
            kind: "list",
            tag: "section",
            classNames: ["container-Gvxnai7n"],
            textPreview: ["3-Month Bill Auction", "6-Month Bill Auction"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "Economic Calendar", items: ["3-Month Bill Auction", "6-Month Bill Auction", "Tax Revenue"] }],
        repeatedGroups: [
          { title: "Calendar cards", sampleTexts: ["Today 3-Month Bill Auction", "Today 6-Month Bill Auction"] },
        ],
        stats: { totalTables: 0, totalLists: 1, totalCards: 3, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticIdeaCardsFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-ideas")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="ideas-page">
      <section data-source-node-id="ideas-region" data-base-widget="true" data-container-name="ideas" data-an-widget-id="ideas" class="container-Gvxnai7n">
        <div data-source-role="header" class="header-Gvxnai7n header-m-Gvxnai7n">
          <div class="wrapper-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU">
                <a class="containerLink-BQZK4DnU" href="https://example.com/ideas/">
                  <h2 class="title-BQZK4DnU title-m-BQZK4DnU" id="ideas">Ideas</h2>
                </a>
              </div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n" data-qa-id="ideas-content">
          <div class="tabsContainer-pG1AYda9">
            <div class="scrollWrap-h5ZKzylb" data-name="square-tabs-buttons" style="--ui-lib-private-squareTabs-gap: 12px">
              <div id="ideas" role="tablist" aria-orientation="horizontal" class="squareTabs-h5ZKzylb medium-h5ZKzylb">
                <button role="tab" aria-selected="true" aria-disabled="false" data-qa-id="Popular" id="Popular" class="squareTabButton-h5ZKzylb selected-nqU_VJml" data-overflow-tooltip-text="Popular"><span>Popular</span></button>
                <button role="tab" aria-selected="false" aria-disabled="false" data-qa-id="Recent" id="Recent" class="squareTabButton-h5ZKzylb" data-overflow-tooltip-text="Recent"><span>Recent</span></button>
                <button role="tab" aria-selected="false" aria-disabled="false" data-qa-id="Video" id="Video" class="squareTabButton-h5ZKzylb" data-overflow-tooltip-text="Video"><span>Video</span></button>
              </div>
            </div>
          </div>
          <div class="cards-ufCPQ4zt">
            <div class="container-VfuW0jXu container-G_i5tbmC">
              <div class="items-VfuW0jXu filmstripItems-G_i5tbmC filmstripItems-ufCPQ4zt">
                <div class="offsetZone-VfuW0jXu internal-VfuW0jXu"></div>
                ${renderFixtureIdeaCard({
                  order: 1,
                  title: "US Savings Rate Collapsing!",
                  paragraph:
                    "Personal savings are collapsing back toward crisis-level territory while households lean on credit.",
                  symbol: "FRED:PSAVERT",
                  logoAsset: "asset_000001.svg.txt",
                  author: "by RealMacro",
                  date: "May 29",
                  boosts: "6",
                })}
                ${renderFixtureIdeaCard({
                  order: 2,
                  title: "$USGDPQQ - U.S GDP (Q1/2026)",
                  paragraph:
                    "The US economy expanded an annualized 1.6% in Q1 2026 with revisions to investment and spending.",
                  symbol: "ECONOMICS:USGDPQQ",
                  logoAsset: "asset_000003.svg.txt",
                  author: "by Mr_J__fx",
                  date: "May 29",
                  boosts: "0",
                })}
                ${renderFixtureIdeaCard({
                  order: 3,
                  title: "Gasoline futures hit one-month low",
                  paragraph: "Energy prices continue to soften as macro demand expectations shift lower.",
                  symbol: "ECONOMICS:USGSCH",
                  logoAsset: "asset_000005.svg.txt",
                  author: "by MarketWatcher",
                  date: "May 28",
                  boosts: "2",
                })}
                <a data-source-role="card" class="card-exuF9vc4" href="https://example.com/ideas/" style="order: 4">
                  <p class="content-exuF9vc4">
                    <span class="wrap-exuF9vc4">
                      <span class="text-exuF9vc4">See all popular ideas</span>
                      <span role="img" class="arrow-exuF9vc4" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6 11" width="6" height="11">
                          <path fill="currentColor" data-asset-d="../assets/svg/asset_000101.path.txt"></path>
                        </svg>
                      </span>
                    </span>
                  </p>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    [
      ".container-Gvxnai7n { display: block; }",
      ".items-VfuW0jXu { display: flex; gap: 12px; }",
      ".ideaCard-KRH6UCDh { width: 260px; }",
      ".preview-fSver7BK { position: relative; }",
    ].join("\n"),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          { name: "IdeasPage", kind: "page", tag: "main", classNames: ["ideas-page"], textPreview: ["Ideas"] },
          {
            name: "Ideas",
            kind: "section",
            tag: "section",
            classNames: ["container-Gvxnai7n"],
            textPreview: ["Popular", "US Savings Rate Collapsing!"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        cards: [
          {
            title: "US Savings Rate Collapsing!",
            text: ["Personal savings are collapsing"],
            fields: [{ label: "author", value: "by RealMacro" }],
          },
          {
            title: "$USGDPQQ - U.S GDP (Q1/2026)",
            text: ["The US economy expanded"],
            fields: [{ label: "author", value: "by Mr_J__fx" }],
          },
          {
            title: "Gasoline futures hit one-month low",
            text: ["Energy prices continue"],
            fields: [{ label: "author", value: "by MarketWatcher" }],
          },
        ],
        lists: [{ title: "Idea tabs", items: ["Popular", "Recent", "Video"] }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 3, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  for (const name of ["asset_000001.svg.txt", "asset_000003.svg.txt", "asset_000005.svg.txt"]) {
    await Bun.write(
      path.join(webpageEvidenceDir, "assets", "images", name),
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='8' fill='%230680ff'/%3E%3C/svg%3E",
    )
  }
  for (const name of ["asset_000002.webp.txt", "asset_000004.webp.txt", "asset_000006.webp.txt"]) {
    await Bun.write(
      path.join(webpageEvidenceDir, "assets", "images", name),
      "data:image/webp;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
    )
  }
  await Bun.write(path.join(webpageEvidenceDir, "assets", "svg", "asset_000101.path.txt"), "M0 0l6 5.5L0 11z")
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

function renderFixtureIdeaCard(input: {
  order: number
  title: string
  paragraph: string
  symbol: string
  logoAsset: string
  author: string
  date: string
  boosts: string
}): string {
  const href = `https://example.com/chart/${input.order}`
  return `
    <article data-source-role="card" class="card-exterior-GVAqO64h card-BhZ6wWkd stretch-link-title-BhZ6wWkd ideaCard-KRH6UCDh js-userlink-popup-anchor" style="order: ${input.order}">
      <div class="text-block-g3T8R9ac" style="--ui-lib-image-card-text-max-lines: 4; --ui-lib-image-card-text-max-title-lines: 2">
        <a href="${href}" data-qa-id="ui-lib-card-link-title" class="title-z9bt_ORN line-clamp-z9bt_ORN stretched-outline-z9bt_ORN">${input.title}</a>
        <a href="${href}" data-qa-id="ui-lib-card-link-paragraph" class="paragraph-R8L6vKJ3">
          <span class="line-clamp-container-R8L6vKJ3">
            <span class="line-clamp-content-R8L6vKJ3">${input.paragraph}</span>
          </span>
        </a>
      </div>
      <div class="preview-fSver7BK ratio16by9-fSver7BK preview-KRH6UCDh">
        <div data-source-role="grid" class="preview-grid-fSver7BK">
          <div class="corner-fSver7BK corner-top-right-fSver7BK"></div>
          <div class="corner-fSver7BK corner-bottom-left-fSver7BK">
            <a class="logoIcon-mEbG7MmD apply-common-tooltip link-mEbG7MmD previewRowItem-KRH6UCDh" href="https://example.com/symbol/${input.order}" title="${input.symbol}" data-qa-id="ui-lib-card-preview-link-icon">
              <img class="logo-m0C6Ivpo xsmall-m0C6Ivpo letter-m0C6Ivpo" src="../assets/images/${input.logoAsset}" alt="${input.symbol}">
            </a>
          </div>
          <a href="${href}" data-qa-id="ui-lib-card-link-image" tabindex="-1" aria-hidden="true" class="image-link-fSver7BK">
            <picture class="picture-fSver7BK">
              <img style="--ui-lib-image-card-preview-background: #ffffff" alt="" src="data:image/webp,__WEB_CLONE_DATA_URI_ASSET__" role="presentation" loading="lazy" class="image-fSver7BK">
            </picture>
          </a>
        </div>
      </div>
      <div class="section-Ue1L3TEK margin-medium-Ue1L3TEK credsButtonsRow-KRH6UCDh credsButtonsRowCustomMarginTop-KRH6UCDh">
        <div class="publicationInfoWrapper-KRH6UCDh">
          <address class="cardAuthorWrap-pWxlOpso" data-qa-id="ui-lib-card-link-author">
            <a href="https://example.com/u/${input.order}" class="cardAuthorLink-pWxlOpso">
              <span class="cardAuthor-pWxlOpso typographySocial-pWxlOpso">${input.author}</span>
            </a>
          </address>
          <div class="section-Ue1L3TEK margin-small-Ue1L3TEK">
            <time class="publicationDate-ijITjxvd apply-common-tooltip typographySocial-ijITjxvd" title="22:01 - ${input.date}, 2026">${input.date}</time>
          </div>
        </div>
        <div class="buttons-KRH6UCDh">
          <a data-qa-id="ui-lib-card-comment-button" title="Comment" href="${href}#comments" aria-label="0 comments" class="root-lKU75zSc apply-common-tooltip lightButton-Mym3My5x link-Mym3My5x noContent-Mym3My5x withStartSlot-Mym3My5x ghost-copAMuqO gray-copAMuqO medium-Mym3My5x typography-regular16px-Mym3My5x"></a>
          <button class="root-xboGuziR medium-xboGuziR apply-common-tooltip rootHoverAllowed-xboGuziR" type="button" title="Boost" aria-pressed="false" data-qa-id="ui-lib-card-like-button">
            <span role="img" class="hollowIcon-xboGuziR" aria-label="${input.boosts} boosts" aria-hidden="false"></span>
            <span class="container-FKLCOmT5"><span class="digitGrid-FKLCOmT5"><span class="digit-FKLCOmT5">${input.boosts}</span></span></span>
          </button>
        </div>
      </div>
    </article>
  `
}

async function writeCompositeWidgetFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-composite")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="composite-page">
      <section data-source-node-id="composite-widget" data-base-widget="true" data-container-name="composite-widget" class="container-Gvxnai7n">
        <div data-source-role="header" class="header-Gvxnai7n header-m-Gvxnai7n">
          <div class="wrapper-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU"><h2 class="title-BQZK4DnU title-m-BQZK4DnU">Composite widget</h2></div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n">
          <div class="container-KqgCoGM1">
            ${renderCompositeFixtureTable()}
            ${renderCompositeFixtureEvents()}
            <article data-source-node-id="manual-card" data-source-role="card" class="manual-card">
              <h3>Manual card</h3>
              ${Array.from({ length: 36 }, (_, index) => `<p>Manual card row ${index + 1} GDP Growth Rate</p>`).join("")}
            </article>
          </div>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".container-KqgCoGM1 { display: grid; gap: 12px; } .manual-card { padding: 8px; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "CompositePage",
            kind: "page",
            tag: "main",
            classNames: ["composite-page"],
            textPreview: ["Composite widget"],
          },
          {
            name: "CompositeWidget",
            kind: "section",
            tag: "section",
            classNames: ["container-Gvxnai7n"],
            textPreview: ["Composite widget"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        tables: [
          {
            title: "Composite heatmap",
            headers: ["Country", "GDP", "Inflation"],
            rows: [
              ["USA", "29.18 T USD", "3.8 %"],
              ["India", "3.91 T USD", "3.48 %"],
            ],
          },
        ],
        lists: [{ title: "Composite events", items: ["3-Month Bill Auction", "6-Month Bill Auction", "Tax Revenue"] }],
        repeatedGroups: [{ title: "Composite surfaces", sampleTexts: ["Composite heatmap", "Composite events"] }],
        stats: { totalTables: 1, totalLists: 1, totalCards: 4, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

function renderCompositeFixtureTable(): string {
  return `
    <section data-source-node-id="composite-table" data-base-widget="true" data-container-name="composite-heatmap" class="container-Gvxnai7n">
      <div data-source-role="header" class="header-Gvxnai7n"><div class="wrapper-BQZK4DnU"><span class="titleAndHintWrapper-BQZK4DnU"><div class="container-BQZK4DnU"><h2 class="title-BQZK4DnU" id="composite-heatmap">Composite heatmap</h2></div></span></div></div>
      <div class="content-Gvxnai7n"><div class="tableContainer-qfaqwkY6"><div class="container-ae3EQWDL"><table class="table-ae3EQWDL"><tbody class="tableBodyRow-ae3EQWDL">
        <tr><th></th><th><a href="https://example.com/gdp"><span>GDP</span></a></th><th><a href="https://example.com/inflation"><span>Inflation</span></a></th></tr>
        <tr><th><a class="container-DLeLhLqC" href="https://example.com/usa"><span class="country-DLeLhLqC">USA</span></a></th><td class="container-WOGqw5_Y"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">29.18 T</span><span class="currency-VVOqFTlw">USD</span></div></span></td><td class="container-WOGqw5_Y"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">3.8</span><span class="currency-VVOqFTlw">%</span></div></span></td></tr>
        <tr><th><a class="container-DLeLhLqC" href="https://example.com/india"><span class="country-DLeLhLqC">India</span></a></th><td class="container-WOGqw5_Y"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">3.91 T</span><span class="currency-VVOqFTlw">USD</span></div></span></td><td class="container-WOGqw5_Y"><span class="content-WOGqw5_Y"><div class="row-VVOqFTlw"><span class="js-symbol-last">3.48</span><span class="currency-VVOqFTlw">%</span></div></span></td></tr>
      </tbody></table></div></div></div>
    </section>
  `
}

function renderCompositeFixtureEvents(): string {
  const cards = ["3-Month Bill Auction", "6-Month Bill Auction", "Tax Revenue"]
    .map(
      (title, index) => `
    <a href="https://example.com/event/${index}" class="wrap-nj94V3ds">
      <div class="top-nj94V3ds"><div class="date-nj94V3ds"><div class="day-nj94V3ds">${index < 2 ? "Today" : "Tomorrow"}</div><div class="dot-RLEuHy6G">•</div><div class="wrap-upK7dZLp" title="Jun ${index + 1}, 2026, 23:30 GMT+8"><span class="badge-upK7dZLp"><span class="content-SzX7mZwu"></span></span></div></div></div>
      <div class="titleBlock-nj94V3ds"><div class="column-nj94V3ds"><span class="title-nj94V3ds">${title}</span></div></div>
      <div class="stats-nj94V3ds"><div class="wrap-WQHPH4QV"><div class="title-WQHPH4QV">Actual</div><div class="valueWrap-jgbZPXpo"><div class="value-WQHPH4QV">${index}</div></div></div><div class="wrap-jgbZPXpo"><div class="title-jgbZPXpo">Forecast</div><div class="valueWrap-jgbZPXpo"><div class="value-jgbZPXpo">—</div></div></div><div class="wrap-jgbZPXpo"><div class="title-jgbZPXpo">Prior</div><div class="valueWrap-jgbZPXpo"><div class="value-jgbZPXpo">${index + 1}</div><div class="unit-jgbZPXpo">%</div></div></div></div>
    </a>
  `,
    )
    .join("")
  return `
    <section data-source-node-id="composite-events" data-base-widget="true" data-container-name="composite-events" class="container-Gvxnai7n">
      <div data-source-role="header" class="header-Gvxnai7n"><div class="wrapper-BQZK4DnU"><span class="titleAndHintWrapper-BQZK4DnU"><div class="container-BQZK4DnU"><h2 class="title-BQZK4DnU" id="composite-events">Composite events</h2></div></span></div></div>
      <div class="content-Gvxnai7n"><div class="wrapper-Shjakjnm"><div class="container-VfuW0jXu"><div class="items-VfuW0jXu">${cards}</div></div></div></div>
    </section>
  `
}

async function writeSemanticFooterFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-footer")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <footer data-source-node-id="footer-region" data-source-role="footer" class="tv-footer js-footer" data-nosnippet="">
      <div class="js-promo-footer-init-ssr">
        <div class="root-_gnlNXvh">
          <div class="container-_gnlNXvh">
            <div class="content-_gnlNXvh">
              <div>
                <div class="logoSocials-_gnlNXvh">
                  <a class="logoWrapper-_gnlNXvh" href="https://www.tradingview.com/" aria-label="TradingView main page"><span class="logo-_gnlNXvh"></span></a>
                  <div class="socials-bGBbwUbv">
                    <a href="https://x.com/tradingview/" rel="nofollow" target="_blank" aria-label="TradingView on X" class="socialsItem-bGBbwUbv"><span class="slot-Mym3My5x"></span></a>
                    <a href="https://www.facebook.com/tradingview/" rel="nofollow" target="_blank" aria-label="TradingView on Facebook" class="socialsItem-bGBbwUbv"><span class="slot-Mym3My5x"></span></a>
                    <a href="https://www.youtube.com/@TradingView" rel="nofollow" target="_blank" aria-label="TradingView on YouTube" class="socialsItem-bGBbwUbv"><span class="slot-Mym3My5x"></span></a>
                    <a href="https://www.instagram.com/tradingview/" rel="nofollow" target="_blank" aria-label="TradingView on Instagram" class="socialsItem-bGBbwUbv"><span class="slot-Mym3My5x"></span></a>
                  </div>
                </div>
                <div class="copyrightContainer-_gnlNXvh">
                  <button class="languageButton-_gnlNXvh">English</button>
                  <p class="copyright-_gnlNXvh">
                    <span>Select market data provided by <a class="textLink-_gnlNXvh" href="https://www.theice.com/market-data">ICE Data Services</a>.</span>
                    <span>Select reference data provided by FactSet. Copyright 2026 FactSet Research Systems Inc.</span>
                    <span>Copyright 2026 TradingView, Inc.</span>
                  </p>
                </div>
              </div>
              <div class="footerLinks-hezxxKBJ">
                <div class="footerLinksGroup-hezxxKBJ">
                  <div class="footerLinksColumn-hezxxKBJ">
                    <span class="footerLinksColumnTitle-hezxxKBJ">More than a product</span>
                    <ul class="footerLinksColumnList-hezxxKBJ">
                      <li><a class="footerLinksColumnListItem-hezxxKBJ" href="https://example.com/supercharts">Supercharts</a></li>
                    </ul>
                  </div>
                  <div class="footerLinksColumn-hezxxKBJ">
                    <span class="footerLinksColumnTitle-hezxxKBJ">Screeners</span>
                    <ul class="footerLinksColumnList-hezxxKBJ">
                      <li><a class="footerLinksColumnListItem-hezxxKBJ" href="https://example.com/screener">Screener</a></li>
                      <li><a class="footerLinksColumnListItem-hezxxKBJ" href="https://example.com/pricing">Pricing</a></li>
                    </ul>
                  </div>
                </div>
                <div class="footerLinksGroup-hezxxKBJ showTablet-hezxxKBJ">
                  <div class="footerLinksColumn-hezxxKBJ">
                    <span class="footerLinksColumnTitle-hezxxKBJ">Business solutions</span>
                    <ul class="footerLinksColumnList-hezxxKBJ">
                      <li><a class="footerLinksColumnListItem-hezxxKBJ" href="https://example.com/widgets">Widgets</a></li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <div class="backgroundImage-_gnlNXvh"></div>
            <div class="lookFirstContainer-_gnlNXvh">
              <img class="lookFirstImg-_gnlNXvh lightImg-_gnlNXvh" src="/assets/images/asset_000001.svg" alt="Look First">
              <div class="pepeContainer-_gnlNXvh animatePepe-_gnlNXvh"></div>
            </div>
            <div class="pepeLauncher-_gnlNXvh"></div>
          </div>
        </div>
      </div>
    </footer>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".tv-footer { padding: 24px; } .footerLinks-hezxxKBJ { display: flex; gap: 8px; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "Footer",
            kind: "footer",
            tag: "footer",
            classNames: ["tv-footer"],
            textPreview: ["TradingView", "Supercharts", "Select market data provided"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "Footer links", items: ["Supercharts", "Screener", "Pricing", "Widgets"] }],
        repeatedGroups: [{ title: "Footer links", sampleTexts: ["Supercharts", "Screener"] }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 0, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticMapFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-map")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const mapPaths = Array.from({ length: 24 }, (_, index) => {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    const colorClass = index % 2 === 0 ? "country-positive" : "country-neutral"
    return `<path data-source-node-id="map-path-${index + 1}" data-asset-d="../assets/svg/${assetId}.path.txt" id="country-${index + 1}" class="${colorClass}" fill="var(--color-s)" stroke="#fff" stroke-linejoin="miter" style="--country-index: ${index + 1}"></path>`
  }).join("")
  const legendPaths = Array.from({ length: 16 }, (_, index) => {
    const assetId = `asset_${String(index + 101).padStart(6, "0")}`
    return `<path data-source-node-id="legend-path-${index + 1}" data-asset-d="../assets/svg/${assetId}.path.txt" class="legend-swatch" fill="currentColor"></path>`
  }).join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="map-page">
      <section data-source-node-id="global-map-region" data-base-widget="true" data-container-name="global-industrial-map" data-an-widget-id="global-industrial-map" class="container-Gvxnai7n">
        <div data-source-role="header" class="header-Gvxnai7n header-m-Gvxnai7n">
          <div class="wrapper-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU">
                <a class="containerLink-BQZK4DnU" href="https://example.com/global-trends">
                  <h2 class="title-BQZK4DnU title-m-BQZK4DnU" id="global-industrial-map">Global industrial map</h2>
                </a>
              </div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n" data-qa-id="global-industrial-map-content">
          <div class="container-xYQiJfBC">
            <div class="map-xYQiJfBC">
              <div class="container-PucT6CA9">
                <div class="mapContainer-PucT6CA9 loaded-PucT6CA9" data-color-preset="color-heatmap-tv-blue" data-qa-id="core-map-container-status" data-loading-status="loaded">
                  <div class="legend-PucT6CA9">
                    <svg viewBox="0 0 600 34" fill="none" style="overflow: visible">
                      ${legendPaths}
                      <g class="apply-common-tooltip" title="0 to 3%"><text x="99" y="12" class="text-IyWyk2Ci">3 %</text></g>
                      <g class="apply-common-tooltip" title="3 to 7%"><text x="199" y="12" class="text-IyWyk2Ci">7 %</text></g>
                    </svg>
                  </div>
                  <div class="mapWrapper-PucT6CA9">
                    <div class="wrapper-RlLRHGou skeleton-PucT6CA9">
                      <span data-qa-id="core-map-content" class="map-PucT6CA9">
                        <svg viewBox="0 0 745 372" fill="currentColor" preserveAspectRatio="xMidYMid meet" class="world-map">
                          ${mapPaths}
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div data-source-role="footer" class="footer-Gvxnai7n">
          <a href="https://example.com/global-trends" class="button-sUC06VNJ">See more global trends</a>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    `
    .map-page { display: block; }
    .map-PucT6CA9 { display: block; }
    .world-map { width: 100%; }
    .country-positive { color: #22ab94; }
    .country-neutral { color: #9598a1; }
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "MapPage",
            kind: "page",
            tag: "main",
            classNames: ["map-page"],
            textPreview: ["Global industrial map"],
          },
          {
            name: "GlobalIndustrialMap",
            kind: "map",
            tag: "section",
            classNames: ["container-Gvxnai7n"],
            textPreview: ["Global industrial map", "See more global trends"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "Global industrial map", items: ["0 to 3%", "3 to 7%", "See more global trends"] }],
        repeatedGroups: [{ title: "Map paths", sampleTexts: ["country-1", "country-2"] }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 0, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  for (let index = 0; index < 24; index += 1) {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    await Bun.write(path.join(webpageEvidenceDir, "assets", "svg", `${assetId}.path.txt`), `M${index} ${index}h4v4z`)
  }
  for (let index = 0; index < 16; index += 1) {
    const assetId = `asset_${String(index + 101).padStart(6, "0")}`
    await Bun.write(path.join(webpageEvidenceDir, "assets", "svg", `${assetId}.path.txt`), `M${index} 0h2v2z`)
  }
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticMetricRankingFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-ranking")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const rows = [
    ["India", "india", "7.80%", "3.91 T", "USD", "asset_000449.svg.txt"],
    ["Indonesia", "indonesia", "5.61%", "1.40 T", "USD", "asset_000450.svg.txt"],
    ["Mainland China", "china", "5.00%", "18.74 T", "USD", "asset_000451.svg.txt"],
  ]
    .map(
      ([label, slug, growth, nominal, unit, image], index) => `
    <li data-source-node-id="ranking-row-${index}" class="item-LBIMiZWE">
      <div class="container-lLGceaUg containerWithHover-lLGceaUg">
        <div class="container-zBPPLXWm">
          <img class="logo-m0C6Ivpo medium-m0C6Ivpo logo-KWH0mxBE letter-m0C6Ivpo" src="../assets/images/${image}" alt="">
          <a href="https://example.com/countries/${slug}/" class="container-Nt5iBa6X link-Nt5iBa6X container-IIKn4NmC">
            <div class="titleContainer-IIKn4NmC">
              <span class="title-IIKn4NmC apply-overflow-tooltip" data-overflow-tooltip-text="${label}">${label}</span>
            </div>
          </a>
          <span class="container-ItI7saAL"><span class="value-ItI7saAL">${growth}</span><span class="unit-ItI7saAL"></span></span>
          <span class="container-ItI7saAL"><span class="value-ItI7saAL">${nominal}</span><span class="unit-ItI7saAL">${unit}</span></span>
        </div>
      </div>
    </li>
  `,
    )
    .join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="ranking-page">
      <div data-source-node-id="ranking-card" data-source-role="card" class="card-_bHcdE9E">
        <div class="wrapper-LBIMiZWE">
          <div data-source-role="header" class="header-LBIMiZWE">GDP growth, YoY</div>
          <div data-source-role="header" class="header-WMQb_1Ui column-LBIMiZWE">
            <span>Country</span>
            <span>GDP Growth</span>
            <span>Nominal GDP</span>
          </div>
          <ul data-source-role="list" class="container-LBIMiZWE">
            ${rows}
          </ul>
        </div>
      </div>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    `
    .ranking-page { display: block; }
    .card-_bHcdE9E { border: 1px solid #e0e3eb; border-radius: 8px; }
    .container-zBPPLXWm { display: grid; grid-template-columns: 40px 1fr 96px 110px; }
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "RankingPage",
            kind: "page",
            tag: "main",
            classNames: ["ranking-page"],
            textPreview: ["GDP growth, YoY"],
          },
          {
            name: "GdpGrowthYoy",
            kind: "ranking-card",
            tag: "div",
            classNames: ["card-_bHcdE9E"],
            textPreview: ["India", "Indonesia", "Nominal GDP"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "GDP growth, YoY", items: ["India", "Indonesia", "Mainland China"] }],
        repeatedGroups: [{ title: "GDP growth rows", sampleTexts: ["India 7.80%", "Indonesia 5.61%"] }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 1, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  for (const asset of ["asset_000449.svg.txt", "asset_000450.svg.txt", "asset_000451.svg.txt"]) {
    await Bun.write(
      path.join(webpageEvidenceDir, "assets", "images", asset),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#2962ff"/></svg>`,
    )
  }
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeMixedEconomicTrendsFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-mixed-economic-trends")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const mapPaths = Array.from({ length: 20 }, (_, index) => {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    return `<path data-source-node-id="map-path-${index}" data-asset-d="../assets/svg/${assetId}.path.txt" id="country-${index}" class="positive-s" fill="currentColor"></path>`
  }).join("")
  const rows = ["India", "Indonesia", "Mainland China"]
    .map(
      (label, index) => `
    <li class="item-LBIMiZWE">
      <div class="container-lLGceaUg"><div class="container-zBPPLXWm">
        <a href="https://example.com/${index}" class="container-Nt5iBa6X"><span class="title-IIKn4NmC">${label}</span></a>
        <span class="container-ItI7saAL"><span class="value-ItI7saAL">${index === 0 ? "7.80%" : index === 1 ? "5.61%" : "5.00%"}</span></span>
        <span class="container-ItI7saAL"><span class="value-ItI7saAL">${index + 1}.40 T</span><span class="unit-ItI7saAL">USD</span></span>
      </div></div>
    </li>
  `,
    )
    .join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="mixed-page">
      <section data-source-node-id="economic-trends-region" data-base-widget="true" data-container-name="economy-market-summary" data-an-widget-id="economy-market-summary" class="container-Gvxnai7n">
        <div data-source-role="header" class="header-Gvxnai7n"><div class="wrapper-BQZK4DnU"><span class="titleAndHintWrapper-BQZK4DnU"><div class="container-BQZK4DnU"><h2 class="title-BQZK4DnU">Economic trends</h2></div></span></div></div>
        <div class="content-Gvxnai7n" data-qa-id="economy-market-summary-content">
          <div class="container-KqgCoGM1">
            <div class="card-_bHcdE9E">
              <span class="title-KqgCoGM1">Inflation map</span>
              <div class="map-KqgCoGM1"><span data-qa-id="core-map-content" class="map-PucT6CA9"><svg viewBox="0 0 745 372">${mapPaths}</svg></span></div>
            </div>
            <div class="card-_bHcdE9E">
              <span class="title-KqgCoGM1">GDP growth, YoY</span>
              <div class="header-WMQb_1Ui column-LBIMiZWE"><span>Country</span><span>GDP Growth</span><span>Nominal GDP</span></div>
              <ul class="list-LBIMiZWE">${rows}</ul>
            </div>
            <div class="card-_bHcdE9E">
              <div class="header-Q4ifml3p"><a href="https://example.com/usur"><span class="title-uk1zko9U">US unemployment rate</span><span class="tickerBox-uk1zko9U">USUR</span></a></div>
              <div class="content-Q4ifml3p"><div class="container-xBNJX2CY"><div class="chart-xBNJX2CY"><div class="tv-lightweight-charts"><table style="height: 20px; width: 40px"><tr><td style="padding: 0px"><canvas width="40" height="20" style="background-image: url('/assets/images/asset_000100.png'); width: 40px; height: 20px"></canvas></td></tr></table></div></div></div></div>
              <div class="wrapper-vE74cYTn"><div class="container-vE74cYTn">
                <div class="wrapper-yXjDRT2e"><div class="label-yXjDRT2e">Actual</div><div class="value-yXjDRT2e">4.3%</div></div>
                <div class="wrapper-yXjDRT2e"><div class="label-yXjDRT2e">Forecast</div><div class="value-yXjDRT2e">4.3%</div></div>
              </div></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".container-KqgCoGM1 { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; } .card-_bHcdE9E { border: 1px solid #eee; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "EconomicTrends",
            kind: "section",
            tag: "section",
            textPreview: ["Inflation map", "GDP growth, YoY", "US unemployment rate"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        cards: [{ title: "Inflation map" }, { title: "GDP growth, YoY" }, { title: "US unemployment rate" }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 3, totalRepeatedGroups: 0 },
      },
      null,
      2,
    ),
  )
  for (let index = 0; index < 20; index += 1) {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    await Bun.write(path.join(webpageEvidenceDir, "assets", "svg", `${assetId}.path.txt`), `M${index} ${index}h2v2z`)
  }
  await Bun.write(path.join(webpageEvidenceDir, "assets", "images", "asset_000100.png"), minimalPngBytes())
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticLinkGridFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-link-grid")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const countries = [
    ["Argentina", "argentina"],
    ["Australia", "australia"],
    ["Brazil", "brazil"],
    ["Canada", "canada"],
    ["European Union", "european-union"],
    ["France", "france"],
    ["Germany", "germany"],
    ["India", "india"],
    ["United States", "united-states"],
  ]
  const links = countries
    .map(
      ([label, slug]) => `
    <a href="https://example.com/countries/${slug}/" class="button-A2DTx07J roundButton-wc15_bxY link-A2GavdUb">
      <span class="content-wc15_bxY">${label}</span>
    </a>
  `,
    )
    .join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="countries-page">
      <section data-source-node-id="countries-region" data-base-widget="true" data-container-name="countries" data-an-widget-id="countries" class="container-Gvxnai7n">
        <div data-source-role="header" class="header-Gvxnai7n header-m-Gvxnai7n">
          <div class="wrapper-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU">
                <a class="containerLink-BQZK4DnU" href="https://example.com/countries/">
                  <h2 class="title-BQZK4DnU title-m-BQZK4DnU" id="countries">Countries</h2>
                </a>
              </div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n" data-qa-id="countries-content">
          <div class="container-A2DTx07J">
            ${links}
          </div>
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".container-A2DTx07J { display: flex; flex-wrap: wrap; gap: 8px; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "CountriesPage",
            kind: "page",
            tag: "main",
            classNames: ["countries-page"],
            textPreview: ["Countries"],
          },
          {
            name: "Countries",
            kind: "navigation",
            tag: "section",
            classNames: ["container-Gvxnai7n"],
            textPreview: ["Argentina", "United States"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "Countries", items: countries.map(([label]) => label) }],
        repeatedGroups: [{ title: "Country links", sampleTexts: ["Argentina", "Australia"] }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 0, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticHeaderFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-header")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const iconPaths = Array.from({ length: 8 }, (_, index) => {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    return `<path data-source-node-id="header-icon-${index + 1}" data-asset-d="../assets/svg/${assetId}.path.txt" fill="currentColor"></path>`
  })
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="header-page">
      <div data-source-node-id="header-region" data-source-role="header" class="tv-header tv-header__top js-site-header-container tv-header--sticky">
        <div data-source-node-id="header-backdrop" class="tv-header__backdrop sf-hidden"></div>
        <div data-source-node-id="header-inner" class="tv-header__inner">
          <div data-source-node-id="header-logo-area" class="tv-header__area tv-header__area--logo-menu">
            <button data-source-node-id="hamburger" class="tv-header__hamburger-menu js-header-main-menu-mobile-button sf-hidden" aria-haspopup="true" aria-expanded="false" aria-label="Open menu">
              <svg width="18" height="12" viewBox="0 0 18 12">${iconPaths[0]}</svg>
            </button>
            <span data-source-node-id="logo-wrapper" class="tv-header__logo">
              <a data-source-node-id="logo-link" data-source-role="header" href="https://example.com/" aria-label="TradingView main page" class="tv-header__link tv-header__link--logo js-header-context-menu">
                <span data-source-node-id="logo-icon-wrapper" class="tv-header__icon"><svg width="36" height="28" viewBox="0 0 36 28">${iconPaths[1]}<circle data-source-node-id="logo-dot" cx="20" cy="8" r="4" fill="currentColor"></circle></svg></span>
                <span data-source-node-id="logo-pro" class="js-logo-pro "></span>
              </a>
            </span>
          </div>
          <div data-source-node-id="middle-wrapper" class="tv-header__middle-wrapper">
            <div data-source-node-id="middle-content" class="tv-header__middle-content">
              <div data-source-node-id="search-area" class="tv-header__area tv-header__area--search">
                <div data-source-node-id="search-container" data-source-role="header" class="tv-header-search-container">
                  <button data-source-node-id="search-button" data-source-role="header" class="tv-header-search-container tv-header-search-container__button tv-header-search-container__button--full js-header-search-button" aria-label="Search">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">${iconPaths[3]}</svg>
                    <span data-source-node-id="search-label" data-source-role="header" class="tv-header-search-container__text"> Search </span>
                  </button>
                  <button data-source-node-id="simple-search-button" class="tv-header-search-container__button tv-header-search-container__button--simple js-header-search-button sf-hidden" aria-label="Search">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">${iconPaths[4]}</svg>
                  </button>
                </div>
              </div>
              <nav data-source-node-id="nav" data-source-role="nav" class="tv-header__area tv-header__area--menu js-header-main-menu">
                <ul data-source-node-id="menu-list" data-source-role="list" class="tv-header__main-menu">
                  ${["Products", "Community", "Markets", "Brokers", "More"]
                    .map(
                      (label, index) => `
                    <li data-source-node-id="menu-${index}" class="tv-header__main-menu-item" data-main-menu-dropdown-root-index="${index}">
                      <a data-source-node-id="menu-link-${index}" data-main-menu-root-track-id="${label.toLowerCase()}" href="https://example.com/${label.toLowerCase()}/">
                        <span data-source-node-id="menu-chevron-${index}" class="tv-header__main-menu-item__chevron" aria-haspopup="true" aria-expanded="false" aria-label="${label} menu" role="button"><svg width="18" height="18" viewBox="0 0 18 18">${iconPaths[5]}</svg></span>
                        ${label}
                      </a>
                    </li>
                  `,
                    )
                    .join("")}
                </ul>
              </nav>
            </div>
          </div>
          <div data-source-node-id="user-area" class="tv-header__area tv-header__area--user">
            <button data-source-node-id="language" data-source-role="header" aria-haspopup="true" aria-expanded="false" aria-label="Open language menu" type="button" class="tv-header__language-button js-header-language-button"><svg width="28" height="28" viewBox="0 0 28 28">${iconPaths[6]}</svg> EN </button>
            <button data-source-node-id="user-menu" data-source-role="header" aria-haspopup="true" aria-expanded="false" aria-label="Open user menu" type="button" class="tv-header__user-menu-button tv-header__user-menu-button--anonymous js-header-user-menu-button"><svg width="28" height="28" viewBox="0 0 28 28">${iconPaths[7]}</svg></button>
            <button data-source-node-id="logged-user-menu" aria-haspopup="true" aria-expanded="false" aria-label="Open user menu" type="button" class="tv-header__user-menu-button tv-header__user-menu-button--logged js-header-user-menu-button sf-hidden"></button>
            <div data-source-node-id="offer-shell" class="js-offer-button" data-props-id="offer-1" data-render-mode="legacy">
              <div data-source-node-id="offer-container" class="tv-header__offer-button-container tv-header__offer-button-container--trial-join">
                <a data-source-node-id="offer-link" href="https://example.com/pricing/" class="tv-header__offer-button slashButtonColor-CScppXCg gradient-CScppXCg slashButton-jr14r9WO medium-jr14r9WO">
                  <span data-source-node-id="offer-content" class="apply-overflow-tooltip content-CScppXCg content-jr14r9WO" data-overflow-tooltip-text="Get started">
                    <span data-source-node-id="offer-children" class="children-jr14r9WO onlyLabel-jr14r9WO">
                      <span data-source-node-id="offer-title" class="tv-header__offer-button-title">Get started</span>
                    </span>
                  </span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".tv-header__inner { display: flex; align-items: center; } .tv-header__main-menu { display: flex; gap: 12px; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "HeaderPage",
            kind: "page",
            tag: "main",
            classNames: ["header-page"],
            textPreview: ["Products", "Get started"],
          },
          {
            name: "Header",
            kind: "navigation",
            tag: "div",
            classNames: ["tv-header"],
            textPreview: ["Products", "Community", "Markets"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "Header menu", items: ["Products", "Community", "Markets", "Brokers", "More"] }],
        repeatedGroups: [{ title: "Header links", sampleTexts: ["Products", "Community"] }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 0, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  for (let index = 0; index < 8; index += 1) {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    await Bun.write(path.join(webpageEvidenceDir, "assets", "svg", `${assetId}.path.txt`), `M${index} ${index}h4v4z`)
  }
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

async function writeSemanticSectionShellFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-section-shell")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  const chartPaths = Array.from({ length: 18 }, (_, index) => {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    return `<path data-source-node-id="idea-path-${index + 1}" data-asset-d="../assets/svg/${assetId}.path.txt" id="series-${index + 1}" class="series-path" fill="currentColor"></path>`
  }).join("")
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="ideas-page">
      <div data-source-node-id="ideas-wrapper" style="--filmstrip-right-button-order: 11">
      <section data-source-node-id="ideas-region" data-base-widget="true" data-container-name="ideas" data-an-widget-id="ideas" class="container-Gvxnai7n">
        <div data-source-role="header" class="header-Gvxnai7n header-m-Gvxnai7n">
          <div class="wrapper-BQZK4DnU wrap-BQZK4DnU">
            <span class="titleAndHintWrapper-BQZK4DnU truncated-BQZK4DnU">
              <div class="container-BQZK4DnU">
                <a class="containerLink-BQZK4DnU" href="https://example.com/ideas/">
                  <h2 class="title-BQZK4DnU title-m-BQZK4DnU" id="ideas">Ideas</h2>
                </a>
              </div>
            </span>
          </div>
        </div>
        <div class="content-Gvxnai7n" data-qa-id="ideas-content">
          <div class="tabsContainer-pG1AYda9">
            <div id="ideas-tabs" role="tablist" aria-orientation="horizontal" class="squareTabs-h5ZKzylb">
              <button role="tab" aria-selected="true" aria-disabled="false" data-qa-id="Popular" id="Popular" class="squareTabButton-h5ZKzylb selected-nqU_VJml" data-overflow-tooltip-text="Popular"><span>Popular</span></button>
              <button role="tab" aria-selected="false" aria-disabled="false" data-qa-id="Recent" id="Recent" class="squareTabButton-h5ZKzylb" data-overflow-tooltip-text="Recent"><span>Recent</span></button>
              <button role="tab" aria-selected="false" aria-disabled="false" data-qa-id="Video" id="Video" class="squareTabButton-h5ZKzylb" data-overflow-tooltip-text="Video"><span>Video</span></button>
            </div>
          </div>
          <article data-source-node-id="idea-chart" data-source-role="card" class="cards-ufCPQ4zt">
            <h3>US Savings Rate Collapsing</h3>
            <svg viewBox="0 0 320 180" fill="currentColor" class="idea-chart">
              ${chartPaths}
            </svg>
          </article>
        </div>
        <div data-source-role="footer" class="footer-Gvxnai7n">
          <a href="https://example.com/ideas/" class="button-sUC06VNJ">See more ideas</a>
        </div>
      </section>
      </div>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".content-Gvxnai7n { display: grid; gap: 12px; } .squareTabs-h5ZKzylb { display: flex; gap: 8px; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          { name: "IdeasPage", kind: "page", tag: "main", classNames: ["ideas-page"], textPreview: ["Ideas"] },
          {
            name: "Ideas",
            kind: "section",
            tag: "section",
            classNames: ["container-Gvxnai7n"],
            textPreview: ["Popular", "US Savings Rate Collapsing"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        lists: [{ title: "Idea tabs", items: ["Popular", "Recent", "Video"] }],
        repeatedGroups: [{ title: "Chart paths", sampleTexts: ["series-1", "series-2"] }],
        stats: { totalTables: 0, totalLists: 1, totalCards: 1, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  for (let index = 0; index < 18; index += 1) {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    await Bun.write(path.join(webpageEvidenceDir, "assets", "svg", `${assetId}.path.txt`), `M${index} ${index}h5v5z`)
  }
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

function renderFixtureFaqItems(startOrder: number, questions: string[]): string {
  return questions
    .map((question, index) => {
      const order = startOrder + index
      return `
      <div class="item-CB10Nqp7 medium-CB10Nqp7" style="order: ${order}">
        <button class="summary-CB10Nqp7" id="Accordion-summary::${order}" aria-expanded="false" aria-controls="Accordion-details::${order}">
          <div class="summaryLine-CB10Nqp7">
            <span class="background-CB10Nqp7"></span>
            <div class="summaryText-CB10Nqp7">${question}</div>
            <div role="presentation">
              <div class="wrapper-QvjxDSJu medium-QvjxDSJu">
                <div class="horizontal-QvjxDSJu"></div>
                <div class="vertical-QvjxDSJu"></div>
              </div>
            </div>
          </div>
        </button>
        <div class="detailsWrapper-CB10Nqp7" id="Accordion-details::${order}">
          <div class="details-CB10Nqp7">
            ${question} answer text for the generated FAQ list.
            <a href="https://example.com/${order}">Read more</a>
          </div>
        </div>
      </div>
    `
    })
    .join("")
}

async function writeGenericStructureFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence-generic-structure")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await writeCapturedViewport(webpageEvidenceDir)
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="operations-page">
      <section data-source-node-id="plan-table" class="surface alpha-table">
        <header class="surface-head"><h2>Plan comparison</h2></header>
        <div class="body-frame">
          <table class="matrix">
            <tbody>
              <tr><th></th><th><a href="https://example.com/starter"><span>Starter</span></a></th><th><a href="https://example.com/pro"><span>Pro</span></a></th><th><a href="https://example.com/team"><span>Team</span></a></th></tr>
              <tr><th><a href="https://example.com/storage"><span>Storage</span></a></th><td><span><div><span class="value-a">20</span><span class="unit-a">GB</span></div></span></td><td><span><div><span class="value-a">100</span><span class="unit-a">GB</span></div></span></td><td><span><div><span class="value-a">500</span><span class="unit-a">GB</span></div></span></td></tr>
              <tr><th><a href="https://example.com/seats"><span>Seats</span></a></th><td><span><div><span class="value-a">3</span></div></span></td><td><span><div><span class="value-a">12</span></div></span></td><td><span><div><span class="value-a">50</span></div></span></td></tr>
              <tr><th><a href="https://example.com/support"><span>Support</span></a></th><td><span><div><span class="value-a">Email</span></div></span></td><td><span><div><span class="value-a">Priority</span></div></span></td><td><span><div><span class="value-a">Dedicated</span></div></span></td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section data-source-node-id="deployment-list" class="surface beta-list">
        <header class="surface-head"><h2>Deployment queue</h2></header>
        <div class="content-shell"><div class="lane-shell"><div class="items-lane">
          ${["Package review", "Access rollout", "Design sync"]
            .map(
              (title, index) => `
            <a href="https://example.com/deploy/${index}" class="wrap-row">
              <div class="top-row"><div class="date-row"><div class="day-row">Batch ${index + 1}</div><div class="dot-row">•</div><div class="wrap-date" title="Jun ${index + 1}, 2026"><span class="badge-date"><span class="content-date"></span></span></div></div></div>
              <div class="titleBlock-row"><div class="column-row"><span class="title-row">${title}</span></div></div>
              <div class="stats-row"><div class="wrap-stat"><div class="title-stat">Status</div><div class="valueWrap-stat"><div class="value-stat">${index === 0 ? "Ready" : "Queued"}</div></div></div><div class="wrap-stat"><div class="title-stat">Owner</div><div class="valueWrap-stat"><div class="value-stat">Team ${index + 1}</div></div></div></div>
            </a>
          `,
            )
            .join("")}
        </div></div></div>
      </section>
      <section data-source-node-id="resource-links" class="surface gamma-links">
        <header class="surface-head"><h2>Resource hub</h2></header>
        <div class="links-grid">
          ${["Docs", "Templates", "Changelog", "Status", "Examples", "Support"]
            .map(
              (label) => `
            <a href="https://example.com/${label.toLowerCase()}" class="resource-link"><span>${label}</span></a>
          `,
            )
            .join("")}
        </div>
      </section>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".surface { padding: 16px; } .links-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; } .items-lane { display: grid; gap: 8px; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          {
            name: "PlanComparison",
            kind: "section",
            tag: "section",
            classNames: ["surface"],
            textPreview: ["Plan comparison", "Starter", "Team"],
          },
          {
            name: "DeploymentQueue",
            kind: "section",
            tag: "section",
            classNames: ["surface"],
            textPreview: ["Deployment queue", "Package review"],
          },
          {
            name: "ResourceHub",
            kind: "navigation",
            tag: "section",
            classNames: ["surface"],
            textPreview: ["Resource hub", "Docs", "Support"],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        tables: [
          {
            title: "Plan comparison",
            headers: ["Starter", "Pro", "Team"],
            rows: [
              ["Storage", "20 GB", "100 GB", "500 GB"],
              ["Seats", "3", "12", "50"],
              ["Support", "Email", "Priority", "Dedicated"],
            ],
          },
        ],
        lists: [
          { title: "Deployment queue", items: ["Package review", "Access rollout", "Design sync"] },
          { title: "Resource hub", items: ["Docs", "Templates", "Changelog", "Status", "Examples", "Support"] },
        ],
        repeatedGroups: [
          { title: "Deployment rows", sampleTexts: ["Package review Ready", "Access rollout Queued"] },
          { title: "Resource links", sampleTexts: ["Docs", "Templates"] },
        ],
        sourceComponentPatterns: [
          {
            nodeId: "plan-table",
            kind: "data_grid_surface",
            recommendedReplacementKind: "data_table_or_heatmap_component",
            signals: { tableRowCount: 4, maxRepeatedSiblingCount: 3 },
          },
          {
            nodeId: "deployment-list",
            kind: "card_collection_surface",
            recommendedReplacementKind: "event_or_news_list_component",
            signals: { maxRepeatedSiblingCount: 3, linkCount: 3 },
          },
          {
            nodeId: "resource-links",
            kind: "navigation_surface",
            recommendedReplacementKind: "navigation_or_footer_component",
            signals: { linkCount: 6, linkDensity: 0.5 },
          },
        ],
        stats: {
          totalTables: 1,
          totalLists: 2,
          totalCards: 0,
          totalRepeatedGroups: 2,
          totalSourceComponentPatterns: 3,
        },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify({ version: 1, assets: [] }, null, 2),
  )
  return webpageEvidenceDir
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}

async function writeCapturedViewport(webpageEvidenceDir: string, width = 1366, height = 768): Promise<void> {
  await Bun.write(
    path.join(webpageEvidenceDir, "extracted-page.json"),
    JSON.stringify(
      {
        url: "https://example.com/markets",
        viewport: { width, height },
      },
      null,
      2,
    ),
  )
}
