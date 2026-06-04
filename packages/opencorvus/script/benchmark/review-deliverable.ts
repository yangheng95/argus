/**
 * Rule-7 self-review helper for the overlay-web-benchmark deliverable.
 *
 * Boots an isolated Playwright browser, screenshots `http://localhost:3000`
 * (the running Vite dev), and writes the result to
 * `<deliverable>/review-rendered.png`. Returns a summary string the
 * operator can compare side-by-side with whatever reference image the
 * caller chose (or just sanity-check the rendered output on its own).
 */
import path from "node:path"
import fs from "node:fs/promises"
import { launchBrowser } from "../../../overlay/test/launch"

const TARGET = process.argv[2] ?? "http://localhost:3000"
const OUT_DIR = process.argv[3]
  ?? "C:/Users/hengu/AppData/Local/Temp/opencorvus-overlay-benchmark-project-w5RoTK"
const OUT = path.join(OUT_DIR, "review-rendered.png")

const browser = await launchBrowser(["--no-sandbox", "--disable-setuid-sandbox"])
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  console.log(`[review] navigating ${TARGET}`)
  const resp = await page.goto(TARGET, { waitUntil: "networkidle", timeout: 60_000 })
  console.log(`[review] HTTP ${resp?.status() ?? "?"}`)
  await new Promise((r) => setTimeout(r, 3_000))
  await page.screenshot({ path: OUT, type: "png", fullPage: true })
  const stat = await fs.stat(OUT)
  console.log(`[review] wrote ${OUT} (${Math.round(stat.size / 1024)} KB)`)

  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`) })
  await new Promise((r) => setTimeout(r, 1_500))
  if (errors.length > 0) console.log(`[review] ${errors.length} runtime error(s):\n${errors.slice(0, 10).join("\n")}`)
  else console.log(`[review] no runtime errors`)
} finally {
  await browser.close()
}
