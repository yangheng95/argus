import { Window, Monitor } from "node-screenshots"
import { addCoordinateOverlay } from "./src/opencorvus/perception/overlay"
import { writeFileSync } from "fs"

async function main() {
  // List all windows
  const windows = Window.all()
  console.log("=== All windows ===")
  for (const w of windows) {
    if (w.isMinimized()) continue
    console.log(`  id=${w.id()} title="${w.title()}" app="${w.appName()}" ${w.width()}x${w.height()} focused=${w.isFocused()}`)
  }

  // Take fullscreen (monitor) capture
  const monitors = Monitor.all()
  console.log(`\n=== Monitors (${monitors.length}) ===`)
  for (const m of monitors) {
    console.log(`  id=${m.id()} ${m.width()}x${m.height()} scale=${m.scaleFactor()}`)
  }

  const primary = monitors[0]
  const img = primary.captureImageSync()
  const pngBuffer = img.toPngSync()
  console.log(`\nCaptured monitor: ${primary.width()}x${primary.height()}, buffer size: ${pngBuffer.length}`)

  // Apply coordinate overlay
  const overlaid = await addCoordinateOverlay(Buffer.from(pngBuffer))

  // Save to file
  const outPath = "D:/myhexin-local/argus-opencode/test-screenshot-overlay.png"
  writeFileSync(outPath, overlaid)
  console.log(`Saved to: ${outPath} (${overlaid.length} bytes)`)

  // Also capture the focused window separately
  const focusedWin = windows.find(w => w.isFocused())
  if (focusedWin) {
    console.log(`\nFocused window: id=${focusedWin.id()} title="${focusedWin.title()}" ${focusedWin.width()}x${focusedWin.height()}`)
    const fImg = focusedWin.captureImageSync()
    const fPng = fImg.toPngSync()
    const fOverlaid = await addCoordinateOverlay(Buffer.from(fPng))
    const fOutPath = "D:/myhexin-local/argus-opencode/test-screenshot-focused-overlay.png"
    writeFileSync(fOutPath, fOverlaid)
    console.log(`Saved focused window to: ${fOutPath}`)
  }

  // Also try window capture for Settings if open
  for (const w of windows) {
    if (w.title().includes("设置") || w.title().includes("Settings")) {
      console.log(`\nFound Settings window: id=${w.id()} ${w.width()}x${w.height()}`)
      const wImg = w.captureImageSync()
      const wPng = wImg.toPngSync()
      const wOverlaid = await addCoordinateOverlay(Buffer.from(wPng))
      const wOutPath = "D:/myhexin-local/argus-opencode/test-screenshot-settings-overlay.png"
      writeFileSync(wOutPath, wOverlaid)
      console.log(`Saved settings window to: ${wOutPath}`)
    }
  }
}

main().catch(console.error)
