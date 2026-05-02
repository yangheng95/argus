import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
)

await ensureOverlayDist()

async function browser() {
  const list = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ]
  for (const item of list) {
    if (await Bun.file(item).exists()) return item
  }
  throw new Error("No local Edge/Chrome executable found for overlay menu collapse test")
}

test("closed titlebar menus do not block inspector interactions", async () => {
  const exe = await browser()
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/" || url.pathname === "/ui" || url.pathname === "/ui/") {
        return Response.redirect(`${url.origin}/ui/index.html`, 302)
      }
      return overlayStaticResponse(url.pathname).then((res) => res || new Response("not found", { status: 404 }))
    },
  })
  const app = `http://127.0.0.1:${server.port}`
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app")
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`)
    }, server.port)
    await tab.goto(`${app}/ui/index.html`, { waitUntil: "domcontentloaded" })

    expect(await tab.$("[data-testid^='titlebar-menu-']")).toBeNull()
    await tab.click('[data-menu-trigger="help"]')
    await tab.waitForSelector('[data-testid="titlebar-menu-help"]')
    await tab.keyboard.press("Escape")
    await tab.waitForFunction(() => !document.querySelector('[data-testid^="titlebar-menu-"]'))
    expect(
      await tab.$eval(".sections-header", (node) => {
        const rect = node.getBoundingClientRect()
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return target instanceof Element ? `${target.tagName}.${target.className}` : ""
      }),
    ).toContain("sections-header")
  } finally {
    await page.close()
    server.stop(true)
  }
})
