import { Coordinates } from "../src/opencorvus/gui/coordinates"
import { Capture } from "../src/opencorvus/perception/capture"

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

const rel = Coordinates.resolveDetailed(120, 80, {
  x: 100,
  y: 50,
  width: 500,
  height: 400,
})
assert(rel.x === 220 && rel.y === 130, `relative mapping failed: ${rel.x},${rel.y}`)
assert(!rel.clamped, "relative mapping should not clamp")

const clamped = Coordinates.resolveDetailed(999, -10, {
  x: 10,
  y: 20,
  width: 200,
  height: 100,
})
assert(clamped.x === 209 && clamped.y === 20, `clamp mapping failed: ${clamped.x},${clamped.y}`)
assert(clamped.clampedX && clamped.clampedY, "clamp flags should both be true")

const scaled = Capture.scaleWindowBounds({
  logicalX: 100,
  logicalY: 50,
  logicalWidth: 800,
  logicalHeight: 600,
  imageWidth: 1200,
  imageHeight: 900,
})
assert(scaled.x === 150 && scaled.y === 75, `scaled origin failed: ${scaled.x},${scaled.y}`)
assert((scaled.scaleX ?? 0) === 1.5 && (scaled.scaleY ?? 0) === 1.5, `scaled ratio failed: ${scaled.scaleX},${scaled.scaleY}`)

const fallback = Capture.scaleWindowBounds({
  logicalX: 40,
  logicalY: 30,
  logicalWidth: 0,
  logicalHeight: 0,
  imageWidth: 1000,
  imageHeight: 700,
})
assert((fallback.scaleX ?? 0) === 1000 && (fallback.scaleY ?? 0) === 700, `zero-size scaling fallback failed: ${fallback.scaleX},${fallback.scaleY}`)

console.log("gui-coordinate-smoke: ok")
