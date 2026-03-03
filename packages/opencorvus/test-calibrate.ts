/**
 * Coordinate calibration test.
 * Verifies that nut-js coordinate space matches our translation logic.
 */
import { Window, Monitor } from "node-screenshots"
import { writeFileSync } from "fs"
import { addCoordinateOverlay } from "./src/opencorvus/perception/overlay"
import { mouse, Point } from "@nut-tree-fork/nut-js"

function translateCoords(
  relX: number,
  relY: number,
  bounds: {
    logicalX: number
    logicalY: number
    logicalWidth: number
    logicalHeight: number
    scaleX: number
    scaleY: number
    width: number   // physical
    height: number  // physical
  }
): { screenX: number; screenY: number } {
  const px = Math.max(0, Math.min(relX, bounds.width - 1))
  const py = Math.max(0, Math.min(relY, bounds.height - 1))
  const logX = Math.max(0, Math.min(Math.round(px / bounds.scaleX), bounds.logicalWidth - 1))
  const logY = Math.max(0, Math.min(Math.round(py / bounds.scaleY), bounds.logicalHeight - 1))
  return {
    screenX: bounds.logicalX + logX,
    screenY: bounds.logicalY + logY,
  }
}

async function main() {
  const monitors = Monitor.all()
  const m = monitors[0]
  console.log(`Monitor: ${m.width()}x${m.height()} scale=${m.scaleFactor()} physical=${m.width() * m.scaleFactor()}x${m.height() * m.scaleFactor()}`)

  // Step 1: Determine nut-js coordinate space
  console.log("\n=== Step 1: Determine nut-js coordinate space ===")

  // Get current position
  const curPos = await mouse.getPosition()
  console.log(`Current mouse: (${curPos.x}, ${curPos.y})`)

  // Move to monitor logical center
  const logCenter = { x: Math.round(m.width() / 2), y: Math.round(m.height() / 2) }
  console.log(`Moving to logical center: (${logCenter.x}, ${logCenter.y})`)
  await mouse.setPosition(new Point(logCenter.x, logCenter.y))
  await new Promise(r => setTimeout(r, 300))

  // Capture fullscreen and check cursor position visually
  let img = m.captureImageSync()
  let overlaid = await addCoordinateOverlay(Buffer.from(img.toPngSync()))
  writeFileSync("D:/myhexin-local/argus-opencode/test-cal-1-logical-center.png", overlaid)
  console.log(`Saved test-cal-1-logical-center.png (cursor should be at visual center of screen)`)

  // Read back position
  const afterLogical = await mouse.getPosition()
  console.log(`After move, mouse reports: (${afterLogical.x}, ${afterLogical.y})`)

  // Move to physical center
  const physCenter = { x: Math.round(m.width() * m.scaleFactor() / 2), y: Math.round(m.height() * m.scaleFactor() / 2) }
  console.log(`\nMoving to physical center: (${physCenter.x}, ${physCenter.y})`)
  await mouse.setPosition(new Point(physCenter.x, physCenter.y))
  await new Promise(r => setTimeout(r, 300))

  img = m.captureImageSync()
  overlaid = await addCoordinateOverlay(Buffer.from(img.toPngSync()))
  writeFileSync("D:/myhexin-local/argus-opencode/test-cal-2-physical-center.png", overlaid)
  console.log(`Saved test-cal-2-physical-center.png`)

  const afterPhysical = await mouse.getPosition()
  console.log(`After move, mouse reports: (${afterPhysical.x}, ${afterPhysical.y})`)

  // Conclusion
  console.log("\n=== Conclusion ===")
  console.log(`Logical center = (${logCenter.x}, ${logCenter.y})`)
  console.log(`Physical center = (${physCenter.x}, ${physCenter.y})`)
  console.log(`After moving to logical center, nut-js reports: (${afterLogical.x}, ${afterLogical.y})`)
  console.log(`After moving to physical center, nut-js reports: (${afterPhysical.x}, ${afterPhysical.y})`)
  if (afterLogical.x === logCenter.x && afterLogical.y === logCenter.y) {
    console.log("→ nut-js USES and REPORTS logical coordinates")
  } else if (afterLogical.x === physCenter.x && afterLogical.y === physCenter.y) {
    console.log("→ nut-js RESCALES logical input to physical — coordinate space is PHYSICAL")
  } else {
    console.log("→ Ambiguous — check screenshots manually")
  }

  // Step 2: Test Settings window click
  console.log("\n=== Step 2: Test Settings window click target ===")
  const windows = Window.all()
  const settingsWin = windows.find(w => w.title().includes("Settings") || w.title().includes("设置"))
  if (!settingsWin) {
    console.log("Settings window not found!")
    return
  }

  const logX = settingsWin.x()
  const logY = settingsWin.y()
  const logW = settingsWin.width()
  const logH = settingsWin.height()
  const sImg = settingsWin.captureImageSync()
  const physW = sImg.width
  const physH = sImg.height
  const scaleX = physW / logW
  const scaleY = physH / logH

  console.log(`Settings: logical=(${logX},${logY}) ${logW}x${logH}, physical=${physW}x${physH}, scale=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`)

  // Target: "Display resolution" dropdown at ~(740, 900) in screenshot physical pixels
  const targets = [
    { name: "Resolution dropdown", physX: 740, physY: 900 },
    { name: "Scale dropdown", physX: 710, physY: 732 },
    { name: "System menu item", physX: 150, physY: 305 },
  ]

  for (const t of targets) {
    const translated = translateCoords(t.physX, t.physY, {
      logicalX: logX,
      logicalY: logY,
      logicalWidth: logW,
      logicalHeight: logH,
      scaleX,
      scaleY,
      width: physW,
      height: physH,
    })
    console.log(`  ${t.name}: phys=(${t.physX},${t.physY}) → screen logical=(${translated.screenX},${translated.screenY})`)

    // Move mouse there
    await mouse.setPosition(new Point(translated.screenX, translated.screenY))
    await new Promise(r => setTimeout(r, 500))

    // Capture
    const readBack = await mouse.getPosition()
    console.log(`    Mouse at: (${readBack.x}, ${readBack.y})`)
  }

  // Final screenshot showing cursor position
  img = m.captureImageSync()
  overlaid = await addCoordinateOverlay(Buffer.from(img.toPngSync()))
  writeFileSync("D:/myhexin-local/argus-opencode/test-cal-3-final.png", overlaid)
  console.log(`\nSaved test-cal-3-final.png (cursor should be on last target)`)
}

main().catch(console.error)
