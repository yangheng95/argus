import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { PNG } from "pngjs"
import {
  finalizeBrowserPreviewSidecarCapture,
  runBrowserPreviewEvidenceJob,
  writeBrowserEvidenceManifest,
} from "../../src/browser-preview/evidence-runner"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import type { RuntimeCaptureSuccess } from "../../src/runtime/capture-contract"
import { tmpdir } from "../fixture/fixture"

describe("browser preview evidence runner contract", () => {
  test("sidecar captures full-page screenshots instead of viewport clips", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dir, "../../src/browser-preview/evidence-runner.ts"),
      "utf8",
    )

    expect(source).toContain("collectPageSize(page)")
    expect(source).toContain("collectGlyphCoverage(page)")
    expect(source).toContain('failedLayers.push("glyph")')
    expect(source).toContain("fullPage: true")
    expect(source).not.toContain("clip: { x: 0, y: 0")
  })

  test("product runner input derives URL and output directory from task scoped authorities", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dir, "../../src/browser-preview/evidence-runner.ts"),
      "utf8",
    )
    const inputType = source.match(/type BrowserPreviewEvidenceRunnerInput = \{[\s\S]*?\n\}/)?.[0] ?? ""

    expect(inputType).toContain("projectRoot: string")
    expect(inputType).toContain("taskID: string")
    expect(inputType).toContain("targetID: string")
    expect(inputType).not.toContain("url:")
    expect(inputType).not.toContain("outDir:")
    expect(source).toContain("findBrowserPreviewTargetByID")
    expect(source).toContain("ProjectRuntimePaths.browserPreviewJobRoot(projectRoot, input.taskID, jobID)")
  })

  test("owns browser runtime launch for preview and region comparison evidence", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dir, "../../src/browser-preview/evidence-runner.ts"),
      "utf8",
    )

    expect(source).toContain("runBrowserNodeSidecar")
    expect(source).toContain("BROWSER_PREVIEW_REGION_COMPARISON_SCRIPT")
    expect(source).toContain("runBrowserPreviewRegionComparisonCapture")
    expect(source).toContain(
      'import type { BrowserPreviewRegionBinding, BrowserPreviewRegionBox } from "./region-comparison"',
    )
    expect(source).not.toContain("import { BrowserPreviewRegionBinding")
  })

  test("product runner rejects an unknown target before creating a runtime job", async () => {
    await using tmp = await tmpdir()
    const taskID = "tsk_preview_missing_target"

    await expect(
      runBrowserPreviewEvidenceJob({
        projectRoot: tmp.path,
        taskID,
        targetID: "art_preview_missing_target",
        viewportIDs: ["desktop"],
      }),
    ).rejects.toThrow("Browser preview target not found: art_preview_missing_target")
    await expect(fs.stat(ProjectRuntimePaths.taskAbsolute(tmp.path, taskID, "bp"))).rejects.toThrow()
  })

  test("manifest records viewport IDs and diagnostics path as runner evidence metadata", async () => {
    await using tmp = await tmpdir()
    const desktopPath = path.join(tmp.path, "desktop.png")
    const mobilePath = path.join(tmp.path, "mobile.png")
    const captures = {
      desktop: passedCapture("desktop", desktopPath),
      mobile: failedCapture("mobile"),
    }

    const manifest = await writeBrowserEvidenceManifest({
      outDir: tmp.path,
      jobID: "art_preview_job",
      taskID: "tsk_preview",
      targetID: "art_preview_target",
      url: "http://127.0.0.1:5173/",
      viewportIDs: ["desktop", "mobile"],
      artifactPaths: [desktopPath, mobilePath],
      captures,
      diagnostics: ["desktop passed", "mobile failed"],
    })

    expect(manifest.operations).toEqual([
      {
        kind: "preview-capture",
        status: "failed",
        viewportIDs: ["desktop", "mobile"],
        artifactPaths: [desktopPath, mobilePath],
        diagnosticsPath: path.join(tmp.path, "diagnostics.json"),
      },
    ])
    const manifestJSON = JSON.parse(await fs.readFile(manifest.manifestPath, "utf8"))
    expect(manifestJSON.operations[0].viewportIDs).toEqual(["desktop", "mobile"])
    expect(manifestJSON.operations[0].diagnosticsPath).toBe(path.join(tmp.path, "diagnostics.json"))
    expect(manifestJSON.captures.desktop.summary).toBe("desktop passed")
    const diagnosticsJSON = JSON.parse(await fs.readFile(path.join(tmp.path, "diagnostics.json"), "utf8"))
    expect(diagnosticsJSON).toMatchObject({
      jobID: "art_preview_job",
      taskID: "tsk_preview",
      targetID: "art_preview_target",
      url: "http://127.0.0.1:5173/",
      viewportIDs: ["desktop", "mobile"],
      diagnostics: ["desktop passed", "mobile failed"],
    })
  })

  test("manifest writing rejects missing target identity before evidence files are created", async () => {
    await using tmp = await tmpdir()

    await expect(
      writeBrowserEvidenceManifest({
        outDir: tmp.path,
        jobID: "art_preview_job",
        taskID: "tsk_preview",
        targetID: "",
        url: "http://127.0.0.1:5173/",
        viewportIDs: ["desktop"],
        artifactPaths: [],
        captures: {},
        diagnostics: [],
      }),
    ).rejects.toThrow(/targetID/)
    await expect(fs.stat(path.join(tmp.path, "manifest.json"))).rejects.toThrow()
    await expect(fs.stat(path.join(tmp.path, "diagnostics.json"))).rejects.toThrow()
  })

  test("does not synthesize passed layers when the sidecar omits structured evidence", async () => {
    await using tmp = await tmpdir()
    const screenshotPath = path.join(tmp.path, "desktop.png")
    await writePng(screenshotPath, "noise")

    const result = await finalizeBrowserPreviewSidecarCapture({
      capture: sidecarCapture({
        path: screenshotPath,
        layers: undefined,
        dom: undefined,
      }),
      url: "http://127.0.0.1:5173/",
      outDir: tmp.path,
    })

    expect(result.artifactPath).toBeUndefined()
    expect(result.capture.captured).toBe(false)
    expect(result.capture.passed).toBe(false)
    expect(result.capture.summary).toContain("sidecar did not return structured layers and dom evidence")
  })

  test("derives pixel pass from screenshot variance instead of the sidecar passed flag", async () => {
    await using tmp = await tmpdir()
    const screenshotPath = path.join(tmp.path, "desktop.png")
    await writePng(screenshotPath, "solid")

    const result = await finalizeBrowserPreviewSidecarCapture({
      capture: sidecarCapture({
        path: screenshotPath,
        layers: passedLayers(screenshotPath),
        dom: populatedDom(),
      }),
      url: "http://127.0.0.1:5173/",
      outDir: tmp.path,
    })

    const { capture } = result
    expect(capture?.captured).toBe(true)
    expect(capture?.passed).toBe(false)
    expect(capture?.summary).toBe("failed layers: pixel")
    expect(capture?.captured && capture.layers.pixel.passed).toBe(false)
    expect(capture?.captured && capture.layers.pixel.variance).toBe(0)
    expect(result.artifactPath).toBe(capture?.captured && capture.path)
  })

  test("uses decoded PNG dimensions for scrollable full-page evidence size", async () => {
    await using tmp = await tmpdir()
    const screenshotPath = path.join(tmp.path, "desktop.png")
    await writePng(screenshotPath, "noise", { width: 12, height: 96 })

    const result = await finalizeBrowserPreviewSidecarCapture({
      capture: sidecarCapture({
        path: screenshotPath,
        layers: passedLayers(screenshotPath),
        dom: populatedDom(),
      }),
      url: "http://127.0.0.1:5173/",
      outDir: tmp.path,
    })

    expect(result.capture.captured).toBe(true)
    if (!result.capture.captured) return
    expect(result.capture.size).toEqual({ width: 12, height: 96 })
    expect(result.capture.viewport).toEqual({ width: 1440, height: 1080, capped: false })
  })

  test("includes first JavaScript console error in failed layer summaries", async () => {
    await using tmp = await tmpdir()
    const screenshotPath = path.join(tmp.path, "desktop.png")
    await writePng(screenshotPath, "noise")
    const layers = passedLayers(screenshotPath)
    layers.js = {
      passed: false,
      console_errors: ["forwardRef render functions accept exactly two parameters: props and ref."],
      page_errors: [],
    }

    const result = await finalizeBrowserPreviewSidecarCapture({
      capture: sidecarCapture({
        path: screenshotPath,
        layers,
        dom: populatedDom(),
      }),
      url: "http://127.0.0.1:5173/",
      outDir: tmp.path,
    })

    expect(result.capture.captured).toBe(true)
    if (!result.capture.captured) return
    expect(result.capture.summary).toBe(
      "failed layers: js; js console error: forwardRef render functions accept exactly two parameters: props and ref.",
    )
  })

  test("surfaces missing glyph coverage as a first-class failed layer", async () => {
    await using tmp = await tmpdir()
    const screenshotPath = path.join(tmp.path, "desktop.png")
    await writePng(screenshotPath, "noise")

    const layers = passedLayers(screenshotPath)
    layers.glyph = {
      passed: false,
      checked: 1,
      failed: [
        {
          text: "按钮",
          font_family: "MissingCjkFont, sans-serif",
          font_spec: "normal normal 400 14px MissingCjkFont, sans-serif",
          reason: "canvas glyph matched missing-glyph sentinel",
          missing_chars: ["按", "钮"],
        },
      ],
    }

    const result = await finalizeBrowserPreviewSidecarCapture({
      capture: sidecarCapture({
        path: screenshotPath,
        layers,
        dom: populatedDom(),
      }),
      url: "http://127.0.0.1:5173/",
      outDir: tmp.path,
    })

    expect(result.capture.captured).toBe(true)
    if (!result.capture.captured) return
    expect(result.capture.passed).toBe(false)
    expect(result.capture.summary).toBe("failed layers: glyph")
    expect(result.capture.layers.glyph.failed[0]?.missing_chars).toEqual(["按", "钮"])
  })

  test("treats a missing required glyph layer as failed evidence", async () => {
    await using tmp = await tmpdir()
    const screenshotPath = path.join(tmp.path, "desktop.png")
    await writePng(screenshotPath, "noise")
    const layers = passedLayers(screenshotPath) as unknown as Record<string, unknown>
    delete layers.glyph

    const result = await finalizeBrowserPreviewSidecarCapture({
      capture: sidecarCapture({
        path: screenshotPath,
        layers: layers as RuntimeCaptureSuccess["layers"],
        dom: populatedDom(),
      }),
      url: "http://127.0.0.1:5173/",
      outDir: tmp.path,
    })

    expect(result.capture.captured).toBe(true)
    if (!result.capture.captured) return
    expect(result.capture.passed).toBe(false)
    expect(result.capture.summary).toBe("failed layers: glyph")
  })
})

