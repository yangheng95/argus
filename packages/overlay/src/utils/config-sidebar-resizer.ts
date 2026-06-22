export const CONFIG_SIDEBAR_MIN_WIDTH = 140
export const CONFIG_SIDEBAR_MAX_WIDTH = 320
export const CONFIG_SIDEBAR_KEYBOARD_STEP = 16

export type ConfigSidebarResizeBounds = {
  min: number
  max: number
  step: number
}

export function configSidebarResizeBounds(scale: number): ConfigSidebarResizeBounds {
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  return {
    min: CONFIG_SIDEBAR_MIN_WIDTH * normalizedScale,
    max: CONFIG_SIDEBAR_MAX_WIDTH * normalizedScale,
    step: CONFIG_SIDEBAR_KEYBOARD_STEP * normalizedScale,
  }
}

export function clampConfigSidebarWidth(width: number, bounds: ConfigSidebarResizeBounds): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)))
}

export function nextConfigSidebarKeyboardWidth(
  width: number,
  key: string,
  bounds: ConfigSidebarResizeBounds,
): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return clampConfigSidebarWidth(width - bounds.step, bounds)
    case "ArrowRight":
      return clampConfigSidebarWidth(width + bounds.step, bounds)
    case "Home":
      return clampConfigSidebarWidth(bounds.min, bounds)
    case "End":
      return clampConfigSidebarWidth(bounds.max, bounds)
  }
  return undefined
}
