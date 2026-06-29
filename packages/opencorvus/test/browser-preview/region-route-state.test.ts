import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import {
  compareBrowserPreviewRegions,
  type BrowserPreviewRegionBinding,
} from "../../src/browser-preview/region-comparison"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"

const REGION_ROUTE_STATE_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview region route state", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test(
    "navigates back to the first route after visiting another route in the same viewport",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeReferenceScreenshot(paths.sourcePackageAbsolute)
      const server = await startRouteStateServer()
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
          bindings: [
            routeBinding({ regionID: "first-a", route: "/a" }),
            routeBinding({ regionID: "middle-b", route: "/b" }),
            routeBinding({ regionID: "return-a", route: "/a" }),
          ],
        })

        const firstA = result.regions.find((region) => region.region_id === "first-a")
        const middleB = result.regions.find((region) => region.region_id === "middle-b")
        const returnA = result.regions.find((region) => region.region_id === "return-a")

        expect(result.status).toBe("passed")
        expect(firstA?.status).toBe("completed")
        expect(middleB?.status).toBe("completed")
        expect(returnA?.status).toBe("completed")
        expect(firstA?.implementation_bbox?.y).toBeLessThan(100)
        expect(middleB?.implementation_bbox?.y).toBeGreaterThan(180)
        expect(returnA?.implementation_bbox?.y).toBe(firstA?.implementation_bbox?.y)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_ROUTE_STATE_TEST_TIMEOUT_MILLISECONDS },
  )
})

function routeBinding(input: { regionID: string; route: "/a" | "/b" }): BrowserPreviewRegionBinding {
  return {
    region_id: input.regionID,
    viewport_id: "desktop",
    state_id: "default",
    region_scope: "page-section",
    crop_intent: "full-region",
    source: {
      reference_artifact_id: "reference.png",
      bbox: { x: 20, y: 20, width: 280, height: 100 },
      semantic_role: "route state probe",
      text_anchors: ["Route Probe"],
      source_refs: ["source screenshot"],
    },
    implementation: {
      route: input.route,
      locator: { kind: "data-oc-region", value: "route-probe" },
      component_files: ["src/RouteProbe.tsx"],
    },
    acceptance_refs: ["route state"],
  }
}

async function seedTask(directory: string): Promise<string> {
  const taskID = `tsk_region_route_state_${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Region route state task",
            request: "Compare region routes",
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
      width: 640,
      height: 360,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="280" height="100" xmlns="http://www.w3.org/2000/svg">
            <rect width="280" height="100" fill="#dbeafe"/>
            <text x="24" y="58" font-family="Arial" font-size="28" fill="#1e3a8a">Route Probe</text>
          </svg>`,
        ),
        left: 20,
        top: 20,
      },
    ])
    .png()
    .toFile(path.join(sourcePackageAbsolute, "reference.png"))
}

async function startRouteStateServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname
    if (pathname !== "/a" && pathname !== "/b") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    const top = pathname === "/a" ? 40 : 240
    const body = `<!doctype html>
      <html>
        <head>
          <title>Region route state</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { position: relative; width: 900px; height: 500px; }
            [data-oc-region="route-probe"] {
              position: absolute;
              left: 64px;
              top: ${top}px;
              width: 280px;
              height: 100px;
              background: #dbeafe;
              color: #1e3a8a;
              box-sizing: border-box;
              padding: 24px;
              font-size: 28px;
            }
          </style>
        </head>
        <body><main><section data-oc-region="route-probe">Route Probe ${pathname}</section></main></body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("route state test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}
