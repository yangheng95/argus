import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { WebCloneGenerateSourceProjectTool } from "../../src/tool/web-clone-generate-source-project"
import { WebCloneSourceAuditTool } from "../../src/tool/web-clone-source-audit"
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
  test("is registered as a normal build-consumable tool", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("web_clone_generate_source_project")
      },
    })
  })

  test("writes editable React source from source-skeleton and passes the source audit", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const generateTool = await WebCloneGenerateSourceProjectTool.init()
        const generated = await generateTool.execute({ mirrorDir, outputDir }, ctx)

        expect(generated.title).toBe("Web clone source project generated")
        expect(generated.metadata.outputDir).toBe(outputDir)
        expect(await Bun.file(path.join(outputDir, "src", "components", "SourceClonePage.tsx")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "components", "ContentTable.tsx")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceData.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceDomRegions.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceDomReplacementPlan.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceSvgAssetGroups.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "data", "sourceFaqGroups.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "components", "SourceAssetPathGroup.tsx")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "components", "SourceFaqList.tsx")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "styles", "source-critical.css")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "src", "vite-env.d.ts")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "reference.png")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "tsconfig.json")).exists()).toBe(true)

        const packageJson = JSON.parse(await Bun.file(path.join(outputDir, "package.json")).text())
        expect(packageJson.packageManager).toBe("bun@1.3.14")
        expect(packageJson.scripts.dev).toBe("bunx vite --host 127.0.0.1")
        expect(packageJson.scripts.build).toBe("bunx vite build")
        expect(packageJson.scripts.preview).toBe("bunx vite preview --host 127.0.0.1 --strictPort")
        expect(packageJson.devDependencies["@types/react"]).toBeDefined()
        expect(packageJson.devDependencies["@types/react-dom"]).toBeDefined()
        expect(await Bun.file(path.join(outputDir, "src", "vite-env.d.ts")).text()).toContain("vite/client")
        const sourceClonePage = await Bun.file(path.join(outputDir, "src", "components", "SourceClonePage.tsx")).text()
        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const sourceDomRegions = await Bun.file(path.join(outputDir, "src", "data", "sourceDomRegions.ts")).text()
        const sourceDomReplacementPlan = await Bun.file(path.join(outputDir, "src", "data", "sourceDomReplacementPlan.ts")).text()
        const sourceSvgAssetGroups = await Bun.file(path.join(outputDir, "src", "data", "sourceSvgAssetGroups.ts")).text()
        const sourceFaqGroups = await Bun.file(path.join(outputDir, "src", "data", "sourceFaqGroups.ts")).text()
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
        expect(sourceSvgAssetGroups).toContain("sourceSvgAssetGroups")
        expect(sourceFaqGroups).toContain("sourceFaqGroups")
        expect(await Bun.file(path.join(outputDir, "public", "assets", "images", "asset_000002.webp")).exists()).toBe(true)
        const projectSource = await readGeneratedSource(outputDir)
        const sourceCriticalCss = await Bun.file(path.join(outputDir, "src", "styles", "source-critical.css")).text()
        expect(projectSource).toContain("GDP Growth Rate")
        expect(projectSource).toContain("EconomicCalendarTable")
        expect(projectSource).not.toContain("dangerouslySetInnerHTML")
        expect(projectSource).not.toContain("innerHTML")
        expect(projectSource).not.toContain("data:image")
        expect(projectSource).not.toContain(";base64,")
        expect(projectSource).not.toContain("reference.png")
        expect(sourceCriticalCss).not.toContain("data:image")
        expect(sourceCriticalCss).not.toContain(";base64,")

        const auditTool = await WebCloneSourceAuditTool.init()
        const audit = await auditTool.execute({ projectDir: outputDir, sourcePackageDir: mirrorDir }, ctx)
        expect(audit.title).toBe("Source-skeleton consumption audit passed")
        expect(audit.metadata.audit.passed).toBe(true)
        expect(audit.metadata.audit.risk.generatedBaselineDetected).toBe(true)
        expect(audit.metadata.audit.projectStats.sourceDomReplacementPlanExists).toBe(true)
        expect(audit.metadata.audit.projectStats.sourceSvgAssetGroupExists).toBe(true)
        expect(audit.metadata.audit.projectStats.sourceFaqGroupExists).toBe(true)
      },
    })
  })

  test("does not overwrite an existing output directory unless requested", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")
    await Bun.write(path.join(outputDir, "keep.txt"), "existing")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneGenerateSourceProjectTool.init()
        await expect(tool.execute({ mirrorDir, outputDir }, ctx)).rejects.toThrow("Output directory is not empty")

        const result = await tool.execute({ mirrorDir, outputDir, overwrite: true }, ctx)
        expect(result.title).toBe("Web clone source project generated")
        expect(await Bun.file(path.join(outputDir, "keep.txt")).exists()).toBe(false)
      },
    })
  })

  test("splits large generated DOM baselines into source-region components", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeRegionizedFixtureMirror(tmp.path)
    const outputDir = path.join(tmp.path, "generated-react")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneGenerateSourceProjectTool.init()
        await tool.execute({ mirrorDir, outputDir }, ctx)

        const sourceDomPage = await Bun.file(path.join(outputDir, "src", "components", "SourceDomPage.tsx")).text()
        const sourceDomRegions = await Bun.file(path.join(outputDir, "src", "data", "sourceDomRegions.ts")).text()
        const sourceDomReplacementPlan = await Bun.file(path.join(outputDir, "src", "data", "sourceDomReplacementPlan.ts")).text()
        const sourceSvgAssetGroups = await Bun.file(path.join(outputDir, "src", "data", "sourceSvgAssetGroups.ts")).text()
        const sourceFaqGroups = await Bun.file(path.join(outputDir, "src", "data", "sourceFaqGroups.ts")).text()
        const sourceProjectManifest = JSON.parse(await Bun.file(path.join(outputDir, "src", "data", "sourceProjectManifest.json")).text())
        const regionDir = path.join(outputDir, "src", "components", "source-dom")
        const regionFiles = (await fs.readdir(regionDir)).filter((file) => file.endsWith(".tsx"))
        const largestRegionBytes = Math.max(...await Promise.all(regionFiles.map(async (file) =>
          (await fs.stat(path.join(regionDir, file))).size
        )))

        expect(sourceDomPage).toContain('from "./source-dom/MainContentRegion"')
        expect(sourceDomPage.length).toBeLessThan(8_000)
        expect(regionFiles).toContain("OverviewRegion.tsx")
        expect(regionFiles).toContain("MarketsRegion.tsx")
        expect(regionFiles).toContain("MapRegion.tsx")
        expect(regionFiles).toContain("FrequentlyAskedQuestionsRegion.tsx")
        expect(regionFiles.length).toBeGreaterThanOrEqual(6)
        expect(largestRegionBytes).toBeLessThan(80_000)
        expect(await Bun.file(path.join(regionDir, "MapRegion.tsx")).text()).toContain("SourceAssetPathGroup")
        expect(await Bun.file(path.join(regionDir, "FrequentlyAskedQuestionsRegion.tsx")).text()).toContain("SourceFaqList")
        expect(sourceSvgAssetGroups).toContain("sourceSvgAssetGroup")
        expect(sourceSvgAssetGroups).toContain("asset_000001.path.txt")
        expect(sourceFaqGroups).toContain("What is GDP?")
        expect(sourceFaqGroups).toContain("How is GDP calculated?")
        expect(sourceDomRegions).toContain("replacementPriority")
        expect(sourceDomReplacementPlan).toContain("firstReplacementStep")
        expect(sourceDomReplacementPlan).toContain("parityGuard")
        expect(sourceProjectManifest.sourceDomRegions.count).toBe(regionFiles.length)
        expect(sourceProjectManifest.sourceDomRegions.metricsModule).toBe("src/data/sourceDomRegions.ts")
        expect(sourceProjectManifest.sourceDomRegions.replacementPlanModule).toBe("src/data/sourceDomReplacementPlan.ts")
        expect(sourceProjectManifest.sourceDomRegions.replacementPlanCount).toBeGreaterThan(0)
        expect(sourceProjectManifest.sourceDomRegions.svgAssetGroupModule).toBe("src/data/sourceSvgAssetGroups.ts")
        expect(sourceProjectManifest.sourceDomRegions.svgAssetGroupCount).toBeGreaterThan(0)
        expect(sourceProjectManifest.sourceDomRegions.faqGroupModule).toBe("src/data/sourceFaqGroups.ts")
        expect(sourceProjectManifest.sourceDomRegions.faqGroupCount).toBeGreaterThan(0)
      },
    })
  })
})

