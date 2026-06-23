export interface CenterWorkbenchResizeRange {
  minWidth: number
  maxWidth: number
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`)
  }
}

export function centerWorkbenchResizeRange(totalWidth: number, minWidth: number): CenterWorkbenchResizeRange | null {
  assertFinitePositive(totalWidth, "Center workbench resize total width")
  assertFinitePositive(minWidth, "Center workbench resize minimum width")

  const maxWidth = totalWidth - minWidth
  if (maxWidth < minWidth) return null
  return { minWidth, maxWidth }
}

export function clampCenterWorkbenchResizeWidth(range: CenterWorkbenchResizeRange, rawWidth: number): number {
  assertFinitePositive(range.minWidth, "Center workbench resize range minimum width")
  assertFinitePositive(range.maxWidth, "Center workbench resize range maximum width")
  if (range.maxWidth < range.minWidth) {
    throw new Error("Center workbench resize range maximum width must be greater than or equal to the minimum width.")
  }
  if (!Number.isFinite(rawWidth)) {
    throw new Error("Center workbench resize width must be finite.")
  }
  return Math.min(Math.max(rawWidth, range.minWidth), range.maxWidth)
}
