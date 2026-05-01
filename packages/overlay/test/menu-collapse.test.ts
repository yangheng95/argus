import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"

const { default: puppeteer } = await import(
  new URL("../../opencorvus/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js", import.meta.url).href,
)

const src = new URL("../src/", import.meta.url)
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

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
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
      const file = Bun.file(new URL(name, src))
      const type = types[name.slice(name.lastIndexOf(".")) as keyof typeof types] || "application/octet-stream"
      return file.exists().then((ok) => ok ? new Response(file, { headers: { "content-type": type } }) : new Response("not found", { status: 404 }))
    },
  })
  const app = `http://127.0.0.1:${server.port}`
  const page = await launchBrowser()

  try {
    const tab = await page.newPage()
    await tab.goto(app, { waitUntil: "domcontentloaded" })

    expect(await tab.$("[data-testid^='titlebar-menu-']")).toBeNull()
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
