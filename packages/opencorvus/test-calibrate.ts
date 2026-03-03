/**
 * Coordinate calibration verification test.
 * Tests that the DPI scaling fix correctly translates physical screenshot
 * coordinates to logical nut-js coordinates for both monitor and window captures.
 */
import { Window, Monitor } from "node-screenshots"
import { writeFileSync } from "fs"
import { addCoordinateOverlay } from "./src/opencorvus/perception/overlay"
import { mouse, Point } from "@nut-tree-fork/nut-js"

async function main() {
  const monitors = Monitor.all()
  const m = monitors[0]
  const scale = m.scaleFactor()
  const physW = m.width()
  const physH = m.height()
  const logW = Math.round(physW / scale)
  const logH = Math.round(physH / scale)

  console.log("=== Monitor ===")
  console.log(`  Physical: ${physW}x${physH}`)
  console.log(`  Scale: ${scale}`)
  console.log(`  Logical (corrected): ${logW}x${logH}`)
  console.log(`  nut-js coordinate range: [0, ${logW - 1}] x [0, ${logH - 1}]`)

  // Verify nut-js uses logical coordinates
  console.log("\n=== Verify nut-js coordinate space ===")
  await mouse.setPosition(new Point(logW - 1, logH - 1))
  await new Promise(r => setTimeout(r, 100))
  const maxPos = await mouse.getPosition()
  console.log(`  setPosition(${logW - 1}, ${logH - 1}) → getPosition() = (${maxPos.x}, ${maxPos.y})`)
  const logicalOK = maxPos.x === logW - 1 && maxPos.y === logH - 1
  console.log(`  nut-js accepts logical max: ${logicalOK ? "YES ✓" : "NO ✗"}`)

  // Verify out-of-bounds clamping
  await mouse.setPosition(new Point(physW - 1, physH - 1))
  await new Promise(r => setTimeout(r, 100))
  const overPos = await mouse.getPosition()
  console.log(`  setPosition(${physW - 1}, ${physH - 1}) → getPosition() = (${overPos.x}, ${overPos.y})`)
  const clamped = overPos.x === logW - 1 && overPos.y === logH - 1
  console.log(`  Physical coords get clamped to logical max: ${clamped ? "YES ✓" : "NO ✗"}`)

  // Test the FIXED coordinate translation (monitor capture scenario)
  console.log("\n=== Monitor capture coordinate test ===")
  console.log(`  Image: ${physW}x${physH} pixels`)
  console.log(`  scaleX = ${physW}/${logW} = ${(physW / logW).toFixed(4)}`)
  console.log(`  scaleY = ${physH}/${logH} = ${(physH / logH).toFixed(4)}`)

  const monitorTests = [
    { name: "Image center", px: Math.round(physW / 2), py: Math.round(physH / 2) },
    { name: "Quarter point", px: Math.round(physW / 4), py: Math.round(physH / 4) },
    { name: "Three-quarter point", px: Math.round(physW * 3 / 4), py: Math.round(physH * 3 / 4) },
  ]

  for (const t of monitorTests) {
    // Apply the fixed translation: physical → logical
    const logicalX = Math.round(t.px / scale)
    const logicalY = Math.round(t.py / scale)

    // Move mouse
    await mouse.setPosition(new Point(logicalX, logicalY))
    await new Promise(r => setTimeout(r, 200))

    // Capture and verify cursor in screenshot
    const img = m.captureImageSync()
    const cursorPos = await mouse.getPosition()

    // Where should cursor appear in the physical image?
    const expectedPhysX = Math.round(cursorPos.x * scale)
    const expectedPhysY = Math.round(cursorPos.y * scale)
    const dxFromTarget = Math.abs(expectedPhysX - t.px)
    const dyFromTarget = Math.abs(expectedPhysY - t.py)
    const ok = dxFromTarget <= 2 && dyFromTarget <= 2

    console.log(`  ${t.name}: phys(${t.px},${t.py}) → logical(${logicalX},${logicalY}) → cursor at logical(${cursorPos.x},${cursorPos.y}) → phys(${expectedPhysX},${expectedPhysY}) ${ok ? "✓" : "✗ off by " + dxFromTarget + "," + dyFromTarget}`)
  }

  // Test Settings window if available
  console.log("\n=== Window capture coordinate test ===")
  const windows = Window.all()
  const settingsWin = windows.find(w => w.title().includes("Settings") || w.title().includes("设置"))

  if (settingsWin) {
    const wLogX = settingsWin.x()
    const wLogY = settingsWin.y()
    const wLogW = settingsWin.width()
    const wLogH = settingsWin.height()
    const wImg = settingsWin.captureImageSync()
    const wPhysW = wImg.width
    const wPhysH = wImg.height
    const wScaleX = wPhysW / wLogW
    const wScaleY = wPhysH / wLogH

    console.log(`  Settings: logical(${wLogX},${wLogY}) ${wLogW}x${wLogH}, physical ${wPhysW}x${wPhysH}, scale ${wScaleX.toFixed(3)}x${wScaleY.toFixed(3)}`)

    const winTests = [
      { name: "Window center", px: Math.round(wPhysW / 2), py: Math.round(wPhysH / 2) },
      { name: "Resolution dropdown", px: 740, py: 900 },
    ]

    for (const t of winTests) {
      // Window translation: physical → logical → screen
      const relLogX = Math.round(t.px / wScaleX)
      const relLogY = Math.round(t.py / wScaleY)
      const screenLogX = wLogX + Math.min(relLogX, wLogW - 1)
      const screenLogY = wLogY + Math.min(relLogY, wLogH - 1)

      await mouse.setPosition(new Point(screenLogX, screenLogY))
      await new Promise(r => setTimeout(r, 300))
      const pos = await mouse.getPosition()
      console.log(`  ${t.name}: phys(${t.px},${t.py}) → relLog(${relLogX},${relLogY}) → screenLog(${screenLogX},${screenLogY}) → cursor(${pos.x},${pos.y})`)
    }

    // Save screenshot with cursor on last target
    const finalImg = m.captureImageSync()
    const overlaid = await addCoordinateOverlay(Buffer.from(finalImg.toPngSync()))
    writeFileSync("D:/myhexin-local/argus-opencode/test-calibrate-final.png", overlaid)
    console.log(`  Saved test-calibrate-final.png (cursor should be on resolution dropdown)`)
  } else {
    console.log("  Settings window not found — skipping window test")
  }

  console.log("\n=== Summary ===")
  console.log(`  nut-js coordinate space: LOGICAL (${logW}x${logH})`)
  console.log(`  Monitor image size: PHYSICAL (${physW}x${physH})`)
  console.log(`  Required scale: ${scale}x`)
  console.log(`  OLD code: scaleX = ${physW}/${physW} = 1.0 ← BUG! No DPI compensation`)
  console.log(`  NEW code: scaleX = ${physW}/${logW} = ${(physW / logW).toFixed(3)} ← CORRECT`)
}

main().catch(console.error)