function sidecarCapture(input: {
  path: string
  layers?: RuntimeCaptureSuccess["layers"]
  dom?: RuntimeCaptureSuccess["dom"]
}) {
  return {
    id: "desktop",
    captured: true,
    passed: true,
    target_url: "http://127.0.0.1:5173/",
    path: input.path,
    size: { width: 1440, height: 1080 },
    requested_viewport: { width: 1440, height: 1080 },
    viewport: { width: 1440, height: 1080, capped: false },
    layers: input.layers,
    dom: input.dom,
    summary: "sidecar claimed pass",
  } as const
}

function passedCapture(id: "desktop" | "mobile", screenshotPath: string) {
  return {
    captured: true,
    passed: true,
    url: "http://127.0.0.1:5173/",
    target_url: "http://127.0.0.1:5173/",
    path: screenshotPath,
    sha: "abc123",
    bytes: 128,
    size: { width: 1280, height: 800 },
    requested_viewport: { width: 1280, height: 800 },
    viewport: { width: 1280, height: 800, capped: false },
    layers: passedLayers(screenshotPath),
    dom: populatedDom(),
    summary: `${id} passed`,
  } as const
}

function failedCapture(id: "desktop" | "mobile") {
  return {
    captured: false,
    passed: false,
    url: "http://127.0.0.1:5173/",
    requested_viewport: { width: 390, height: 844 },
    viewport: { width: 390, height: 844, capped: false },
    capture_error: { kind: "capture_failed", message: `${id} failed` },
    summary: `${id} failed`,
  } as const
}

