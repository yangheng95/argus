import { describe, expect, test } from "bun:test"
import { resolveBrowserPreviewTarget } from "../../src/browser-preview/target"
import { verifyBrowserPreview } from "../../src/browser-preview/verification"
import { tmpdir } from "../fixture/fixture"
import type { RuntimeCaptureInput, RuntimeCaptureResult } from "../../src/runtime/page-capture"

describe("browser preview verification", () => {
  test("captures the resolved URL with the shared viewport preset", async () => {
    await using tmp = await tmpdir()
    const target = await resolveBrowserPreviewTarget({
      projectRoot: tmp.path,
      explicitUrl: "http://127.0.0.1:5173/",
    })
    let capturedInput: RuntimeCaptureInput | undefined

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      target,
      viewportID: "tablet",
      outDir: tmp.path,
      async capture(input) {
        capturedInput = input
        return {
          captured: true,
          passed: true,
          url: input.url,
          target_url: input.url,
          path: `${tmp.path}/tablet.png`,
          sha: "abc123",
          bytes: 128,
          size: { width: 834, height: 1112 },
          requested_viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0 },
          viewport: { width: input.viewport_width ?? 0, height: input.viewport_height ?? 0, capped: false },
          layers: {},
          dom: {
            textLength: 12,
            nodeCount: 8,
            bodyDescendantCount: 6,
            hasBodyChildren: true,
            isEmptyRootShell: false,
          },
          summary: "all runtime capture layers passed on http://127.0.0.1:5173/",
        } as RuntimeCaptureResult
      },
    })

    expect(result.status).toBe("passed")
    expect(result.viewport.id).toBe("tablet")
    expect(capturedInput?.url).toBe("http://127.0.0.1:5173/")
    expect(capturedInput?.viewport_width).toBe(834)
    expect(capturedInput?.viewport_height).toBe(1112)
    expect(capturedInput?.fileLabel).toBe("tablet")
  })

  test("fails visibly when the target has no URL", async () => {
    await using tmp = await tmpdir()
    const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path })

    const result = await verifyBrowserPreview({
      projectRoot: tmp.path,
      target,
      viewportID: "desktop",
      async capture() {
        throw new Error("capture should not run")
      },
    })

    expect(result.status).toBe("failed")
    expect(result.capture).toBeUndefined()
    expect(result.diagnostics.join("\n")).toContain("requires a resolved http(s) URL")
  })
})
