/**
 * One-shot helper: screenshot https://www.ainvest.com homepage and write it
 * to script/benchmark/assets/ainvest.png so the unattended benchmark default
 * case has a reference image for the visual-diff gate.
 *
 * Usage: bun run script/benchmark/capture-ainvest-reference.ts
 *
 * Reuses the puppeteer-core dependency already on the package + the Chromium
 * binary from puppeteer's Windows cache. If the cache isn't populated, run
 * `bunx puppeteer browsers install chrome@stable` first.
 */
import path from "node:path"
import fs from "node:fs/promises"
import puppeteer from "puppeteer-core"

const TARGET_URL = process.argv[2] ?? "https://www.ainvest.com"
const OUT = path.join(import.meta.dir, "assets", "ainvest.png")

function findCachedChrome(): string {
  const root = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".cache", "puppeteer", "chrome")
  return path.join(root, "win64-147.0.7727.57", "chrome-win64", "chrome.exe")
}

const executablePath = findCachedChrome()
console.log(`[capture-ainvest] launching ${executablePath}`)
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36",
  )
  console.log(`[capture-ainvest] navigating ${TARGET_URL}`)
  await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60_000 })
  // Wait for any post-hydration paint settle.
  await new Promise((r) => setTimeout(r, 2_500))
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await page.screenshot({ path: OUT, type: "png", fullPage: true })
  const stat = await fs.stat(OUT)
  console.log(`[capture-ainvest] wrote ${OUT} (${Math.round(stat.size / 1024)} KB)`)
} finally {
  await browser.close()
}