async function readGeneratedSource(outputDir: string): Promise<string> {
  const files = [
    path.join(outputDir, "src", "App.tsx"),
    path.join(outputDir, "src", "main.tsx"),
    path.join(outputDir, "src", "components", "SourceClonePage.tsx"),
    path.join(outputDir, "src", "components", "SourceDomPage.tsx"),
    path.join(outputDir, "src", "components", "ContentTable.tsx"),
    path.join(outputDir, "src", "data", "sourceData.ts"),
    path.join(outputDir, "src", "styles.css"),
  ]
  return (await Promise.all(files.map((file) => Bun.file(file).text()))).join("\n")
}

async function writeFixtureMirror(root: string): Promise<string> {
  const mirrorDir = path.join(root, "mirror")
  await Bun.write(path.join(mirrorDir, "reference.png"), minimalPngBytes())
  await Bun.write(path.join(mirrorDir, "source-skeleton", "index.html"), `
    <main class="economic-calendar">
      <nav><a href="/markets">Markets</a></nav>
      <h1>Economic calendar</h1>
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
  `)
  await Bun.write(path.join(mirrorDir, "source-skeleton", "critical.css"), ".economic-calendar { display: grid; background-image: url(data:image/png;base64,AAAA); }")
  await Bun.write(path.join(mirrorDir, "source-skeleton", "full-source.css"), ".economic-calendar table { width: 100%; }")
  await Bun.write(path.join(mirrorDir, "page.ir.json"), JSON.stringify({
    root: {
      id: "root",
      tag: "body",
      attrs: [],
      children: [
        {
          id: "style-1",
          tag: "section",
          attrs: [{ name: "style", value: "--ui-card-bg: blue; color: green; display: block" }],
          children: [],
        },
      ],
    },
  }, null, 2))
  await Bun.write(path.join(mirrorDir, "assets", "images", "asset_000002.webp.txt"), "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")
  await Bun.write(path.join(mirrorDir, "assets", "manifest.json"), JSON.stringify({
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
  }, null, 2))
  await Bun.write(path.join(mirrorDir, "source-ir", "component-tree.json"), JSON.stringify({
    components: [
      { name: "EconomicCalendarShell", kind: "navigation", tag: "main", classNames: ["economic-calendar"], textPreview: ["Markets", "Economic calendar"] },
      { name: "EconomicCalendarTable", kind: "table", tag: "table", classNames: ["calendar-table"], textPreview: ["08:30", "GDP Growth Rate"] },
    ],
  }, null, 2))
  await Bun.write(path.join(mirrorDir, "source-ir", "content-model.json"), JSON.stringify({
    tables: [{
      title: "Economic data",
      headers: ["Time", "Country", "Event", "Actual"],
      rows: [
        ["08:30", "US", "GDP Growth Rate", "2.1%"],
        ["09:45", "US", "Manufacturing PMI", "51.3"],
      ],
    }],
    repeatedGroups: [{ title: "Calendar rows", sampleTexts: ["08:30 US GDP Growth Rate 2.1%", "09:45 US Manufacturing PMI 51.3"] }],
    stats: { totalTables: 1, totalLists: 0, totalCards: 0, totalRepeatedGroups: 1 },
  }, null, 2))
  return mirrorDir
}

