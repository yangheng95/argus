#!/usr/bin/env bun
/**
 * Quick puppeteer screenshot helper for the overlay UI.
 *
 * Usage:
 *   bun run script/screenshot.ts <out.png> [url] [w] [h]
 *
 * Defaults: url=http://localhost:5173/, viewport=1280x800.
 * Requires Chrome / Edge installed (auto-detected).
 */

import { findBrowserExecutable } from "../../opencorvus/src/acceptance/checks/visual"
import puppeteer from "puppeteer-core"
import path from "node:path"

const out = process.argv[2]
if (!out) {
  console.error("usage: bun run script/screenshot.ts <out.png> [url] [w] [h]")
  process.exit(2)
}
const url = process.argv[3] ?? "http://localhost:5173/"
const w = Number(process.argv[4] ?? 1280)
const h = Number(process.argv[5] ?? 800)

const exe = await findBrowserExecutable()
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 }).catch((e) => {
    console.error(`page.goto warning: ${e.message ?? e}`)
  })
  // Give SolidJS another moment to render after networkidle.
  await new Promise((r) => setTimeout(r, 500))
  const abs = path.resolve(out)
  await page.screenshot({ path: abs as `${string}.png`, fullPage: false })
  console.log(`screenshot → ${abs}`)
} finally {
  await browser.close()
}
