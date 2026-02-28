import { Coordinates } from "../argus/gui/coordinates"

export namespace DesktopState {
  let bounds: Coordinates.WindowBounds | null = null
  export function getBounds() { return bounds }
  export function setBounds(b: Coordinates.WindowBounds | null) { bounds = b }
}
