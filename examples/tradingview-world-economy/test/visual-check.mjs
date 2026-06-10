import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "../../../packages/overlay/node_modules/playwright/index.mjs"

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const screenshotsDir = resolve(artifactRoot, "screenshots")
const port = 4197
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe"

await mkdir(screenshotsDir, { recursive: true })

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: artifactRoot,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
})

const serverReady = new Promise((resolveReady, rejectReady) => {
  const timer = setTimeout(() => rejectReady(new Error("Static server did not start")), 8000)
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes(`http://127.0.0.1:${port}`)) {
      clearTimeout(timer)
      resolveReady()
    }
  })
  server.stderr.on("data", (chunk) => rejectReady(new Error(chunk.toString())))
})

try {
  await serverReady
  const browser = await chromium.launch({ headless: true, executablePath: chromePath })
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1400 },
    { name: "mobile", width: 390, height: 1200 },
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    const consoleErrors = []
    const pageErrors = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" })
    await page.screenshot({ path: resolve(screenshotsDir, `${viewport.name}.png`), fullPage: false })

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector)
        if (!node) throw new Error(`Missing selector ${selector}`)
        const box = node.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }
      return {
        header: rect(".site-header"),
        hero: rect(".hero"),
        trendGrid: rect(".trend-grid"),
        mapCard: rect(".map-card"),
        gdpCard: rect(".gdp-card"),
        indicatorGrid: rect(".indicator-grid"),
        countries: rect(".countries-section"),
      }
    })

    assert.equal(consoleErrors.length, 0, `Console errors in ${viewport.name}: ${consoleErrors.join("\\n")}`)
    assert.equal(pageErrors.length, 0, `Page errors in ${viewport.name}: ${pageErrors.join("\\n")}`)
    assert.equal(Math.round(layout.header.height), 64)
    assert.ok(layout.mapCard.height > 250, `${viewport.name} map card should be substantial`)
    assert.ok(layout.gdpCard.height > 250, `${viewport.name} GDP card should be substantial`)
    assert.ok(layout.countries.y > layout.indicatorGrid.y, `${viewport.name} countries should follow indicators`)

    if (viewport.name === "desktop") {
      assert.ok(layout.trendGrid.width > 1300, "Desktop trend grid should span the content width")
      assert.ok(layout.gdpCard.x > layout.mapCard.x + layout.mapCard.width, "Desktop GDP card should sit right of the map")
    }

    if (viewport.name === "mobile") {
      assert.ok(layout.gdpCard.y > layout.mapCard.y + layout.mapCard.height, "Mobile GDP card should stack below the map")
      assert.ok(layout.trendGrid.width < 370, "Mobile trend grid should fit the narrow viewport")
    }
    await page.close()
  }
  await browser.close()
  console.log(`visual-check passed; screenshots: ${screenshotsDir}`)
} finally {
  server.kill()
}
