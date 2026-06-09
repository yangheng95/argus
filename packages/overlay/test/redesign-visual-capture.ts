#!/usr/bin/env bun
// Capture a still PNG of the redesign-visual.html fixture so the operator
// can eyeball every fix at once without spinning up the full Tauri overlay.
//
import path from "node:path"
import fs from "node:fs"
import { launchBrowser } from "./launch"

const fixturePath = path.resolve(new URL("./redesign-visual.html", import.meta.url).pathname.replace(/^\/+/, ""))
const fixtureURL = "file:///" + fixturePath.replace(/\\/g, "/")

const outDir = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/+/, ""))
const outPath = path.join(outDir, "redesign-visual.png")

const browser = await launchBrowser(["--no-sandbox"])
const page = await browser.newPage()
await page.setViewportSize({ width: 800, height: 1400 })
await page.goto(fixtureURL, { waitUntil: "load" })
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: outPath, fullPage: true })
await browser.close()

const stat = fs.statSync(outPath)
console.log(`screenshot: ${outPath}`)
console.log(`size: ${stat.size} bytes`)
