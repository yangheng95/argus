import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
)

let browserQueue: Promise<void> = Promise.resolve()
const browserLockDir = join(tmpdir(), "pptr-overlay-browser-lock")
const browserLockHeartbeat = join(browserLockDir, "heartbeat")
const STALE_BROWSER_LOCK_MS = 120_000

async function acquireBrowserLock() {
  while (true) {
    try {
      mkdirSync(browserLockDir)
      writeFileSync(join(browserLockDir, "owner"), `${process.pid}\n${Date.now()}\n`)
      writeFileSync(browserLockHeartbeat, `${Date.now()}\n`)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== "EEXIST") throw error
      try {
        const lockStat = statSync(browserLockHeartbeat)
        const age = Date.now() - lockStat.mtimeMs
        if (age > STALE_BROWSER_LOCK_MS) {
          rmSync(browserLockDir, { recursive: true, force: true })
          continue
        }
      } catch {
        rmSync(browserLockDir, { recursive: true, force: true })
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

function releaseBrowserLock() {
  try {
    rmSync(browserLockDir, { recursive: true, force: true })
  } catch {
    // ignore release races between close/disconnect handlers
  }
}

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
  const waitForTurn = browserQueue
  let releaseTurn!: () => void
  browserQueue = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })

  await waitForTurn
  await acquireBrowserLock()
  const heartbeat = setInterval(() => {
    writeFileSync(browserLockHeartbeat, `${Date.now()}\n`)
  }, Math.floor(STALE_BROWSER_LOCK_MS / 4))
  const exe = await findBrowser()
  try {
    const browser = await puppeteer.launch({
      executablePath: exe,
      headless: "new",
      userDataDir: mkdtempSync(join(tmpdir(), "pptr-overlay-")),
      args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check", ...(extraArgs ?? [])],
    })

    let released = false
    const releaseOnce = () => {
      if (released) return
      released = true
      clearInterval(heartbeat)
      releaseTurn()
      releaseBrowserLock()
    }

    browser.once("disconnected", releaseOnce)

    const originalClose = browser.close.bind(browser)
    browser.close = async () => {
      try {
        return await originalClose()
      } finally {
        releaseOnce()
      }
    }

    return browser
  } catch (error) {
    clearInterval(heartbeat)
    releaseTurn()
    releaseBrowserLock()
    throw error
  }
}
