import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import {
  compareBrowserPreviewRegions,
  type BrowserPreviewRegionBinding,
} from "../../src/browser-preview/region-comparison"
import { findReadableBrowserPreviewEvidenceByID } from "../../src/browser-preview/persist"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"

const REGION_VISIBLE_LOCATOR_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview region visible locator capture", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test(
    "fails hidden and zero-size implementation locators instead of persisting one-pixel regions",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeReferenceScreenshot(paths.sourcePackageAbsolute)
      const server = await startVisibleLocatorServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
        })
        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [locatorBinding("hidden-region"), locatorBinding("zero-size-region")],
        })

        expect(result.status).toBe("failed")
        for (const regionID of ["hidden-region", "zero-size-region"] as const) {
          const region = result.regions.find((item) => item.region_id === regionID)
          expect(region?.status).toBe("failed")
          expect(region?.reason).toBe("Implementation locator did not match any visible element.")
          expect(region?.implementation_bbox).toBeUndefined()
          expect(region?.artifacts).toBeUndefined()

          const evidence = await Instance.provide({
            directory: tmp.path,
            fn: () =>
              findReadableBrowserPreviewEvidenceByID({
                projectRoot: tmp.path,
                taskID,
                evidenceID: result.evidenceIDs[`desktop:default:${regionID}`],
              }),
          })
          expect(evidence?.operationKind).toBe("reference-comparison")
          expect(evidence?.status).toBe("failed")
          expect(evidence?.artifactPaths).toBeUndefined()
        }
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_VISIBLE_LOCATOR_TEST_TIMEOUT_MILLISECONDS },
  )
})

function locatorBinding(regionID: "hidden-region" | "zero-size-region"): BrowserPreviewRegionBinding {
  return {
    region_id: regionID,
    viewport_id: "desktop",
    state_id: "default",
    region_scope: "page-section",
    source: {
      reference_artifact_id: "reference.png",
      bbox: { x: 20, y: 20, width: 120, height: 80 },
      semantic_role: regionID,
      text_anchors: [regionID],
      source_refs: ["source screenshot"],
    },
    implementation: {
      route: "/",
      locator: { kind: "data-oc-region", value: regionID },
      component_files: [`src/${regionID}.tsx`],
    },
    acceptance_refs: ["visible locator"],
  }
}

async function seedTask(directory: string): Promise<string> {
  const taskID = `tsk_region_visible_locator_${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Region visible locator task",
            request: "Compare hidden regions",
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
            <rect width="120" height="80" fill="#ede9fe"/>
          </svg>`,
        ),
        left: 20,
        top: 20,
      },
    ])
    .png()
    .toFile(path.join(sourcePackageAbsolute, "reference.png"))
}

async function startVisibleLocatorServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Visible locator regression</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            [data-oc-region="hidden-region"] {
              display: none;
              width: 160px;
              height: 100px;
            }
            [data-oc-region="zero-size-region"] {
              width: 0;
              height: 0;
              overflow: hidden;
              padding: 0;
              margin: 0;
            }
          </style>
        </head>
        <body>
          <section data-oc-region="hidden-region">Hidden Region</section>
          <section data-oc-region="zero-size-region">Zero Size Region</section>
        </body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("visible locator test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}
