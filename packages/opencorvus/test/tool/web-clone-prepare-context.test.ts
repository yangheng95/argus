import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { WebClonePrepareContextTool } from "../../src/tool/web-clone-prepare-context"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test-web-clone-prepare-context",
  messageID: "message",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.web_clone_prepare_context", () => {
  test(
    "is registered as a host repair tool",
    async () => {
      await using tmp = await tmpdir()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("web_clone_prepare_context")
        },
      })
    },
    { timeout: 20_000 },
  )

  test("writes compact context and implementation contract from webpage evidence", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebClonePrepareContextTool.init()
        const result = await tool.execute({ webpageEvidenceDir }, ctx)
        const sourcePackageDir = path.join(tmp.path, "web-clone-source")

        expect(result.title).toBe("Web clone context prepared")
        expect(result.metadata.sourcePackageDir).toBe(sourcePackageDir)
        expect(result.metadata.sourceReadmePath).toBe(path.join(sourcePackageDir, "README.md"))
        expect(result.metadata.materializedFiles).toContain(path.join(sourcePackageDir, "implementation-blueprint.md"))
        expect(result.metadata.materializedFiles).toContain(path.join(sourcePackageDir, "singlefile.html"))
        expect(result.metadata.contextPath).toBe(path.join(sourcePackageDir, "web-clone-context.md"))
        expect(result.metadata.contractPath).toBe(path.join(sourcePackageDir, "web-clone-implementation-contract.json"))
        expect(result.metadata.materializedFiles).toContain(
          path.join(sourcePackageDir, "source-skeleton", "index.html"),
        )
        expect(result.metadata.materializedFiles).toContain(
          path.join(sourcePackageDir, "source-ir", "content-model.json"),
        )
        expect(result.metadata.materializedFiles).toContain(
          path.join(sourcePackageDir, "source-ir", "style-profile.json"),
        )
        expect(result.metadata.materializedFiles).toContain(path.join(sourcePackageDir, "assets", "manifest.json"))
        expect(result.metadata.stats.components).toBe(2)
        expect(result.metadata.stats.styleProfiles).toBe(1)
        expect(result.metadata.stats.tables).toBe(1)
        expect(result.metadata.stats.sourceSkeletonAuditPassed).toBe(true)

        const context = await Bun.file(result.metadata.contextPath).text()
        expect(context).not.toContain("web_clone_generate_source_project")
        expect(context).toContain("web_clone_source_audit")
        expect(context).toContain("EconomicCalendarTable")
        expect(context).toContain("GDP Growth Rate")
        expect(context).toContain("Region Style Profiles")
        expect(context).toContain("schema, seed/reset data, and read APIs")
        expect(context).not.toContain("data:image")
        expect(context).not.toContain(";base64,")
        const readme = await Bun.file(result.metadata.sourceReadmePath).text()
        expect(readme).toContain("visible source package")
        expect(readme).toContain("Build agents must start here")
        const blueprint = await Bun.file(path.join(sourcePackageDir, "implementation-blueprint.md")).text()
        expect(blueprint).toContain("Expected Component Slices")
        expect(blueprint).toContain("Verification Checks")

        const contract = JSON.parse(await Bun.file(result.metadata.contractPath).text())
        expect(contract.rules.visualEvaluation.role).toBe("diagnostic_measurement")
        expect(contract.rules.visualEvaluation.report).toContain("structural differences")
        expect(contract.rules.forbidden).toContain("reference screenshot replay")
        expect(contract.content.tables[0].headers).toContain("Event")
        const sourceManifest = JSON.parse(
          await Bun.file(path.join(sourcePackageDir, "web-clone-source-manifest.json")).text(),
        )
        expect(sourceManifest.provenance.captureViewport).toEqual({ width: 1366, height: 768 })
      },
    })
  })

  test("accepts a compiled source-skeleton handoff without raw extraction diagnostics", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    for (const file of [
      "capture.html",
      "singlefile.html",
      "extracted-page.json",
      "segments.json",
      "codegen-context.json",
    ]) {
      await fs.rm(path.join(webpageEvidenceDir, file), { force: true })
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebClonePrepareContextTool.init()
        const result = await tool.execute({ webpageEvidenceDir }, ctx)
        const sourcePackageDir = path.join(tmp.path, "web-clone-source")

        expect(result.title).toBe("Web clone context prepared")
        expect(result.metadata.sourcePackageDir).toBe(sourcePackageDir)
        expect(result.metadata.materializedFiles).toContain(
          path.join(sourcePackageDir, "source-skeleton", "index.html"),
        )
        expect(result.metadata.materializedFiles).toContain(
          path.join(sourcePackageDir, "source-ir", "component-tree.json"),
        )
        expect(result.metadata.materializedFiles).not.toContain(path.join(sourcePackageDir, "singlefile.html"))
        expect(result.metadata.stats.sourceSkeletonAuditPassed).toBe(true)
        expect(result.metadata.stats.sourceQualityAuditPassed).toBe(true)
      },
    })
  })

  test("rejects outputDir outside the worktree", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebClonePrepareContextTool.init()
        await expect(tool.execute({ webpageEvidenceDir, outputDir: "../outside" }, ctx)).rejects.toThrow(
          "outputDir must stay inside the current project directory",
        )
      },
    })
  })

  test("rejects webpageEvidenceDir outside the current project", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    const outsideWebpageEvidenceDir = await writeFixtureEvidence(outside.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebClonePrepareContextTool.init()
        await expect(tool.execute({ webpageEvidenceDir: outsideWebpageEvidenceDir }, ctx)).rejects.toThrow(
          "webpageEvidenceDir must stay inside the current project directory",
        )
      },
    })
  })

  test("rejects a webpage evidence package whose reference image has a fake PNG header", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    await Bun.write(path.join(webpageEvidenceDir, "reference.png"), fakePngWithoutIhdr())

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebClonePrepareContextTool.init()
        await expect(tool.execute({ webpageEvidenceDir }, ctx)).rejects.toThrow("IHDR")
      },
    })
  })
})

