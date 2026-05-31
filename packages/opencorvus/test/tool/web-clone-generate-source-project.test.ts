import { describe, expect, test } from "bun:test"
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
        expect(await Bun.file(path.join(outputDir, "src", "styles", "source-critical.css")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "tsconfig.json")).exists()).toBe(true)

        const packageJson = JSON.parse(await Bun.file(path.join(outputDir, "package.json")).text())
        expect(packageJson.packageManager).toBe("bun@1.3.14")
        expect(packageJson.scripts.dev).toBe("vite --host 127.0.0.1")
        expect(packageJson.scripts.build).toBe("vite build")
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
})

async function readGeneratedSource(outputDir: string): Promise<string> {
  const files = [
    path.join(outputDir, "src", "App.tsx"),
    path.join(outputDir, "src", "main.tsx"),
    path.join(outputDir, "src", "components", "SourceClonePage.tsx"),
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
