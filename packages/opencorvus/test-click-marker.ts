import { Window, Monitor } from "node-screenshots"
import { writeFileSync } from "fs"
import { addCoordinateOverlay, addClickMarker } from "./src/opencorvus/perception/overlay"

async function main() {
  const windows = Window.all()
  const settingsWin = windows.find(w => w.title().includes("Settings") || w.title().includes("设置"))

  if (!settingsWin) {
    console.log("Settings not found, using monitor capture")
    const m = Monitor.all()[0]
    const img = m.captureImageSync()
    let buf = Buffer.from(img.toPngSync())
    buf = await addCoordinateOverlay(buf)
    buf = await addClickMarker(buf, 1920, 1080, "click(1920,1080)")
    writeFileSync("D:/myhexin-local/argus-opencode/test-click-marker.png", buf)
    console.log("Saved test-click-marker.png with marker at center")
    return
  }

  const img = settingsWin.captureImageSync()
  let buf = Buffer.from(img.toPngSync())
  console.log(`Settings: ${img.width}x${img.height}`)

  // Add grid overlay first
  buf = await addCoordinateOverlay(buf)

  // Add click marker at resolution dropdown position
  buf = await addClickMarker(buf, 740, 900, "click(740,900)")

  writeFileSync("D:/myhexin-local/argus-opencode/test-click-marker.png", buf)
  console.log("Saved test-click-marker.png with marker at (740,900)")
}

main().catch(console.error)
