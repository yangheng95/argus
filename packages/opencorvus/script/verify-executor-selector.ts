#!/usr/bin/env bun
/**
 * Headless verification that ExecutorSelector renders + opens its menu.
 * Spins up vite preview, opens the page in Playwright, asserts the chip
 * is in the DOM with non-empty label, clicks it, and asserts the menu
 * appears with at least one row.
 *
 * Usage:
 *   bun run script/verify-executor-selector.ts [url]
 *
 * Default url: http://localhost:5173/
 */

import { launchBrowser } from "../../overlay/test/launch"
import path from "node:path"

const url = process.argv[2] ?? "http://localhost:5173/"
const screenshotPath = path.resolve(process.cwd(), "executor-selector-verify.png")

const browser = await launchBrowser(["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])

let exitCode = 0
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })

  page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`[console.error] ${msg.text()}`)
  })

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
  await new Promise((r) => setTimeout(r, 3000))

  const chip = await page.$(".executor-selector .executor-chip")
  if (!chip) {
    console.error("FAIL: .executor-selector .executor-chip not found in DOM")
    exitCode = 1
  } else {
    const label = await page.$eval(".executor-chip-label", (el) => el.textContent?.trim() ?? "")
    console.log(`chip label: ${JSON.stringify(label)}`)
    if (!label) {
      console.error("FAIL: .executor-chip-label has empty text")
      exitCode = 1
    }

    // Composer sits at the bottom — scroll the chip into view first.
    // Use JS click instead of Playwright's geometric click so the chip
    // doesn't have to be hit-tested at exact viewport coords.
    await page.$eval(".executor-chip", (el) => {
      ;(el as HTMLElement).scrollIntoView({ block: "center" })
      ;(el as HTMLElement).click()
    })
    await new Promise((r) => setTimeout(r, 300))

    const menu = await page.$(".executor-selector .executor-menu")
    if (!menu) {
      console.error("FAIL: clicking the chip did not open .executor-menu")
      exitCode = 1
    } else {
      const rows = await page.$$eval(".executor-menu .executor-menu-row", (els) =>
        els.map((el) => (el.textContent ?? "").trim()),
      )
      console.log(`menu rows (${rows.length}):`)
      for (const row of rows) console.log(`  - ${row}`)
      if (rows.length === 0) {
        console.error("FAIL: .executor-menu opened but contains zero rows")
        exitCode = 1
      }
    }
  }

  await page.screenshot({ path: screenshotPath as `${string}.png`, fullPage: false })
  console.log(`screenshot → ${screenshotPath}`)

  if (exitCode === 0) console.log("PASS: ExecutorSelector renders and opens with rows")
} finally {
  await browser.close()
}
process.exit(exitCode)
