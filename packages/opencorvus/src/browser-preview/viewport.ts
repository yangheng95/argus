import z from "zod"

export const BROWSER_PREVIEW_VIEWPORTS = [
  { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 1280, height: 800 },
  { id: "tablet", labelKey: "browser_preview.viewport.tablet", width: 834, height: 1112 },
  { id: "mobile", labelKey: "browser_preview.viewport.mobile", width: 390, height: 844 },
] as const

export const BrowserPreviewViewportID = z.enum(["desktop", "tablet", "mobile"])
export type BrowserPreviewViewportID = z.infer<typeof BrowserPreviewViewportID>

export const BrowserPreviewViewport = z.object({
  id: BrowserPreviewViewportID,
  labelKey: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type BrowserPreviewViewport = z.infer<typeof BrowserPreviewViewport>

export function browserPreviewViewportByID(id: BrowserPreviewViewportID): BrowserPreviewViewport {
  return BROWSER_PREVIEW_VIEWPORTS.find((viewport) => viewport.id === id) ?? BROWSER_PREVIEW_VIEWPORTS[0]
}
