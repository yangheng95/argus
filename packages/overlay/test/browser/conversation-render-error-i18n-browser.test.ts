import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"

import { launchBrowser } from "../launch.ts"
import { ensureOverlayDist, overlayStaticResponse } from "../overlay-dist.ts"
import { startBrowserFixture } from "./http-fixture.ts"

await ensureOverlayDist()

const ZH_CN = JSON.parse(readFileSync(resolve("packages/overlay/src/i18n/zh-CN.json"), "utf8")) as Record<
  string,
  string
>

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function distStylesheetHrefs(): string[] {
  const html = readFileSync(resolve("packages/overlay/dist-vite/index.html"), "utf8")
  return Array.from(html.matchAll(/<link\s+rel="stylesheet"[^>]+href="([^"]+)"/g)).map((match) => match[1]!)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

test("conversation render-error card uses localized visible and accessible copy", async () => {
  assert.equal(process.env.OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER, "1")
  assert.equal(typeof globalThis.Bun, "undefined")

  const title = ZH_CN["chat.render_error_title"]
  const message = ZH_CN["chat.render_error_unknown"]
  assert.ok(title)
  assert.ok(message)

  const server = await startBrowserFixture(async (req) => {
    const url = new URL(req.url)
    const staticResponse = await overlayStaticResponse(route(url))
    if (staticResponse) return staticResponse
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 760, height: 360 })
    const stylesheetLinks = distStylesheetHrefs()
      .map((href) => `<link rel="stylesheet" href="${new URL(href, `${server.origin}/ui/index.html`).href}">`)
      .join("\n")
    await page.setContent(
      `<!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          ${stylesheetLinks}
        </head>
        <body data-theme="light">
          <main class="chat-scroll" style="padding: 24px; min-height: 260px;">
            <article
              class="card conversation-card-render-failure"
              data-card-id="fixture/render-error/card-id-that-is-long-enough-for-clipping"
              data-kind="render-error"
              role="group"
              aria-label="${escapeHtml(title)}"
            >
              <div class="card__head">
                <div class="card__title">${escapeHtml(title)}</div>
                <div class="card__meta">fixture/render-error/card-id-that-is-long-enough-for-clipping</div>
              </div>
              <div class="card__body">
                <div class="msg-tool-error">${escapeHtml(message)}</div>
              </div>
            </article>
          </main>
        </body>
      </html>`,
      { waitUntil: "load" },
    )
    await page.waitForSelector(".conversation-card-render-failure")

    const state = await page.$eval<{
      ariaLabel: string | null
      title: string
      message: string
      width: number
      height: number
      titleColor: string
      messageColor: string
    }>(".conversation-card-render-failure", (node: Element) => {
      const card = node as HTMLElement
      const titleNode = card.querySelector<HTMLElement>(".card__title")
      const messageNode = card.querySelector<HTMLElement>(".msg-tool-error")
      const box = card.getBoundingClientRect()
      return {
        ariaLabel: card.getAttribute("aria-label"),
        title: titleNode?.textContent?.trim() || "",
        message: messageNode?.textContent?.trim() || "",
        width: box.width,
        height: box.height,
        titleColor: titleNode ? getComputedStyle(titleNode).color : "",
        messageColor: messageNode ? getComputedStyle(messageNode).color : "",
      }
    })

    assert.equal(state.ariaLabel, title)
    assert.equal(state.title, title)
    assert.equal(state.message, message)
    assert.ok(!state.title.includes("Card render failed"), `unexpected English title: ${state.title}`)
    assert.ok(!state.message.includes("Unknown render error"), `unexpected English message: ${state.message}`)
    assert.ok(state.width > 240, `render-error card width too small: ${state.width}`)
    assert.ok(state.height > 60, `render-error card height too small: ${state.height}`)
    assert.notEqual(state.titleColor, "rgba(0, 0, 0, 0)")
    assert.notEqual(state.messageColor, "rgba(0, 0, 0, 0)")

    const screenshotPath = resolve(".scratch", "conversation-render-error-i18n-zh.png")
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, await (await page.$(".conversation-card-render-failure"))!.screenshot({}))
  } finally {
    await browser.close()
    await server.close()
  }
})
