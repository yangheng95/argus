export type TaskProgressFloatingFrame = {
  x: number
  y: number
  width: number
  height: number
}

export type TaskProgressFloatingBounds = {
  inset: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  defaultWidth: number
  defaultHeight: number
  panelWidth: number
  panelHeight: number
}

const TASK_PROGRESS_FLOATING_INSET = 8
const TASK_PROGRESS_FLOATING_MIN_WIDTH = 320
const TASK_PROGRESS_FLOATING_MIN_HEIGHT = 96
const TASK_PROGRESS_FLOATING_DEFAULT_WIDTH_RATIO = 0.78
const TASK_PROGRESS_FLOATING_DEFAULT_HEIGHT = 220

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Task progress floating ${label} must be a positive finite number: ${value}`)
  }
  return value
}

function scaled(value: number, scale: number, label: string): number {
  positiveFinite(scale, "scale")
  return positiveFinite(value * scale, label)
}

export function taskProgressFloatingBounds(
  panelWidth: number,
  panelHeight: number,
  scale: number,
): TaskProgressFloatingBounds {
  const width = positiveFinite(panelWidth, "panel width")
  const height = positiveFinite(panelHeight, "panel height")
  const inset = scaled(TASK_PROGRESS_FLOATING_INSET, scale, "inset")
  const availableWidth = width - inset * 2
  const availableHeight = height - inset * 2
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    throw new Error(`Task progress floating panel width leaves no usable space: ${width}`)
  }
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
    throw new Error(`Task progress floating panel height leaves no usable space: ${height}`)
  }

  const minWidth = Math.min(scaled(TASK_PROGRESS_FLOATING_MIN_WIDTH, scale, "minimum width"), availableWidth)
  const minHeight = Math.min(scaled(TASK_PROGRESS_FLOATING_MIN_HEIGHT, scale, "minimum height"), availableHeight)
  const defaultWidth = Math.min(
    availableWidth,
    Math.max(minWidth, Math.round(availableWidth * TASK_PROGRESS_FLOATING_DEFAULT_WIDTH_RATIO)),
  )
  const defaultHeight = Math.min(scaled(TASK_PROGRESS_FLOATING_DEFAULT_HEIGHT, scale, "default height"), availableHeight)

  return {
    inset,
    minWidth,
    minHeight,
    maxWidth: availableWidth,
    maxHeight: availableHeight,
    defaultWidth,
    defaultHeight,
    panelWidth: width,
    panelHeight: height,
  }
}

export function clampTaskProgressFloatingFrame(
  frame: TaskProgressFloatingFrame,
  bounds: TaskProgressFloatingBounds,
): TaskProgressFloatingFrame {
  const width = Math.round(Math.min(bounds.maxWidth, Math.max(bounds.minWidth, frame.width)))
  const height = Math.round(Math.min(bounds.maxHeight, Math.max(bounds.minHeight, frame.height)))
  const minX = Math.round(bounds.inset)
  const minY = Math.round(bounds.inset)
  const maxX = Math.round(bounds.panelWidth - bounds.inset - width)
  const maxY = Math.round(bounds.panelHeight - bounds.inset - height)

  return {
    x: Math.round(Math.min(Math.max(frame.x, minX), maxX)),
    y: Math.round(Math.min(Math.max(frame.y, minY), maxY)),
    width,
    height,
  }
}

export function initialTaskProgressFloatingFrame(bounds: TaskProgressFloatingBounds): TaskProgressFloatingFrame {
  return clampTaskProgressFloatingFrame(
    {
      x: bounds.inset,
      y: bounds.inset,
      width: bounds.defaultWidth,
      height: bounds.defaultHeight,
    },
    bounds,
  )
}

export function moveTaskProgressFloatingFrame(
  frame: TaskProgressFloatingFrame,
  deltaX: number,
  deltaY: number,
  bounds: TaskProgressFloatingBounds,
): TaskProgressFloatingFrame {
  return clampTaskProgressFloatingFrame(
    {
      ...frame,
      x: frame.x + deltaX,
      y: frame.y + deltaY,
    },
    bounds,
  )
}

export function resizeTaskProgressFloatingFrame(
  frame: TaskProgressFloatingFrame,
  deltaX: number,
  deltaY: number,
  bounds: TaskProgressFloatingBounds,
): TaskProgressFloatingFrame {
  const anchored = clampTaskProgressFloatingFrame(frame, bounds)
  const maxWidthFromAnchor = bounds.panelWidth - bounds.inset - anchored.x
  const maxHeightFromAnchor = bounds.panelHeight - bounds.inset - anchored.y
  return {
    ...anchored,
    width: Math.round(Math.min(maxWidthFromAnchor, Math.max(bounds.minWidth, anchored.width + deltaX))),
    height: Math.round(Math.min(maxHeightFromAnchor, Math.max(bounds.minHeight, anchored.height + deltaY))),
  }
}
