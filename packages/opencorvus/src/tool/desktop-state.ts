import { Coordinates } from "../opencorvus/gui/coordinates"
import { Instance } from "../project/instance"

export interface AnchorTarget {
  scope: "window" | "monitor"
  windowId?: number
  monitorId?: number
  title?: string
  name?: string
}

const desktopState = Instance.state((): { bounds: Coordinates.WindowBounds | null; target: AnchorTarget | null } => ({
  bounds: null,
  target: null,
}))

export namespace DesktopState {
  export function getBounds() { return desktopState().bounds }
  export function setBounds(b: Coordinates.WindowBounds | null) { desktopState().bounds = b }
  export function getTarget() { return desktopState().target }
  export function setTarget(target: AnchorTarget | null) { desktopState().target = target }
}
