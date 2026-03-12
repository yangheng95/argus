import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
)

async function findBrowser() {
  // Chrome is preferred: Edge x86 singleton handoff exits with code 0 in headless mode
  const list = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ]
  for (const item of list) {
    if (await Bun.file(item).exists()) return item
  }
  throw new Error("No local Edge/Chrome executable found for overlay test")
}

export async function launchBrowser(extraArgs?: string[]) {
  const exe = await findBrowser()
  return puppeteer.launch({
    executablePath: exe,
    headless: "new",
    userDataDir: mkdtempSync(join(tmpdir(), "pptr-overlay-")),
    args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check", ...(extraArgs ?? [])],
  })
}
