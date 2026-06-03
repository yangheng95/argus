#!/usr/bin/env bun
// One-shot screenshot of the running overlay vite dev server.
// Lives in opencorvus pkg so it can resolve puppeteer-core directly.
//   bun run script/overlay-snap.ts <out.png> [url] [w] [h]

import puppeteer from "puppeteer-core"
import { findBrowserExecutable } from "../src/acceptance/checks/visual"
import path from "node:path"

const out = process.argv[2]
if (!out) {
  console.error("usage: bun run script/overlay-snap.ts <out.png> [url] [w] [h]")
  process.exit(2)
}
const url = process.argv[3] ?? "http://localhost:5173/"
const w = Number(process.argv[4] ?? 1400)
const h = Number(process.argv[5] ?? 900)

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
  await new Promise((r) => setTimeout(r, 800))
  const abs = path.resolve(out)
  await page.screenshot({ path: abs as `${string}.png`, fullPage: false })
  console.log(`screenshot → ${abs}`)
} finally {
  await browser.close()
}
