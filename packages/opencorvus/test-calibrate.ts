/**
 * Coordinate calibration test.
 * Moves the mouse to a computed position in the Settings window,
 * then takes a screenshot to verify where the cursor actually landed.
 */
import { Window, Monitor } from "node-screenshots"
import { writeFileSync } from "fs"
import { addCoordinateOverlay } from "./src/opencorvus/perception/overlay"

// Simulate the Coordinates.toScreenDetailed logic
function translateCoords(
  relX: number,
  relY: number,
  bounds: {
    x: number       // physical origin
    y: number
    width: number    // physical dimensions (image)
    height: number
    logicalX: number
    logicalY: number
    logicalWidth: number
    logicalHeight: number
    scaleX: number
    scaleY: number
  }
): { screenX: number; screenY: number; logicalX: number; logicalY: number } {
  // Clamp to physical bounds
  const px = Math.max(0, Math.min(relX, bounds.width - 1))
  const py = Math.max(0, Math.min(relY, bounds.height - 1))
  // Convert to logical (divide by scale)
  const logX = Math.round(px / bounds.scaleX)
  const logY = Math.round(py / bounds.scaleY)
  // Clamp to logical window bounds
  const clampedLogX = Math.max(0, Math.min(logX, bounds.logicalWidth - 1))
  const clampedLogY = Math.max(0, Math.min(logY, bounds.logicalHeight - 1))
  // Map to screen-absolute logical coords
  return {
    screenX: bounds.logicalX + clampedLogX,
    screenY: bounds.logicalY + clampedLogY,
    logicalX: clampedLogX,
    logicalY: clampedLogY,
  }
}

