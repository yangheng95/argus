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

export function clampCenterWorkbenchResizeWidth(totalWidth: number, minWidth: number, rawWidth: number): number | null {
  if (!Number.isFinite(rawWidth)) {
    throw new Error("Center workbench resize width must be finite.")
  }
  const range = centerWorkbenchResizeRange(totalWidth, minWidth)
  if (!range) return null
  return Math.min(Math.max(rawWidth, range.minWidth), range.maxWidth)
}
