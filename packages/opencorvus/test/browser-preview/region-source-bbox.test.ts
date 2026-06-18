import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import {
  compareBrowserPreviewRegions,
  type BrowserPreviewRegionBinding,
} from "../../src/browser-preview/region-comparison"
import {
  findReadableBrowserPreviewEvidenceByID,
  persistBrowserPreviewTarget,
  resolveRuntimeRelativePath,
} from "../../src/browser-preview/persist"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const REGION_SOURCE_BBOX_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview region source bbox bounds", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test(
    "fails a region when the authored source bbox exceeds the source image bounds",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeSmallReferenceScreenshot(paths.sourcePackageAbsolute)
      const server = await startSourceBboxServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistBrowserPreviewTarget({ taskID, url: server.url }),
        })
        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [sourceBboxBinding("bad-source-bbox"), sourceBboxBinding("valid-source-bbox")],
        })

        expect(result.status).toBe("failed")
        expect(result.regions).toHaveLength(2)
        const badRegion = result.regions.find((region) => region.region_id === "bad-source-bbox")
        const validRegion = result.regions.find((region) => region.region_id === "valid-source-bbox")
        expect(badRegion?.status).toBe("failed")
        expect(badRegion?.reason).toContain("source bbox exceeds source image bounds")
        expect(badRegion?.source_bbox).toEqual({ x: 80, y: 80, width: 30, height: 30 })
        expect(badRegion?.implementation_bbox?.width).toBeGreaterThan(100)
        expect(badRegion?.artifacts).toBeUndefined()
        expect(validRegion?.status).toBe("completed")
        expect(validRegion?.artifacts?.source_crop).toBeTruthy()
        const validSourceCrop = await sharp(
          resolveRuntimeRelativePath(tmp.path, validRegion!.artifacts!.source_crop),
        ).metadata()
        expect(validSourceCrop.width).toBe(40)
        expect(validSourceCrop.height).toBe(30)

        const evidenceID = result.evidenceIDs["desktop:bad-source-bbox"]
        expect(evidenceID).toBeTruthy()
        const evidence = await Instance.provide({
          directory: tmp.path,
          fn: () => findReadableBrowserPreviewEvidenceByID({ projectRoot: tmp.path, taskID, evidenceID }),
        })
        expect(evidence?.operationKind).toBe("reference-comparison")
        expect(evidence?.status).toBe("failed")
        expect(evidence?.artifactPaths).toBeUndefined()
        expect(evidence?.summary).toContain("source bbox exceeds source image bounds")

        const validEvidence = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: result.evidenceIDs["desktop:valid-source-bbox"],
            }),
        })
        expect(validEvidence?.status).toBe("passed")
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_SOURCE_BBOX_TEST_TIMEOUT_MILLISECONDS },
  )
})

function sourceBboxBinding(regionID: "bad-source-bbox" | "valid-source-bbox"): BrowserPreviewRegionBinding {
  const bad = regionID === "bad-source-bbox"
  return {
    region_id: regionID,
    viewport_id: "desktop",
    state_id: "default",
    region_scope: "page-section",
    source: {
      reference_artifact_id: "reference.png",
      bbox: bad ? { x: 80, y: 80, width: 30, height: 30 } : { x: 10, y: 12, width: 40, height: 30 },
      semantic_role: bad ? "bad source bbox" : "valid source bbox",
      text_anchors: [bad ? "Bad Source Bbox" : "Valid Source Bbox"],
      source_refs: ["source screenshot"],
    },
    implementation: {
      route: "/",
      locator: { kind: "data-oc-region", value: regionID },
      component_files: [`src/${bad ? "BadSourceBbox" : "ValidSourceBbox"}.tsx`],
    },
    acceptance_refs: ["source bbox bounds"],
  }
}

async function seedTask(directory: string): Promise<string> {
  const taskID = `tsk_region_source_bbox_${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Region source bbox task",
            request: "Compare source bbox",
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

async function writeSmallReferenceScreenshot(sourcePackageAbsolute: string): Promise<void> {
  await fs.mkdir(sourcePackageAbsolute, { recursive: true })
  await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="40" height="30" xmlns="http://www.w3.org/2000/svg">
            <rect width="40" height="30" fill="#dcfce7"/>
          </svg>`,
        ),
        left: 10,
        top: 12,
      },
    ])
    .png()
    .toFile(path.join(sourcePackageAbsolute, "reference.png"))
}

async function startSourceBboxServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Source bbox bounds</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            [data-oc-region] {
              width: 180px;
              height: 120px;
              margin: 40px;
              background: #fee2e2;
              color: #7f1d1d;
              box-sizing: border-box;
              padding: 24px;
              font-size: 22px;
            }
            [data-oc-region="valid-source-bbox"] { background: #dcfce7; color: #14532d; }
          </style>
        </head>
        <body>
          <section data-oc-region="bad-source-bbox">Bad Source Bbox</section>
          <section data-oc-region="valid-source-bbox">Valid Source Bbox</section>
        </body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("source bbox test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}