async function writeFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "webpage-evidence")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await Bun.write(path.join(webpageEvidenceDir, "capture.html"), "<!doctype html><main>Economic calendar</main>")
  await Bun.write(
    path.join(webpageEvidenceDir, "singlefile.html"),
    "<!doctype html><main>Economic calendar SingleFile</main>",
  )
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
  await Bun.write(path.join(webpageEvidenceDir, "page.ir.json"), JSON.stringify({ version: 1 }, null, 2))
  await Bun.write(path.join(webpageEvidenceDir, "segments.json"), JSON.stringify({ segments: [] }, null, 2))
  await Bun.write(path.join(webpageEvidenceDir, "codegen-context.json"), JSON.stringify({ version: 1 }, null, 2))
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "README.md"),
    "Use this source skeleton as the implementation handoff.",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="economic-calendar">
      <nav><a href="/markets">Markets</a></nav>
      <h1>Economic calendar</h1>
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
    ".economic-calendar { display: grid; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "full-source.css"),
    ".economic-calendar { display: grid; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "used-selectors.json"),
    JSON.stringify({ rules: [] }, null, 2),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "skeleton-manifest.json"),
    JSON.stringify({ version: 1 }, null, 2),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "source-skeleton-audit.json"),
    JSON.stringify({ passed: true }, null, 2),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "source-quality-audit.json"),
    JSON.stringify({ passed: true }, null, 2),
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
            textPreview: ["Markets", "Economic calendar"],
          },
          { name: "EconomicCalendarTable", kind: "table", tag: "table", textPreview: ["08:30", "GDP Growth Rate"] },
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
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "style-profile.json"),
    JSON.stringify(
      {
        purpose: "web-clone-style-profile",
        regions: [
          {
            id: "style_main",
            name: "EconomicCalendarTable",
            kind: "table",
            rootNodeId: "node_table",
            bounds: { x: 0, y: 80, width: 960, height: 360 },
            styleSummary: {
              typography: [{ value: "font-size: 14px; line-height: 20px", count: 2 }],
              colors: [{ value: "color: rgb(17, 24, 39)", count: 2 }],
              spacing: [{ value: "padding: 16px", count: 1 }],
            },
            implementationGuidance: ["Use compact grid/table spacing from source CSS."],
          },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "style-tokens.json"),
    JSON.stringify({ colors: [{ name: "text", value: "#111827" }] }, null, 2),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "interaction-hints.json"),
    JSON.stringify({ controls: [{ type: "link", label: "Markets", href: "/markets" }] }, null, 2),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "interaction-state-snapshots.json"),
    JSON.stringify(
      {
        version: 1,
        source: { url: "https://example.com/markets", viewport: { width: 1366, height: 768 } },
        snapshots: [{ id: "initial", scrollY: 0 }],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "layout-map.json"),
    JSON.stringify({ regions: [] }, null, 2),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "assets", "manifest.json"),
    JSON.stringify(
      {
        assets: [
          {
            id: "asset_000001",
            kind: "svg-path-data",
            path: "assets/svg/asset_000001.path.txt",
            semanticRole: "svg-geometry",
          },
        ],
      },
      null,
      2,
    ),
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

function fakePngWithoutIhdr(): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8)
  bytes.set([0x49, 0x44, 0x41, 0x54], 12)
  bytes.set([0x00, 0x00, 0x00, 0x01], 16)
  bytes.set([0x00, 0x00, 0x00, 0x01], 20)
  return bytes
}
