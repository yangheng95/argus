import { Coordinates } from "../opencorvus/gui/coordinates"
import { Instance } from "../project/instance"

export interface AnchorTarget {
  scope: "window" | "monitor"
  windowId?: number
  monitorId?: number
  title?: string
  name?: string
}

export type AnchorPhase = "idle" | "window_bound" | "monitor_bound" | "window_anchored" | "monitor_anchored"

interface State {
  bounds: Coordinates.WindowBounds | null
  target: AnchorTarget | null
  phase: AnchorPhase
  taskEpoch: number
  anchorHash: string | null
  updatedAt: number
}

function phase(target: AnchorTarget | null, bounds: Coordinates.WindowBounds | null): AnchorPhase {
  if (!target) return "idle"
  if (target.scope === "window") return bounds ? "window_anchored" : "window_bound"
  return bounds ? "monitor_anchored" : "monitor_bound"
}

function touch(s: State) {
  s.updatedAt = Date.now()
}

const desktopState = Instance.state(
  (): State => ({
    bounds: null,
    target: null,
    phase: "idle",
    taskEpoch: 0,
    anchorHash: null,
    updatedAt: Date.now(),
  }),
)

export namespace DesktopState {
  export function getBounds() {
    return desktopState().bounds
  }
  export function getTarget() {
    return desktopState().target
  }
  export function getPhase() {
    return desktopState().phase
  }
  export function getTaskEpoch() {
    return desktopState().taskEpoch
  }
  export function getAnchorHash() {
    return desktopState().anchorHash
  }
  export function snapshot() {
    const s = desktopState()
    return {
      bounds: s.bounds,
      target: s.target,
      phase: s.phase,
      taskEpoch: s.taskEpoch,
      anchorHash: s.anchorHash,
      updatedAt: s.updatedAt,
    }
  }
  export function markTask(taskEpoch: number) {
    const s = desktopState()
    if (taskEpoch < 0 || s.taskEpoch === taskEpoch) return false
    s.taskEpoch = taskEpoch
    s.bounds = null
    s.anchorHash = null
    s.phase = phase(s.target, s.bounds)
    touch(s)
    return true
  }
  export function bindWindow(windowId: number, title?: string) {
    const s = desktopState()
    s.target = { scope: "window", windowId, title }
    s.bounds = null
    s.anchorHash = null
    s.phase = "window_bound"
    touch(s)
  }
  export function bindMonitor(monitorId: number, name?: string) {
    const s = desktopState()
    s.target = { scope: "monitor", monitorId, name }
    s.bounds = null
    s.anchorHash = null
    s.phase = "monitor_bound"
    touch(s)
  }
  export function recordCapture(input: {
    scope: "window" | "monitor"
    bounds: Coordinates.WindowBounds | null
    window?: { windowId: number; title?: string } | null
    monitor?: { id: number; name?: string } | null
    screenshotHash?: string | null
  }) {
    if (input.scope === "window" && !input.window) {
      throw new Error("DesktopState.recordCapture(scope=window) requires window metadata")
    }
    if (input.scope === "monitor" && !input.monitor) {
      throw new Error("DesktopState.recordCapture(scope=monitor) requires monitor metadata")
    }
    const s = desktopState()
    s.bounds = input.bounds
    if (input.scope === "window") {
      const window = input.window
      s.target = window
        ? {
            scope: "window",
            windowId: window.windowId,
            title: window.title,
          }
        : null
    } else {
      s.target = input.monitor
        ? {
            scope: "monitor",
            monitorId: input.monitor.id,
            name: input.monitor.name,
          }
        : null
    }
    s.anchorHash = input.screenshotHash ?? null
    s.phase = phase(s.target, s.bounds)
    touch(s)
  }
}
