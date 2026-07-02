import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "..", "..")

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8")
}

test("PNG live browser preview sidecar is retired instead of kept as a fallback", () => {
  expect(existsSync(resolve(ROOT, "src/browser-preview/live.ts"))).toBe(false)

  const routes = source("src/server/routes/browser-preview.ts")
  const serve = source("src/cli/cmd/serve.ts")
  const appRoutes = source("src/server/routes/app.ts")
  const globalRoutes = source("src/server/routes/global.ts")

  expect(routes).not.toContain("browserPreview.liveSnapshot")
  expect(routes).not.toContain("browserPreview.liveInput")
  expect(routes).not.toContain("/task/:taskID/browser-preview/live/snapshot")
  expect(routes).not.toContain("/task/:taskID/browser-preview/live/input")
  expect(routes).not.toContain("captureBrowserPreviewLiveSnapshot")
  expect(routes).not.toContain("interactBrowserPreviewLive")
  expect(serve).not.toContain("closeBrowserPreviewLiveSessions")
  expect(appRoutes).not.toContain("closeBrowserPreviewLiveSessions")
  expect(globalRoutes).not.toContain("closeBrowserPreviewLiveSessions")
})

test("browser preview backend keeps Playwright evidence APIs after live PNG retirement", () => {
  const routes = source("src/server/routes/browser-preview.ts")

  expect(routes).toContain("browserPreview.taskTarget")
  expect(routes).toContain("browserPreview.captureTaskTarget")
  expect(routes).toContain("browserPreview.readTaskEvidence")
  expect(routes).toContain("browserPreview.readTaskEvidenceCapture")
  expect(routes).toContain("browserPreview.compareTaskTargetRegions")
})
