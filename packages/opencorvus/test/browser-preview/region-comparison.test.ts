import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import {
  compareBrowserPreviewRegions,
  resolveSourceReferencePath,
  type BrowserPreviewRegionBinding,
} from "../../src/browser-preview/region-comparison"
import {
  findReadableBrowserPreviewEvidenceByID,
  persistBrowserPreviewTarget,
  resolveRuntimeRelativePath,
} from "../../src/browser-preview/persist"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview region comparison", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("resolves only canonical source reference screenshots", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_regioncomparisonresolve"
    const sourceRoot = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID).sourcePackageAbsolute

    expect(resolveSourceReferencePath({ projectRoot: tmp.path, taskID, referenceArtifactID: "reference.png" })).toBe(
      path.join(sourceRoot, "reference.png"),
    )
    expect(
      resolveSourceReferencePath({
        projectRoot: tmp.path,
        taskID,
        referenceArtifactID: "web-clone-source/reference-mobile.png",
      }),
    ).toBe(path.join(sourceRoot, "reference-mobile.png"))
    expect(() =>
      resolveSourceReferencePath({ projectRoot: tmp.path, taskID, referenceArtifactID: "../reference.png" }),
    ).toThrow("Source reference must resolve")
    expect(() =>
      resolveSourceReferencePath({ projectRoot: tmp.path, taskID, referenceArtifactID: "source.png" }),
    ).toThrow("Source reference must resolve")
  })

  test(
    "captures local region screenshots and persists side-by-side comparison evidence",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
                <rect width="320" height="140" fill="#e7f5ee"/>
                <text x="24" y="52" font-family="Arial" font-size="30" fill="#123326">Economy</text>
                <text x="24" y="92" font-family="Arial" font-size="18" fill="#315a45">Inflation and growth map</text>
              </svg>`,
            ),
            left: 40,
            top: 60,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistBrowserPreviewTarget({ taskID, url: server.url }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "economy",
          viewport_id: "desktop",
          state_id: "default",
          region_scope: "page-section",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 60, width: 320, height: 140 },
            semantic_role: "economy section",
            text_anchors: ["Economy", "Inflation"],
            source_refs: ["source screenshot"],
          },
          implementation: {
            route: "/economy",
            locator: { kind: "data-oc-region", value: "economy" },
            component_files: ["src/Economy.tsx"],
          },
          acceptance_refs: ["economy parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        expect(result.regions).toHaveLength(1)
        expect(result.manifestPath).toContain(".opencorvus/r/")
        expect(result.regions[0].artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(result.regions[0].implementation_bbox?.width).toBeGreaterThan(250)
        expect(await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.source_crop))).toBe(
          true,
        )
        expect(
          await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.implementation_crop)),
        ).toBe(true)
        expect(await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.side_by_side))).toBe(
          true,
        )
        expect(await fileExists(resolveRuntimeRelativePath(tmp.path, result.regions[0].artifacts!.diff!))).toBe(true)
        const evidenceID = result.evidenceIDs["desktop:economy"]
        expect(evidenceID).toBeTruthy()
        const evidence = await Instance.provide({
          directory: tmp.path,
          fn: () => findReadableBrowserPreviewEvidenceByID({ projectRoot: tmp.path, taskID, evidenceID }),
        })
        expect(evidence?.operationKind).toBe("reference-comparison")
        expect(evidence?.regionID).toBe("economy")
        expect(evidence?.artifactPaths?.side_by_side).toBe(result.regions[0].artifacts?.side_by_side)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "crops below-fold implementation regions from full-page comparison screenshots",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 800,
          height: 1200,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="320" height="140" xmlns="http://www.w3.org/2000/svg">
                <rect width="320" height="140" fill="#dbeafe"/>
                <text x="24" y="56" font-family="Arial" font-size="28" fill="#1e3a8a">Below Fold</text>
                <text x="24" y="96" font-family="Arial" font-size="18" fill="#1d4ed8">Full-page crop</text>
              </svg>`,
            ),
            left: 40,
            top: 900,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference.png"))
      const server = await startBelowFoldPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistBrowserPreviewTarget({ taskID, url: server.url }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "below-fold",
          viewport_id: "desktop",
          region_scope: "page-section",
          source: {
            reference_artifact_id: "reference.png",
            bbox: { x: 40, y: 900, width: 320, height: 140 },
            semantic_role: "below fold section",
            text_anchors: ["Below Fold", "Full-page crop"],
            source_refs: ["source screenshot"],
          },
          implementation: {
            route: "/below-fold",
            locator: { kind: "data-oc-region", value: "below-fold" },
            component_files: ["src/BelowFold.tsx"],
          },
          acceptance_refs: ["below fold parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["desktop"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        expect(result.regions).toHaveLength(1)
        const region = result.regions[0]
        expect(region.implementation_bbox?.y).toBeGreaterThan(800)
        expect(region.artifacts?.source_crop).toEndWith("source.png")
        expect(region.artifacts?.implementation_crop).toEndWith("implementation.png")
        expect(region.artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(region.artifacts?.diff).toEndWith("diff.png")
        const implementationCropPath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.implementation_crop)
        const sideBySidePath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.side_by_side)
        await expectPngDimensions(implementationCropPath, { width: 320, height: 140 })
        await expectPngDimensions(sideBySidePath, { width: 656, height: 216 })
        await expectPngHasColorDiversity(implementationCropPath)
        await expectPngHasColorDiversity(sideBySidePath)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "uses mobile source reference artifacts for mobile viewport region comparisons",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await sharp({
        create: {
          width: 390,
          height: 844,
          channels: 4,
          background: "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="300" height="128" xmlns="http://www.w3.org/2000/svg">
                <rect width="300" height="128" fill="#fee2e2"/>
                <text x="18" y="50" font-family="Arial" font-size="26" fill="#7f1d1d">Mobile Module</text>
                <text x="18" y="88" font-family="Arial" font-size="18" fill="#991b1b">Reference mobile</text>
              </svg>`,
            ),
            left: 24,
            top: 36,
          },
        ])
        .png()
        .toFile(path.join(paths.sourcePackageAbsolute, "reference-mobile.png"))
      const server = await startMobilePreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistBrowserPreviewTarget({ taskID, url: server.url }),
        })
        const binding: BrowserPreviewRegionBinding = {
          region_id: "mobile-module",
          viewport_id: "mobile",
          region_scope: "page-section",
          source: {
            reference_artifact_id: "reference-mobile.png",
            bbox: { x: 24, y: 36, width: 300, height: 128 },
            semantic_role: "mobile module section",
            text_anchors: ["Mobile Module", "Reference mobile"],
            source_refs: ["mobile source screenshot"],
          },
          implementation: {
            route: "/mobile",
            locator: { kind: "data-oc-region", value: "mobile-module" },
            component_files: ["src/MobileModule.tsx"],
          },
          acceptance_refs: ["mobile reference parity"],
        }

        const result = await compareBrowserPreviewRegions({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportIDs: ["mobile"],
          bindings: [binding],
          includeDiff: true,
        })

        expect(result.status).toBe("passed")
        expect(result.regions).toHaveLength(1)
        const region = result.regions[0]
        expect(result.evidenceIDs["mobile:mobile-module"]).toBeTruthy()
        expect(region.viewport_id).toBe("mobile")
        expect(region.source_bbox).toEqual({ x: 24, y: 36, width: 300, height: 128 })
        expect(region.implementation_bbox?.width).toBe(300)
        expect(region.artifacts?.source_crop).toEndWith("source.png")
        expect(region.artifacts?.implementation_crop).toEndWith("implementation.png")
        expect(region.artifacts?.side_by_side).toEndWith("side-by-side.png")
        expect(region.artifacts?.diff).toEndWith("diff.png")
        const sourceCropPath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.source_crop)
        const implementationCropPath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.implementation_crop)
        const sideBySidePath = resolveRuntimeRelativePath(tmp.path, region.artifacts!.side_by_side)
        await expectPngDimensions(sourceCropPath, { width: 300, height: 128 })
        await expectPngDimensions(implementationCropPath, { width: 300, height: 128 })
        await expectPngDimensions(sideBySidePath, { width: 616, height: 204 })
        await expectPngHasColorDiversity(sourceCropPath)
        await expectPngHasColorDiversity(implementationCropPath)
        await expectPngHasColorDiversity(sideBySidePath)
      } finally {
        await server.close()
      }
    },
    { timeout: REGION_COMPARISON_TEST_TIMEOUT_MILLISECONDS },
  )

  test("delegates runtime capture to browser evidence runner instead of owning a sidecar", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dir, "../../src/browser-preview/region-comparison.ts"),
      "utf8",
    )
    const inputType = source.match(/type BrowserPreviewRegionComparisonInput = \{[\s\S]*?\n\}/)?.[0] ?? ""

    expect(inputType).not.toContain("url:")
    expect(source).toContain('import { runBrowserPreviewRegionComparisonCapture } from "./evidence-runner"')
    expect(source).toContain("runBrowserPreviewRegionComparisonCapture({")
    expect(source).not.toContain("runBrowserNodeSidecar")
    expect(source).not.toContain("resolveBrowserNodeSidecarRuntime")
    expect(source).not.toContain("REGION_COMPARISON_SCRIPT")
    expect(source).not.toContain("runImplementationCapture")
  })
})

async function seedTask(directory: string) {
  const taskID = `tsk_regioncomparison${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Region comparison task",
            request: "Compare economy region",
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

async function startPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Economy preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 60px 40px; }
            [data-oc-region="economy"] {
              width: 320px;
              height: 140px;
              background: #e7f5ee;
              color: #123326;
              padding: 24px;
              box-sizing: border-box;
            }
            h1 { margin: 0 0 18px; font-size: 30px; line-height: 1; }
            p { margin: 0; font-size: 18px; color: #315a45; }
          </style>
        </head>
        <body><main><section data-oc-region="economy"><h1>Economy</h1><p>Inflation and growth map</p></section></main></body>
      </html>`
    if (req.url !== "/economy") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startBelowFoldPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Below fold preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 1180px 40px 120px; }
            [data-oc-region="below-fold"] {
              width: 320px;
              height: 140px;
              background: #dbeafe;
              color: #1e3a8a;
              box-sizing: border-box;
              padding: 24px;
            }
            h1 { margin: 0 0 18px; font-size: 28px; line-height: 1; }
            p { margin: 0; font-size: 18px; color: #1d4ed8; }
          </style>
        </head>
        <body><main><section data-oc-region="below-fold"><h1>Below Fold</h1><p>Full-page crop</p></section></main></body>
      </html>`
    if (req.url !== "/below-fold") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("below-fold preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startMobilePreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Mobile preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #fff7ed; }
            main { padding: 36px 24px; }
            [data-oc-region="mobile-module"] {
              width: 300px;
              height: 128px;
              background: #fee2e2;
              color: #7f1d1d;
              box-sizing: border-box;
              padding: 18px;
            }
            h1 { margin: 0 0 14px; font-size: 26px; line-height: 1; }
            p { margin: 0; font-size: 18px; color: #991b1b; }
          </style>
        </head>
        <body><main><section data-oc-region="mobile-module"><h1>Mobile Module</h1><p>Reference mobile</p></section></main></body>
      </html>`
    if (req.url !== "/mobile") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("mobile preview test server did not bind a TCP address")
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

async function expectPngDimensions(input: string, expected: { width: number; height: number }): Promise<void> {
  const metadata = await sharp(input).metadata()
  expect(metadata.format).toBe("png")
  expect({ width: metadata.width, height: metadata.height }).toEqual(expected)
}

async function expectPngHasColorDiversity(input: string): Promise<void> {
  const stats = await sharp(input).stats()
  expect(stats.channels.some((channel) => channel.min !== channel.max)).toBe(true)
}
