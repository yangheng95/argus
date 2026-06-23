import z from "zod"

export const BrowserPreviewViewportID = z.enum(["desktop", "tablet", "mobile"])
export type BrowserPreviewViewportID = z.infer<typeof BrowserPreviewViewportID>

export const BrowserPreviewViewport = z.object({
  id: BrowserPreviewViewportID,
  labelKey: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type BrowserPreviewViewport = z.infer<typeof BrowserPreviewViewport>

export class BrowserPreviewViewportNotFoundError extends Error {
  constructor(readonly viewportID: BrowserPreviewViewportID) {
    super(`Browser preview viewport not found on target: ${viewportID}`)
    this.name = "BrowserPreviewViewportNotFoundError"
  }
}

export function normalizeBrowserPreviewViewports(input: readonly BrowserPreviewViewport[]): BrowserPreviewViewport[] {
  const parsed = BrowserPreviewViewport.array().min(1).parse(input)
  const seen = new Set<BrowserPreviewViewportID>()
  return parsed.map((viewport) => {
    if (seen.has(viewport.id)) {
      throw new Error(`Duplicate browser preview viewport ID: ${viewport.id}`)
    }
    seen.add(viewport.id)
    return viewport
  })
}

export function browserPreviewViewportByID(
  viewports: readonly BrowserPreviewViewport[],
  id: BrowserPreviewViewportID,
): BrowserPreviewViewport {
  const viewport = viewports.find((item) => item.id === id)
  if (!viewport) throw new BrowserPreviewViewportNotFoundError(id)
  return viewport
}