async function writeRegionizedFixtureMirror(root: string): Promise<string> {
  const mirrorDir = path.join(root, "mirror-regionized")
  await Bun.write(path.join(mirrorDir, "reference.png"), minimalPngBytes())
  const mapPaths = Array.from({ length: 36 }, (_, index) => {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    return `<path data-source-node-id="map-${index + 1}" data-asset-d="../assets/svg/${assetId}.path.txt" id="land-${index + 1}" class="positive-s"></path>`
  }).join("")
  const sections = ["Overview", "Markets", "Ideas", "Indicators", "News", "Calendar"]
    .map((title, sectionIndex) => `
      <section class="dashboard-section section-${sectionIndex}">
        <h2>${title}</h2>
        <div class="cards">
          ${Array.from({ length: 18 }, (_, itemIndex) => `
            <article class="card">
              <h3>${title} item ${itemIndex + 1}</h3>
              <p>${title} row ${itemIndex + 1} GDP Growth Rate Manufacturing PMI Economic calendar</p>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("")
  await Bun.write(path.join(mirrorDir, "source-skeleton", "index.html"), `
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
  `)
  await Bun.write(path.join(mirrorDir, "source-skeleton", "critical.css"), ".dashboard { display: grid; gap: 24px; } .cards { display: grid; grid-template-columns: repeat(3, 1fr); }")
  await Bun.write(path.join(mirrorDir, "source-skeleton", "full-source.css"), ".card { border: 1px solid #ddd; padding: 12px; }")
  await Bun.write(path.join(mirrorDir, "source-ir", "component-tree.json"), JSON.stringify({
    components: [
      { name: "DashboardShell", kind: "page", tag: "main", classNames: ["dashboard"], textPreview: ["Overview", "Markets"] },
      ...["Overview", "Markets", "Ideas", "Indicators", "News", "Calendar"].map((name) => ({
        name: `${name}Region`,
        kind: "section",
        tag: "section",
        classNames: ["dashboard-section"],
        textPreview: [name, `${name} item 1`],
      })),
    ],
  }, null, 2))
  await Bun.write(path.join(mirrorDir, "source-ir", "content-model.json"), JSON.stringify({
    lists: ["Overview", "Markets", "Ideas", "Indicators", "News", "Calendar"].map((title) => ({
      title,
      items: Array.from({ length: 18 }, (_, index) => `${title} item ${index + 1}`),
    })),
    repeatedGroups: [{ title: "Dashboard cards", sampleTexts: ["Overview item 1", "Markets item 1"] }],
    stats: { totalTables: 0, totalLists: 6, totalCards: 108, totalRepeatedGroups: 1 },
  }, null, 2))
  for (let index = 0; index < 36; index += 1) {
    const assetId = `asset_${String(index + 1).padStart(6, "0")}`
    await Bun.write(path.join(mirrorDir, "assets", "svg", `${assetId}.path.txt`), `M${index} ${index}h1v1z`)
  }
  await Bun.write(path.join(mirrorDir, "assets", "manifest.json"), JSON.stringify({ version: 1, assets: [] }, null, 2))
  return mirrorDir
}

function renderFixtureFaqItems(startOrder: number, questions: string[]): string {
  return questions.map((question, index) => {
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
  }).join("")
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}
