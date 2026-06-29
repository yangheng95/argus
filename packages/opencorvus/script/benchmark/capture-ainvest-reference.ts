/**
 * One-shot helper: screenshot https://www.ainvest.com homepage and write it
 * to script/benchmark/assets/ainvest.png so the unattended benchmark default
 * case has a reference image for the visual-diff check.
 *
 * Usage: bun run script/benchmark/capture-ainvest-reference.ts
 *
 * Uses the shared Node-sidecar browser launcher.
 */
import path from "node:path"
import fs from "node:fs/promises"
import { launchBrowser } from "../../../overlay/test/launch"
import { gotoWithBrowserInactivity } from "./browser-inactivity"

const TARGET_URL = process.argv[2] ?? "https://www.ainvest.com"
const OUT = path.join(import.meta.dir, "assets", "ainvest.png")

const browser = await launchBrowser(["--no-sandbox", "--disable-setuid-sandbox"], { headless: false })
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  console.log(`[capture-ainvest] navigating ${TARGET_URL}`)
  await gotoWithBrowserInactivity(page, TARGET_URL, "networkidle", 60_000)
  // Wait for any post-hydration paint settle.
  await new Promise((r) => setTimeout(r, 2_500))
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await page.screenshot({ path: OUT, type: "png", fullPage: true })
  const stat = await fs.stat(OUT)
  console.log(`[capture-ainvest] wrote ${OUT} (${Math.round(stat.size / 1024)} KB)`)
} finally {
  await browser.close()
}
