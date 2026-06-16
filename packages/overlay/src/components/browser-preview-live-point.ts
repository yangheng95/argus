export interface BrowserPreviewLiveViewportSize {
  width: number
  height: number
}

export interface BrowserPreviewLiveImageRect {
  left: number
  top: number
  width: number
  height: number
}

export interface BrowserPreviewLiveClientPoint {
  clientX: number
  clientY: number
}

export function browserPreviewLivePoint(
  event: BrowserPreviewLiveClientPoint,
  imageRect: BrowserPreviewLiveImageRect,
  viewport: BrowserPreviewLiveViewportSize | undefined,
): { x: number; y: number } | undefined {
  if (!viewport || imageRect.width <= 0 || imageRect.height <= 0) return undefined
  return {
    x: Math.max(0, Math.min(viewport.width, ((event.clientX - imageRect.left) / imageRect.width) * viewport.width)),
    y: Math.max(0, Math.min(viewport.height, ((event.clientY - imageRect.top) / imageRect.height) * viewport.height)),
  }
}
