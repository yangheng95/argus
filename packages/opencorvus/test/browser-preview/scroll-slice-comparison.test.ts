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
        expect(result.comparison_guidance.side_by_side_legend.left.role).toBe("source_reference")
        expect(result.comparison_guidance.side_by_side_legend.right.role).toBe("local_implementation")
        expect(result.comparison_guidance.side_by_side_legend.source_of_truth).toBe("left")
        expect(result.comparison_guidance.inspection_checklist.map((item) => item.id)).toEqual(
          expect.arrayContaining(["layout_alignment", "icon_asset_fidelity", "content_truth", "spacing_density"]),
        )
        expect(result.diagnostics.join("\n")).toContain("supporting Visual QA evidence only")
        expect(result.diagnostics.join("\n")).toContain("not reference-comparison proof")
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
    "adds low SSIM diagnostics when scroll slices are probably mismatched",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await makeMismatchedReferencePng(path.join(paths.sourcePackageAbsolute, "reference.png"), 360, 900)
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
        expect(result.visual.ssim_score).toBeLessThan(0.8)
        const diagnostics = result.diagnostics.join("\n")
        expect(diagnostics).toContain("Low SSIM precheck")
        expect(diagnostics).toContain("screenshots may not match")
        expect(diagnostics).toContain("page should be calibrated as a whole")
        const sideBySide = resolveRuntimeRelativePath(tmp.path, result.artifacts.side_by_side)
        await expectPngDimensions(sideBySide, { width: 736, height: 288 })
      } finally {
        await server.close()
      }
    },
    SCROLL_SLICE_TEST_TIMEOUT_MILLISECONDS,
  )

  test(
    "uses exact instant scrolling when the implementation page enables smooth scrolling",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await makeReferencePng(path.join(paths.sourcePackageAbsolute, "reference.png"), {
        width: 360,
        height: 3600,
        firstColor: "#dbeafe",
        secondColor: "#dcfce7",
      })
      const server = await startScrollPreviewServer("smooth-scroll")
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
              scrollY: 1800,
              sliceHeight: 180,
            }),
        })

        expect(result.status).toBe("completed")
        expect(result.implementation.actualScrollY).toBe(1800)
        const implementationCrop = resolveRuntimeRelativePath(tmp.path, result.artifacts.implementation_crop)
        const sideBySide = resolveRuntimeRelativePath(tmp.path, result.artifacts.side_by_side)
        await expectPngDimensions(implementationCrop, { width: 360, height: 180 })
        await expectPngDimensions(sideBySide, { width: 736, height: 256 })
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
        const payload = JSON.parse(output.output)
        expect(payload.comparison_guidance.side_by_side_legend.left.label).toBe("LEFT: source/reference image")
        expect(payload.comparison_guidance.side_by_side_legend.right.label).toBe(
          "RIGHT: rendered/local implementation",
        )
        expect(payload.comparison_guidance.inspection_checklist.map((item: { id: string }) => item.id)).toEqual(
          expect.arrayContaining(["color_surface_tokens", "typography_text", "implementation_artifacts"]),
        )
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

  test(
    "rejects late browser page errors before writing completed comparison artifacts",
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
      const server = await startScrollPreviewServer("late-pageerror")
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
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
                route: "/scroll",
                scrollY: 300,
                sliceHeight: 180,
              }),
            ).rejects.toThrow("late scroll-slice pageerror")
          },
        })
      } finally {
        await server.close()
      }
    },
    SCROLL_SLICE_TEST_TIMEOUT_MILLISECONDS,
  )
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

async function makeMismatchedReferencePng(outputPath: string, width: number, height: number) {
  const stripes = Array.from({ length: Math.ceil(height / 20) }, (_, index) => {
    const y = index * 20
    const fill = index % 2 === 0 ? "#020617" : "#f8fafc"
    return `<rect x="0" y="${y}" width="${width}" height="20" fill="${fill}"/>`
  }).join("")
  const diagonals = Array.from({ length: Math.ceil(width / 24) }, (_, index) => {
    const x = index * 24 - height
    return `<path d="M ${x} ${height} L ${x + height} 0" stroke="#dc2626" stroke-width="5"/>`
  }).join("")
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#020617",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${stripes}${diagonals}</svg>`,
        ),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toFile(outputPath)
}

async function startScrollPreviewServer(
  mode: "ok" | "late-pageerror" | "smooth-scroll" = "ok",
): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    if (req.url !== "/scroll") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    const sectionHeight = mode === "smooth-scroll" ? 1200 : 320
    const pageMinHeight = sectionHeight * 3
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(`<!doctype html>
      <html>
        <head>
          <title>Scroll slice implementation</title>
          <style>
            html, body { margin: 0; width: 100%; min-height: ${pageMinHeight}px; font-family: Arial, sans-serif; }
            ${mode === "smooth-scroll" ? "html { scroll-behavior: smooth; }" : ""}
            .top { height: ${sectionHeight}px; background: #dbeafe; color: #111827; box-sizing: border-box; padding: 48px 24px; }
            .middle { height: ${sectionHeight}px; background: #dcfce7; color: #111827; box-sizing: border-box; padding: 48px 24px; }
            .bottom { height: ${sectionHeight}px; background: #fee2e2; color: #111827; box-sizing: border-box; padding: 48px 24px; }
            h1 { margin: 0; font-size: 32px; line-height: 1.2; }
          </style>
          ${
            mode === "late-pageerror"
              ? '<script>setTimeout(() => { throw new Error("late scroll-slice pageerror") }, 100)</script>'
              : ""
          }
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
