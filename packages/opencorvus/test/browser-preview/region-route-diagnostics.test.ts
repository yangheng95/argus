import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import {
  compareBrowserPreviewRegions,
  type BrowserPreviewRegionBinding,
} from "../../src/browser-preview/region-comparison"
import { persistBrowserPreviewTarget, resolveRuntimeRelativePath } from "../../src/browser-preview/persist"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const REGION_ROUTE_DIAGNOSTICS_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview region route diagnostics", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test(
    "reports route health failures separately from genuine locator misses",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeReferenceScreenshot(paths.sourcePackageAbsolute)
      const server = await startRouteDiagnosticsServer()
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
          bindings: [
            routeBinding({
              regionID: "route-not-found",
              route: "/world-economy/",
              locatorValue: "economic-trends-dashboard",
            }),
            routeBinding({
              regionID: "missing-locator",
              route: "/world-economy",
              locatorValue: "missing-dashboard",
            }),
          ],
        })

        expect(result.status).toBe("failed")
        const routeFailure = result.regions.find((region) => region.region_id === "route-not-found")
        const locatorFailure = result.regions.find((region) => region.region_id === "missing-locator")
        expect(routeFailure?.status).toBe("failed")
        expect(routeFailure?.reason).toContain("Implementation route did not render a valid app page")
        expect(routeFailure?.reason).toContain("route=/world-economy/")
        expect(routeFailure?.route_diagnostics?.status).toBe(404)
        expect(routeFailure?.route_diagnostics?.valid_app_page).toBe(false)
        expect(routeFailure?.implementation_screenshot_path).toEndWith(".png")
        expect(
          await fileExists(resolveRuntimeRelativePath(tmp.path, routeFailure!.implementation_screenshot_path!)),
        ).toBe(true)

        expect(locatorFailure?.status).toBe("failed")
        expect(locatorFailure?.reason).toBe("Implementation locator did not match any visible element.")
        expect(locatorFailure?.route_diagnostics?.status).toBe(200)
        expect(locatorFailure?.route_diagnostics?.valid_app_page).toBe(true)
        expect(locatorFailure?.implementation_screenshot_path).toEndWith(".png")
        expect(
          await fileExists(resolveRuntimeRelativePath(tmp.path, locatorFailure!.implementation_screenshot_path!)),
        ).toBe(true)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_ROUTE_DIAGNOSTICS_TEST_TIMEOUT_MILLISECONDS },
  )
})

function routeBinding(input: {
  regionID: string
  route: "/world-economy" | "/world-economy/"
  locatorValue: string
}): BrowserPreviewRegionBinding {
  return {
    region_id: input.regionID,
    viewport_id: "desktop",
    state_id: "default",
    region_scope: "page-section",
    source: {
      reference_artifact_id: "reference.png",
      bbox: { x: 40, y: 60, width: 320, height: 140 },
      semantic_role: "route diagnostics probe",
      text_anchors: ["Economic trends"],
      source_refs: ["source screenshot"],
    },
    implementation: {
      route: input.route,
      locator: { kind: "data-oc-region", value: input.locatorValue },
      component_files: ["src/EconomicTrendsDashboard.tsx"],
    },
    acceptance_refs: ["route diagnostics"],
  }
}

async function seedTask(directory: string): Promise<string> {
  const taskID = `tsk_region_route_diagnostics_${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Region route diagnostics task",
            request: "Compare route diagnostics",
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
      width: 1280,
      height: 720,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
            <rect width="320" height="140" fill="#dbeafe"/>
            <text x="24" y="58" font-family="Arial" font-size="28" fill="#1e3a8a">Economic trends</text>
            <text x="24" y="96" font-family="Arial" font-size="18" fill="#1d4ed8">Route diagnostics</text>
          </svg>`,
        ),
        left: 40,
        top: 60,
      },
    ])
    .png()
    .toFile(path.join(sourcePackageAbsolute, "reference.png"))
}

async function startRouteDiagnosticsServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname
    if (pathname === "/world-economy/") {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" })
      res.end("<!doctype html><title>not found</title><main>This page could not be found</main>")
      return
    }
    if (pathname !== "/world-economy") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    const body = `<!doctype html>
      <html>
        <head>
          <title>World Economy</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 60px 40px; min-height: 720px; }
            [data-oc-region="economic-trends-dashboard"] {
              width: 320px;
              height: 140px;
              background: #dbeafe;
              color: #1e3a8a;
              box-sizing: border-box;
              padding: 24px;
              font-size: 24px;
            }
          </style>
        </head>
        <body>
          <main>
            <section data-oc-region="economic-trends-dashboard">Economic trends route diagnostics</section>
            <p>Additional content keeps the route body representative of an application shell.</p>
          </main>
        </body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("route diagnostics test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function fileExists(input: string): Promise<boolean> {
  try {
    await fs.access(input)
    return true
  } catch {
    return false
  }
}
