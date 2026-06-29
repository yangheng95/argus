#!/usr/bin/env bun
/**
 * Screenshot the titlebar menubar with a given menu open. Needs only the
 * vite dev server (the titlebar shell renders without a daemon).
 *
 * Usage: bun run script/snap-titlebar.ts <out.png> [menu] [w] [h] [theme]
 */
import { launchBrowser } from "../test/launch"
import path from "node:path"
import {
  gotoWithBrowserInactivity,
  withBrowserInactivityTimeout,
} from "../../opencorvus/script/benchmark/browser-inactivity"

const out = process.argv[2]
if (!out) {
  console.error("usage: bun run script/snap-titlebar.ts <out.png> [menu] [w] [h] [theme]")
  process.exit(2)
}
const menu = process.argv[3] ?? "settings"
const w = Number(process.argv[4] ?? 1280)
const h = Number(process.argv[5] ?? 800)
const theme = process.argv[6] ?? "dark"

const browser = await launchBrowser(["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: w, height: h })
  page.on("pageerror", (e) => console.error("[page-error]", e.message))
  await gotoWithBrowserInactivity(page, "http://localhost:5173/", "networkidle", 15_000)
  await page.evaluate((wantTheme) => {
    document.documentElement.setAttribute("data-theme", wantTheme)
    document.body.setAttribute("data-theme", wantTheme)
  }, theme)
  await withBrowserInactivityTimeout(page, "titlebar workspace trigger", 8_000, () =>
    page.waitForSelector('[data-menu-trigger="workspace"]', { timeout: 0 }),
  )

  const triggers = await page.$$eval("[data-menu-trigger]", (nodes) =>
    nodes.map((n) => (n as HTMLElement).dataset.menuTrigger),
  )
  console.log("triggers:", JSON.stringify(triggers))

  await page.click(`[data-menu-trigger="${menu}"]`)
  await withBrowserInactivityTimeout(page, `titlebar menu ${menu}`, 4_000, () =>
    page.waitForSelector(`[data-testid="titlebar-menu-${menu}"]`, { timeout: 0 }),
  )
  await new Promise((r) => setTimeout(r, 300))

  const abs = path.resolve(out)
  await page.screenshot({ path: abs as `${string}.png`, fullPage: false })
  console.log(`screenshot → ${abs}`)
} finally {
  await browser.close()
}
