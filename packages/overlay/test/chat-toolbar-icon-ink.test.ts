import { expect, test } from "bun:test"
import sharp from "sharp"

import { launchBrowser } from "./launch"
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist"

await ensureOverlayDist()

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/"
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  })
}

function parseRgb(value: string): [number, number, number] {
  const rgb = value.match(/rgba?\(([^)]+)\)/)
  if (!rgb) throw new Error(`unsupported color: ${value}`)
  const [r, g, b] = rgb[1]!.split(/,\s*/).map(Number)
  return [r!, g!, b!]
}

async function countIconPixels(png: Buffer, color: [number, number, number]): Promise<number> {
  const image = sharp(png).ensureAlpha()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let i = 0; i < info.width * info.height; i += 1) {
    const offset = i * 4
    const dr = data[offset]! - color[0]
    const dg = data[offset + 1]! - color[1]
    const db = data[offset + 2]! - color[2]
    const distance = Math.sqrt(dr * dr + dg * dg + db * db)
    if (data[offset + 3]! > 0 && distance < 56) count += 1
  }
  return count
}

test("composer toolbar icons have visible rendered ink", async () => {
  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = route(url)
      if (path === "/favicon.ico" || path === "/ui/favicon.ico") return new Response(null, { status: 204 })
      if (path === "/" || path === "/ui" || path === "/ui/") return Response.redirect(`${url.origin}/ui/index.html`, 302)
      const staticResponse = await overlayStaticResponse(path)
      if (staticResponse) return staticResponse
      if (path === "/global/health") return send({ version: "1.2.3" })
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] })
      if (path === "/session") return send([])
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" })
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 })
      if (path === "/provider") return send({ all: [], connected: [], default: {} })
      if (path === "/provider/auth") return send({})
      if (path === "/config/providers") return send({ providers: [], default: {} })
      if (path === "/config/prompt") return send([])
      if (path === "/config") return send({ model: "" })
      if (path === "/agent") return send([])
      if (path === "/channel") return send([])
      if (path === "/executor") return send([])
      if (path === "/skill/installed" || path === "/skill") return send([])
      if (path === "/mcp") return send({})
      if (path === "/panel/knowledge/memory") return send([])
      if (path === "/panel/knowledge/preference") return send([])
      if (path === "/log" && req.method === "POST") return send({ ok: true })
      return new Response(`unhandled ${req.method} ${url.pathname}`, { status: 404 })
    },
  })

  const browser = await launchBrowser(["--disable-dev-shm-usage"])
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 980, height: 760, deviceScaleFactor: 1 })
    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "load" })
    await page.waitForSelector('.chat-icon-col [data-ui="chat-toolbar-button"] svg', { visible: true })

    const icons = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.chat-icon-col [data-ui="chat-toolbar-button"]')).map((button) => {
        const svg = button.querySelector<SVGElement>("svg")
        if (!svg) throw new Error(`missing svg for ${button.getAttribute("aria-label")}`)
        const rect = svg.getBoundingClientRect()
        return {
          label: button.getAttribute("aria-label") || "",
          color: getComputedStyle(button).color,
          clip: {
            x: Math.floor(rect.x),
            y: Math.floor(rect.y),
            width: Math.ceil(rect.width),
            height: Math.ceil(rect.height),
          },
        }
      }),
    )

    expect(icons.map((icon) => icon.label)).toEqual([
      "Attach files or images",
      "Web search",
      "Expand input",
    ])

    for (const icon of icons) {
      const png = await page.screenshot({ clip: icon.clip })
      const ink = await countIconPixels(Buffer.from(png), parseRgb(icon.color))
      expect(ink).toBeGreaterThanOrEqual(44)
    }

    await page.close()
  } finally {
    await browser.close()
    server.stop(true)
  }
}, { timeout: 120_000 })
