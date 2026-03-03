import { Coordinates } from "../opencorvus/gui/coordinates"
import { Instance } from "../project/instance"

export interface AnchorTarget {
  scope: "window" | "monitor"
  windowId?: number
  monitorId?: number
  title?: string
  name?: string
}

export interface LastClickInfo {
  /** Physical pixel X within the captured image (same coordinate space as screenshot) */
  imageX: number
  /** Physical pixel Y within the captured image */
  imageY: number
  /** Action label (e.g. "click", "double_click") */
  action: string
  /** Timestamp of the click */
  time: number
}

const desktopState = Instance.state((): {
  bounds: Coordinates.WindowBounds | null
  target: AnchorTarget | null
  lastClick: LastClickInfo | null
} => ({
  bounds: null,
  target: null,
  lastClick: null,
}))

export namespace DesktopState {
  export function getBounds() { return desktopState().bounds }
  export function setBounds(b: Coordinates.WindowBounds | null) { desktopState().bounds = b }
  export function getTarget() { return desktopState().target }
  export function setTarget(target: AnchorTarget | null) { desktopState().target = target }
  export function setLastClick(click: LastClickInfo | null) { desktopState().lastClick = click }
  export function consumeLastClick(): LastClickInfo | null {
    const s = desktopState()
    const click = s.lastClick
    s.lastClick = null
    return click
  }
}
