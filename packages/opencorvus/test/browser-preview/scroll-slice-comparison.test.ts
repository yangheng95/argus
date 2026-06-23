import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { compareBrowserPreviewScrollSlice } from "../../src/browser-preview/scroll-slice-comparison"
import { findBrowserPreviewTargetByID, resolveRuntimeRelativePath } from "../../src/browser-preview/persist"
import {
  BrowserPreviewCompareScrollSlicesTool,
  BrowserPreviewCompareScrollSlicesToolParameters,
} from "../../src/tool/browser-preview-compare-scroll-slices"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"

const SCROLL_SLICE_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview scroll-slice comparison", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test(
    "reuses existing reference screenshot and returns scroll-slice side-by-side artifacts",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await makeReferencePng(path.join(paths.sourcePackageAbsolute, "reference.png"), {
        width: 360,
        height: 900,
        firstColor: "#dbeafe",
        secondColor: "#dcfce7",
      })
      const server = await startScrollPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
        })
        const result = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            compareBrowserPreviewScrollSlice({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              viewportID: "desktop",
              sourceReferenceArtifactID: "reference.png",
              route: "/scroll",
              scrollY: 300,
              sliceHeight: 180,
            }),
        })

        expect(result.status).toBe("completed")
        expect(result.operation).toBe("scroll-slice-comparison")
        expect(result.implementation.actualScrollY).toBe(300)
        expect(result.implementation.viewport).toEqual({ width: 360, height: 180 })
        expect(result.diagnostics.join("\n")).toContain("supporting Visual QA evidence only")
        expect(result.diagnostics.join("\n")).toContain("not browser_preview_compare_regions")
        const sourceCrop = resolveRuntimeRelativePath(tmp.path, result.artifacts.source_crop)
        const implementationCrop = resolveRuntimeRelativePath(tmp.path, result.artifacts.implementation_crop)
        const sideBySide = resolveRuntimeRelativePath(tmp.path, result.artifacts.side_by_side)
        await expectPngDimensions(sourceCrop, { width: 360, height: 180 })
        await expectPngDimensions(implementationCrop, { width: 360, height: 180 })
        await expectPngDimensions(sideBySide, { width: 736, height: 256 })
        expect(findBrowserPreviewTargetByID({ taskID, targetID: target.id })?.url).toBe(server.url)
      } finally {
        await server.close()
      }
    },
    SCROLL_SLICE_TEST_TIMEOUT_MILLISECONDS,
  )

  test(
    "tool result attaches the composed side-by-side image and rejects raw URL-shaped parameters",
    async () => {
      expect(
        BrowserPreviewCompareScrollSlicesToolParameters.safeParse({
          targetID: "art_target",
          viewportID: "desktop",
          sourceReferenceArtifactID: "reference.png",
          route: "/",
          scrollY: 0,
          sliceHeight: 120,
          sourceUrl: "https://example.com/",
        }).success,
      ).toBe(false)
      expect(
        BrowserPreviewCompareScrollSlicesToolParameters.safeParse({
          targetID: "art_target",
          viewportID: "desktop",
          sourceReferenceArtifactID: "reference.png",
          route: "/",
          scrollY: 0,
          sliceHeight: 120,
          implementationUrl: "http://127.0.0.1:5173/",
        }).success,
      ).toBe(false)
      expect(
        BrowserPreviewCompareScrollSlicesToolParameters.safeParse({
          targetID: "art_target",
          viewportID: "desktop",
          sourceReferenceArtifactID: "reference.png",
          route: "https://example.com/",
          scrollY: 0,
          sliceHeight: 120,
        }).success,
      ).toBe(false)
      expect(
        BrowserPreviewCompareScrollSlicesToolParameters.safeParse({
          targetID: "art_target",
          viewportID: "desktop",
          sourceReferenceArtifactID: "reference.png",
          route: "//example.com/",
          scrollY: 0,
          sliceHeight: 120,
        }).success,
      ).toBe(false)

      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await makeReferencePng(path.join(paths.sourcePackageAbsolute, "reference.png"), {
        width: 320,
        height: 640,
        firstColor: "#fef3c7",
        secondColor: "#fee2e2",
      })
      const server = await startScrollPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
        })
        const tool = await BrowserPreviewCompareScrollSlicesTool.init()
        const output = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            tool.execute(
              {
                targetID: target.id,
                viewportID: "desktop",
                sourceReferenceArtifactID: "reference.png",
                route: "/scroll",
                scrollY: 120,
                sliceHeight: 160,
                includeDiff: false,
              },
              {
                abort: new AbortController().signal,
                extra: { taskID },
              } as any,
            ),
        })
        expect(output.attachments).toHaveLength(1)
        expect(output.attachments[0]?.mime).toBe("image/png")
        expect(output.metadata.referenceComparisonProof).toBe(false)
        expect(output.output).toContain("Supporting visual_diff evidence only")
      } finally {
        await server.close()
      }
    },
    SCROLL_SLICE_TEST_TIMEOUT_MILLISECONDS,
  )

  test("fails when requested scroll slice exceeds reference image bounds", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = await seedTask(tmp.path)
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await makeReferencePng(path.join(paths.sourcePackageAbsolute, "reference.png"), {
      width: 320,
      height: 200,
      firstColor: "#ffffff",
      secondColor: "#f8fafc",
    })
    const target = await Instance.provide({
      directory: tmp.path,
      fn: () => persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:9/" }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          compareBrowserPreviewScrollSlice({
            projectRoot: tmp.path,
            taskID,
            targetID: target.id,
            viewportID: "desktop",
            sourceReferenceArtifactID: "reference.png",
            route: "/",
            scrollY: 180,
            sliceHeight: 40,
          }),
        ).rejects.toThrow("Requested scroll slice exceeds reference image bounds")
      },
    })
  })
})

