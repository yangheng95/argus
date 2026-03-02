import { Coordinates } from "../opencorvus/gui/coordinates"
import { Instance } from "../project/instance"

const desktopState = Instance.state((): { bounds: Coordinates.WindowBounds | null } => ({
  bounds: null,
}))

export namespace DesktopState {
  export function getBounds() { return desktopState().bounds }
  export function setBounds(b: Coordinates.WindowBounds | null) { desktopState().bounds = b }
}
