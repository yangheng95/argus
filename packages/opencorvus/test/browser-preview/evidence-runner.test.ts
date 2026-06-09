import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { PNG } from "pngjs"
import { finalizeBrowserPreviewSidecarCapture } from "../../src/browser-preview/evidence-runner"
import type { RuntimeCaptureSuccess } from "../../src/runtime/page-capture"
import { tmpdir } from "../fixture/fixture"

describe("browser preview evidence runner contract", () => {
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

function passedLayers(screenshotPath: string): RuntimeCaptureSuccess["layers"] {
  return {
    http: { passed: true, status: 200, content_type: "text/html", body_length: 240, reason: "" },
    asset: { passed: true, total: 1, failed: [] },
    dom: { passed: true, body_descendants: 20, required: 20 },
    js: { passed: true, console_errors: [], page_errors: [] },
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

async function writePng(filePath: string, mode: "solid" | "noise") {
  const png = new PNG({ width: 16, height: 16 })
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