async function main() {
  const windows = Window.all()
  const monitors = Monitor.all()

  console.log("=== Monitor Info ===")
  for (const m of monitors) {
    console.log(`  Monitor ${m.id()}: ${m.width()}x${m.height()} scale=${m.scaleFactor()} pos=(${m.x()},${m.y()})`)
  }

  console.log("\n=== Window Info ===")
  const settingsWin = windows.find(w => w.title().includes("Settings") || w.title().includes("设置"))

  if (!settingsWin) {
    console.log("Settings window not found! Open Settings first (Win+I)")
    // Show all windows
    for (const w of windows) {
      if (!w.isMinimized()) {
        console.log(`  id=${w.id()} title="${w.title()}" app="${w.appName()}" ${w.width()}x${w.height()} pos=(${w.x()},${w.y()}) focused=${w.isFocused()}`)
      }
    }
    return
  }

  const logicalX = settingsWin.x()
  const logicalY = settingsWin.y()
  const logicalWidth = settingsWin.width()
  const logicalHeight = settingsWin.height()

  // Capture window to get physical dimensions
  const img = settingsWin.captureImageSync()
  const physicalWidth = img.width
  const physicalHeight = img.height

  const scaleX = physicalWidth / logicalWidth
  const scaleY = physicalHeight / logicalHeight

  console.log(`  Settings Window:`)
  console.log(`    Logical: pos=(${logicalX},${logicalY}) size=${logicalWidth}x${logicalHeight}`)
  console.log(`    Physical (image): ${physicalWidth}x${physicalHeight}`)
  console.log(`    Scale: ${scaleX.toFixed(4)}x${scaleY.toFixed(4)}`)
  console.log(`    Focused: ${settingsWin.isFocused()}`)

  // Test several coordinate points
  const testPoints = [
    { name: "Top-left (100, 100)", physX: 100, physY: 100 },
    { name: "Center (~600, ~475)", physX: Math.round(physicalWidth / 2), physY: Math.round(physicalHeight / 2) },
    { name: "Resolution dropdown (~740, ~900)", physX: 740, physY: 900 },
    { name: "Bottom-right edge", physX: physicalWidth - 10, physY: physicalHeight - 10 },
  ]

  const bounds = {
    x: Math.round(logicalX * scaleX),
    y: Math.round(logicalY * scaleY),
    width: physicalWidth,
    height: physicalHeight,
    logicalX,
    logicalY,
    logicalWidth,
    logicalHeight,
    scaleX,
    scaleY,
  }

  console.log(`\n  WindowBounds stored in DesktopState:`)
  console.log(`    Physical origin: (${bounds.x}, ${bounds.y})`)
  console.log(`    Physical size: ${bounds.width}x${bounds.height}`)
  console.log(`    Logical origin: (${bounds.logicalX}, ${bounds.logicalY})`)
  console.log(`    Logical size: ${bounds.logicalWidth}x${bounds.logicalHeight}`)

  console.log("\n=== Coordinate Translation Test ===")
  for (const pt of testPoints) {
    const result = translateCoords(pt.physX, pt.physY, bounds)
    console.log(`\n  ${pt.name}:`)
    console.log(`    Physical input (from screenshot): (${pt.physX}, ${pt.physY})`)
    console.log(`    → Logical (divided by scale): (${Math.round(pt.physX / scaleX)}, ${Math.round(pt.physY / scaleY)})`)
    console.log(`    → Screen logical (+ window origin): (${result.screenX}, ${result.screenY})`)
    console.log(`    → If nut-js uses logical coords, mouse moves to: (${result.screenX}, ${result.screenY})`)
    console.log(`    → If nut-js uses physical coords, mouse should be at: (${Math.round(result.screenX * scaleX)}, ${Math.round(result.screenY * scaleY)})`)
  }

  // Now test what nut-js ACTUALLY does
  console.log("\n=== nut-js Coordinate Space Test ===")
  try {
    const nutPath = require.resolve("@nut-tree-fork/nut-js")
    const libnutPath = require.resolve("@nut-tree-fork/libnut", { paths: [require("path").dirname(nutPath)] })
    const libnut = require(libnutPath)

    // Get current mouse position
    const currentPos = libnut.getMousePos()
    console.log(`  Current mouse position (libnut): (${currentPos.x}, ${currentPos.y})`)

    // Move to a known screen position (center of monitor in logical coords)
    const monLogicalCenter = { x: Math.round(monitors[0].width() / 2), y: Math.round(monitors[0].height() / 2) }
    const monPhysicalCenter = { x: Math.round(monitors[0].width() * monitors[0].scaleFactor() / 2), y: Math.round(monitors[0].height() * monitors[0].scaleFactor() / 2) }

    console.log(`  Monitor logical center: (${monLogicalCenter.x}, ${monLogicalCenter.y})`)
    console.log(`  Monitor physical center: (${monPhysicalCenter.x}, ${monPhysicalCenter.y})`)

    // Move mouse to logical center
    console.log(`\n  Moving mouse to logical center (${monLogicalCenter.x}, ${monLogicalCenter.y})...`)
    libnut.moveMouse(monLogicalCenter.x, monLogicalCenter.y)

    // Wait a bit
    await new Promise(r => setTimeout(r, 200))

    // Read back position
    const afterLogical = libnut.getMousePos()
    console.log(`  After move to logical center, mouse is at: (${afterLogical.x}, ${afterLogical.y})`)

    // Now move to physical center
    console.log(`\n  Moving mouse to physical center (${monPhysicalCenter.x}, ${monPhysicalCenter.y})...`)
    libnut.moveMouse(monPhysicalCenter.x, monPhysicalCenter.y)
    await new Promise(r => setTimeout(r, 200))
    const afterPhysical = libnut.getMousePos()
    console.log(`  After move to physical center, mouse is at: (${afterPhysical.x}, ${afterPhysical.y})`)

    // Determine which coordinate space libnut uses
    console.log("\n  === CONCLUSION ===")
    console.log(`  If libnut uses LOGICAL coords:`)
    console.log(`    moveMouse(${monLogicalCenter.x}, ${monLogicalCenter.y}) should land at visual center`)
    console.log(`    moveMouse(${monPhysicalCenter.x}, ${monPhysicalCenter.y}) would overshoot`)
    console.log(`  If libnut uses PHYSICAL coords:`)
    console.log(`    moveMouse(${monLogicalCenter.x}, ${monLogicalCenter.y}) would undershoot`)
    console.log(`    moveMouse(${monPhysicalCenter.x}, ${monPhysicalCenter.y}) should land at visual center`)

    // Move to Settings window resolution dropdown area
    console.log("\n=== Settings Window Click Test ===")
    const dropdownPhys = { x: 740, y: 900 }
    const translated = translateCoords(dropdownPhys.x, dropdownPhys.y, bounds)
    console.log(`  Resolution dropdown in screenshot: (${dropdownPhys.x}, ${dropdownPhys.y}) physical`)
    console.log(`  Translated to screen logical: (${translated.screenX}, ${translated.screenY})`)

    // Move mouse there
    console.log(`  Moving mouse to (${translated.screenX}, ${translated.screenY})...`)
    libnut.moveMouse(translated.screenX, translated.screenY)
    await new Promise(r => setTimeout(r, 500))

    // Capture screenshot to see where cursor is
    const afterMove = libnut.getMousePos()
    console.log(`  Mouse position after move: (${afterMove.x}, ${afterMove.y})`)

    // Take fullscreen screenshot to see cursor position
    const primary = monitors[0]
    const screenImg = primary.captureImageSync()
    const screenPng = screenImg.toPngSync()
    const overlaid = await addCoordinateOverlay(Buffer.from(screenPng))
    writeFileSync("D:/myhexin-local/argus-opencode/test-calibrate-result.png", overlaid)
    console.log(`  Screenshot saved to test-calibrate-result.png`)
    console.log(`  Check if cursor is on the resolution dropdown!`)

  } catch (err) {
    console.error("  nut-js test failed:", err)
  }
}

main().catch(console.error)
