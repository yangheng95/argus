/**
 * Quick test: open Settings, move cursor to resolution dropdown, screenshot to verify.
 */
import { Window, Monitor } from "node-screenshots"
import { writeFileSync } from "fs"
import { addCoordinateOverlay } from "./src/opencorvus/perception/overlay"
import { mouse, Point, keyboard, Key } from "@nut-tree-fork/nut-js"

async function main() {
  // Open Settings
  console.log("Opening Settings (Win+I)...")
  await keyboard.pressKey(Key.LeftSuper, Key.I)
  await keyboard.releaseKey(Key.LeftSuper, Key.I)
  await new Promise((r) => setTimeout(r, 2000))

  const windows = Window.all()
  const settingsWin = windows.find((w) => w.title().includes("Settings") || w.title().includes("设置"))
  if (!settingsWin) {
    console.log("Settings not found!")
    for (const w of windows) {
      if (!w.isMinimized()) console.log(`  ${w.id()} "${w.title()}" (${w.appName()})`)
    }
    return
  }

  const wLogX = settingsWin.x()
  const wLogY = settingsWin.y()
  const wLogW = settingsWin.width()
  const wLogH = settingsWin.height()
  const wImg = settingsWin.captureImageSync()
  const wPhysW = wImg.width
  const wPhysH = wImg.height
  const wScaleX = wPhysW / wLogW
  const wScaleY = wPhysH / wLogH

  console.log(
    `Settings: logical(${wLogX},${wLogY}) ${wLogW}x${wLogH}, physical ${wPhysW}x${wPhysH}, scale ${wScaleX.toFixed(3)}x${wScaleY.toFixed(3)}`,
  )

  // Save Settings screenshot with overlay first
  const settingsOverlay = await addCoordinateOverlay(Buffer.from(wImg.toPngSync()))
  writeFileSync("D:/myhexin-local/argus-opencode/test-cal-settings.png", settingsOverlay)
  console.log("Saved test-cal-settings.png")

  // Test clicking on "Display resolution" dropdown
  // From our earlier screenshot: the dropdown is at approximately (740, 900) in physical pixels
  const targets = [
    { name: "System menu (left nav)", px: 150, py: 305 },
    { name: "Window center", px: Math.round(wPhysW / 2), py: Math.round(wPhysH / 2) },
    { name: "Resolution dropdown", px: 740, py: 900 },
  ]

  for (const t of targets) {
    const relLogX = Math.round(t.px / wScaleX)
    const relLogY = Math.round(t.py / wScaleY)
    const screenLogX = wLogX + Math.min(relLogX, wLogW - 1)
    const screenLogY = wLogY + Math.min(relLogY, wLogH - 1)

    console.log(`\n  ${t.name}: phys(${t.px},${t.py}) → screenLog(${screenLogX},${screenLogY})`)
    await mouse.setPosition(new Point(screenLogX, screenLogY))
    await new Promise((r) => setTimeout(r, 800))

    // Take fullscreen screenshot to see cursor position
    const m = Monitor.all()[0]
    const img = m.captureImageSync()
    const overlaid = await addCoordinateOverlay(Buffer.from(img.toPngSync()))
    const fname = `test-cal-target-${t.name.replace(/[^a-zA-Z]/g, "-")}.png`
    writeFileSync(`D:/myhexin-local/argus-opencode/${fname}`, overlaid)
    console.log(`  Saved ${fname}`)
  }

  console.log("\nDone! Check the screenshots to verify cursor positions.")
}

main().catch(console.error)
