import { persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import type { BrowserPreviewViewport, BrowserPreviewViewportID } from "../../src/browser-preview/viewport"

export const TEST_BROWSER_PREVIEW_VIEWPORTS: BrowserPreviewViewport[] = [
  { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1440, height: 800 },
  { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 927, height: 1201 },
  { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 412, height: 915 },
]

export function testBrowserPreviewViewport(id: BrowserPreviewViewportID): BrowserPreviewViewport {
  const viewport = TEST_BROWSER_PREVIEW_VIEWPORTS.find((item) => item.id === id)
  if (!viewport) throw new Error(`Missing test browser preview viewport: ${id}`)
  return viewport
}

export function persistTestBrowserPreviewTarget(
  input: Omit<Parameters<typeof persistBrowserPreviewTarget>[0], "viewports"> & {
    viewports?: readonly BrowserPreviewViewport[]
  },
) {
  return persistBrowserPreviewTarget({ ...input, viewports: input.viewports ?? TEST_BROWSER_PREVIEW_VIEWPORTS })
}
