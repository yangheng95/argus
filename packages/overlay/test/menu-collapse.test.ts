import { expect, test } from "bun:test"
import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"


await ensureOverlayDist()


test("closed titlebar menus do not block inspector interactions", async () => {
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
        if (!(target instanceof Element)) return ""
        const insideHeader = !!target.closest(".sections-header")
        return insideHeader ? "sections-header-descendant" : `${target.tagName}.${target.className}`
      }),
    ).toContain("sections-header")
  } finally {
    await page.close()
    server.stop(true)
  }
}, { timeout: 60_000 })