async function seedTask(directory: string) {
  const taskID = `tsk_scrollslice${Date.now()}${Math.floor(Math.random() * 1000)}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Scroll slice task",
            request: "Compare final page scroll slices",
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

async function makeReferencePng(
  outputPath: string,
  input: { width: number; height: number; firstColor: string; secondColor: string },
) {
  await sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 4,
      background: input.firstColor,
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${input.width}" height="${input.height}" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="${Math.floor(input.height / 3)}" width="${input.width}" height="${Math.floor(
              input.height / 3,
            )}" fill="${input.secondColor}"/>
            <text x="24" y="80" font-family="Arial" font-size="32" fill="#111827">Reference top</text>
            <text x="24" y="${Math.floor(input.height / 3) + 80}" font-family="Arial" font-size="32" fill="#111827">Reference middle</text>
          </svg>`,
        ),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toFile(outputPath)
}

async function startScrollPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    if (req.url !== "/scroll") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(`<!doctype html>
      <html>
        <head>
          <title>Scroll slice implementation</title>
          <style>
            html, body { margin: 0; width: 100%; min-height: 960px; font-family: Arial, sans-serif; }
            .top { height: 320px; background: #dbeafe; color: #111827; box-sizing: border-box; padding: 48px 24px; }
            .middle { height: 320px; background: #dcfce7; color: #111827; box-sizing: border-box; padding: 48px 24px; }
            .bottom { height: 320px; background: #fee2e2; color: #111827; box-sizing: border-box; padding: 48px 24px; }
            h1 { margin: 0; font-size: 32px; line-height: 1.2; }
          </style>
        </head>
        <body>
          <section class="top"><h1>Implementation top</h1></section>
          <section class="middle"><h1>Implementation middle</h1></section>
          <section class="bottom"><h1>Implementation bottom</h1></section>
        </body>
      </html>`)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("scroll preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function expectPngDimensions(input: string, expected: { width: number; height: number }): Promise<void> {
  const metadata = await sharp(input).metadata()
  expect(metadata.format).toBe("png")
  expect({ width: metadata.width, height: metadata.height }).toEqual(expected)
}