function passedLayers(screenshotPath: string): RuntimeCaptureSuccess["layers"] {
  return {
    http: { passed: true, status: 200, content_type: "text/html", body_length: 240, reason: "" },
    asset: { passed: true, total: 1, failed: [] },
    dom: { passed: true, body_descendants: 20, required: 20 },
    js: { passed: true, console_errors: [], page_errors: [] },
    glyph: { passed: true, checked: 0, failed: [] },
    pixel: { passed: true, variance: 240, floor: 1, screenshot_path: screenshotPath },
    expected: { passed: true, missing_selectors: [], missing_texts: [] },
  }
}

function populatedDom(): RuntimeCaptureSuccess["dom"] {
  return {
    textLength: 32,
    nodeCount: 24,
    bodyDescendantCount: 20,
    hasBodyChildren: true,
    isEmptyRootShell: false,
  }
}

async function writePng(filePath: string, mode: "solid" | "noise", size = { width: 16, height: 16 }) {
  const png = new PNG(size)
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (png.width * y + x) << 2
      const value = mode === "solid" ? 255 : (x * 17 + y * 11) % 256
      png.data[i] = value
      png.data[i + 1] = value
      png.data[i + 2] = value
      png.data[i + 3] = 255
    }
  }
  await fs.writeFile(filePath, PNG.sync.write(png))
}
