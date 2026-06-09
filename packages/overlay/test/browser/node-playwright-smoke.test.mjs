import assert from "node:assert/strict"
import { access } from "node:fs/promises"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)

const browserCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

async function findBrowserExecutable() {
  const explicit = process.env.OPENCORVUS_BROWSER_EXECUTABLE || process.env.BROWSER_EXECUTABLE
  if (explicit) return explicit
  for (const candidate of browserCandidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try the next known desktop browser path
    }
  }
  throw new Error("No local Edge/Chrome executable found for Node-owned overlay browser test")
}

test("Node-owned overlay browser runner launches Playwright from Node", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const { chromium } = require("playwright")
  const executablePath = await findBrowserExecutable()
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check"],
  })
  try {
    const page = await browser.newPage()
    await page.setContent("<!doctype html><title>overlay node browser smoke</title><main>ready</main>")
    assert.equal(await page.textContent("main"), "ready")
  } finally {
    await browser.close()
  }
})
