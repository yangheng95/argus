import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { eq } from "drizzle-orm"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import {
  bindLocalModuleToSourceRegion,
  materializeLocalModuleBindingArtifacts,
  selectSourceRegionCandidate,
  type LocalModuleCapture,
  type SourceRegionCandidate,
} from "../../src/browser-preview/local-module-source-binding"
import { persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview local module source binding", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("selects the source module matching local anchors over page-wide candidates", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "main-page",
        source: "visual-surface-candidate",
        bbox: { x: 0, y: 0, width: 1440, height: 5200 },
        text: "Economy Overview Countries Ideas Economic Calendar FAQ",
        sourceRefs: ["visual-surface-candidates.json"],
      },
      {
        id: "EconomicCalendarRegion",
        source: "source-dom-region",
        bbox: { x: 40, y: 4580, width: 1360, height: 320 },
        text: "Economic Calendar RBA Interest Rate Decision RBA Press Conference Auto Production YoY Auto Sales YoY",
        sourceRefs: ["sourceDomRegions.ts"],
      },
    ]
    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "economic-calendar",
      componentFiles: ["src/components/EconomicCalendar.tsx"],
      explicitTextAnchors: ["RBA Interest Rate Decision"],
      localCapture: {
        bbox: { x: 40, y: 200, width: 1200, height: 280 },
        textAnchors: ["Economic Calendar", "RBA Press Conference", "Auto Sales YoY"],
        fullText: "Economic Calendar RBA Press Conference Auto Sales YoY",
      },
    })

    expect(selected.id).toBe("EconomicCalendarRegion")
    expect(selected.matchedAnchors).toContain("economic calendar")
  })

  test("writes stable source/local binding puzzle artifacts", async () => {
    await using tmp = await tmpdir()
    const sourceImagePath = path.join(tmp.path, "source.png")
    const localImagePath = path.join(tmp.path, "local.png")
    await sharp({
      create: { width: 800, height: 600, channels: 4, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="420" height="180" xmlns="http://www.w3.org/2000/svg">
              <rect width="420" height="180" fill="#f2f7ff"/>
              <text x="20" y="54" font-family="Arial" font-size="30" fill="#111827">Economic Calendar</text>
              <text x="20" y="104" font-family="Arial" font-size="20" fill="#374151">RBA Interest Rate Decision</text>
            </svg>`,
          ),
          left: 120,
          top: 220,
        },
      ])
      .png()
      .toFile(sourceImagePath)
    await sharp({
      create: { width: 700, height: 500, channels: 4, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="380" height="160" xmlns="http://www.w3.org/2000/svg">
              <rect width="380" height="160" fill="#f2f7ff"/>
              <text x="18" y="52" font-family="Arial" font-size="28" fill="#111827">Economic Calendar</text>
              <text x="18" y="98" font-family="Arial" font-size="18" fill="#374151">RBA Interest Rate Decision</text>
            </svg>`,
          ),
          left: 80,
          top: 150,
        },
      ])
      .png()
      .toFile(localImagePath)

    const localCapture: LocalModuleCapture = {
      screenshotPath: localImagePath,
      bbox: { x: 80, y: 150, width: 380, height: 160 },
      textAnchors: ["Economic Calendar", "RBA Interest Rate Decision"],
      fullText: "Economic Calendar RBA Interest Rate Decision",
    }
    const artifacts = await materializeLocalModuleBindingArtifacts({
      outDir: path.join(tmp.path, "out"),
      regionID: "economic-calendar",
      sourceImagePath,
      sourceCandidate: {
        id: "EconomicCalendarRegion",
        source: "source-dom-region",
        bbox: { x: 120, y: 220, width: 420, height: 180 },
        text: "Economic Calendar RBA Interest Rate Decision",
        sourceRefs: ["sourceDomRegions.ts"],
      },
      localCapture,
    })

    for (const file of Object.values(artifacts)) {
      const metadata = await sharp(file).metadata()
      expect(metadata.format).toBe("png")
      expect(metadata.width).toBeGreaterThan(0)
      expect(metadata.height).toBeGreaterThan(0)
    }
    expect(path.basename(artifacts.binding_puzzle)).toBe("binding-puzzle.png")
  })

  test(
    "rejects hidden and zero-size local module implementation locators before writing passed binding evidence",
    async () => {
      for (const mode of ["hidden", "zero-size"] as const) {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        await writeReferenceScreenshot(paths.sourcePackageAbsolute)
        const server = await startLocalModuleServer(mode)
        try {
          const target = await Instance.provide({
            directory: tmp.path,
            fn: () => persistBrowserPreviewTarget({ taskID, url: server.url }),
          })

          await expect(
            bindLocalModuleToSourceRegion({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              viewportID: "desktop",
              regionID: `local-${mode}`,
              route: "/",
              implementationLocator: { kind: "data-oc-region", value: "local-module" },
              componentFiles: ["src/LocalModule.tsx"],
              sourceReferenceArtifactID: "reference.png",
              textAnchors: ["Local Module"],
              sourcePadding: 0,
              localPadding: 0,
            }),
          ).rejects.toThrow("Implementation locator did not match any visible element.")

          const evidenceRows = await Instance.provide({
            directory: tmp.path,
            fn: () =>
              Database.use((db) =>
                db
                  .select()
                  .from(EngineArtifactTable)
                  .where(eq(EngineArtifactTable.task_id, taskID))
                  .all(),
              ),
          })
          expect(evidenceRows.filter((row) => row.kind === "browser_preview_evidence")).toHaveLength(0)
        } finally {
          await server.close()
        }
      }
    },
    { timeout: LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS },
  )
})

async function seedTask(directory: string): Promise<string> {
  const taskID = `tsk_local_module_visible_${Date.now()}_${Math.random().toString(16).slice(2)}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Local module visible locator task",
            request: "Bind local module",
            source: "api",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
    },
  })
  return taskID
}

async function writeReferenceScreenshot(sourcePackageAbsolute: string): Promise<void> {
  await fs.mkdir(sourcePackageAbsolute, { recursive: true })
  await sharp({
    create: {
      width: 240,
      height: 180,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg">
            <rect width="120" height="80" fill="#e0f2fe"/>
            <text x="12" y="44" font-family="Arial" font-size="18" fill="#075985">Local Module</text>
          </svg>`,
        ),
        left: 20,
        top: 20,
      },
    ])
    .png()
    .toFile(path.join(sourcePackageAbsolute, "reference.png"))
}

async function startLocalModuleServer(mode: "hidden" | "zero-size"): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const regionRule =
      mode === "hidden"
        ? "display: none; width: 180px; height: 120px;"
        : "width: 0; height: 0; overflow: hidden; padding: 0; margin: 0;"
    const body = `<!doctype html>
      <html>
        <head>
          <title>Local module visible locator</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            [data-oc-region="local-module"] {
              ${regionRule}
              background: #e0f2fe;
              color: #075985;
            }
          </style>
        </head>
        <body><section data-oc-region="local-module">Local Module</section></body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("local module test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}
