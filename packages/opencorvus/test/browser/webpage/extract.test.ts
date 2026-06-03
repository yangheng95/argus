import { describe, test, expect } from "bun:test"
import { createServer, type Server } from "node:http"
import { AddressInfo } from "node:net"

import { extractPage } from "../../../src/browser/webpage/extract"
import { ExtractedPageSchema } from "../../../src/browser/webpage/extracted-page"
import { UrlExtractError } from "../../../src/browser/webpage/errors"

const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Extract Fixture</title>
<style>
:root {
  --color-primary: #3366ff;
  --spacing-base: 8px;
}
body { margin: 0; font-family: Inter, sans-serif; color: #222; background: #f5f5f5; }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: #fff; }
.hero { padding: 48px 24px; background: linear-gradient(135deg, #3366ff, #00d4ff); color: #fff; }
.hero h1 { margin: 0 0 16px; font-size: 36px; font-weight: 700; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 24px; }
.card { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.card h2 { font-size: 18px; margin: 0 0 8px; }
footer { padding: 24px; text-align: center; color: #666; font-size: 14px; }
</style>
</head>
<body>
  <header role="banner">
    <nav class="nav">
      <a href="#home">Home</a>
      <a href="#about">About</a>
    </nav>
    <button type="button" aria-label="menu">Menu</button>
  </header>
  <section class="hero">
    <h1>Welcome</h1>
    <p>Bold tagline here</p>
    <button>Get started</button>
  </section>
  <div class="cards">
    <div class="card">
      <h2>Feature A</h2>
      <p>Description A</p>
      <i class="fa-check"></i>
    </div>
    <div class="card">
      <h2>Feature B</h2>
      <p>Description B</p>
      <svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="#3366ff"/></svg>
    </div>
  </div>
  <footer>
    <small>Copyright 2026 Webpage Test</small>
  </footer>
</body>
</html>`

async function serveFixture(): Promise<{ url: string; server: Server }> {
  return new Promise((ok, fail) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html", Connection: "close" })
      res.end(FIXTURE_HTML)
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null
      if (addr && typeof addr === "object") {
        ok({ url: `http://127.0.0.1:${addr.port}/`, server })
      } else {
        server.close()
        fail(new Error("server address unavailable"))
      }
    })
    server.on("error", fail)
  })
}

describe("extractPage", () => {
  test(
    "extracts DOM, tokens, assets, and validates schema",
    async () => {
      const { url, server } = await serveFixture()
      try {
        const result = await extractPage({ url, noScreenshots: true, waitMs: 0 })

        expect(() => ExtractedPageSchema.parse(result)).not.toThrow()
        expect(result.url).toBe(url)
        expect(result.title).toBe("Extract Fixture")
        expect(result.viewport.width).toBeGreaterThan(0)
        expect(result.tree.length).toBeGreaterThan(0)
        expect(result.tokens.customProperties["--color-primary"]).toBe("#3366ff")
        expect(result.stats.totalElements).toBeGreaterThanOrEqual(result.stats.extractedElements)
      } finally {
        server.close()
      }
    },
    90_000,
  )

  test(
    "scoped extraction limits the returned tree",
    async () => {
      const { url, server } = await serveFixture()
      try {
        const result = await extractPage({
          url,
          noScreenshots: true,
          waitMs: 0,
          scopeSelector: ".hero",
        })
        expect(result.tree.length).toBeGreaterThan(0)
        expect(result.tree.map((element) => element.tag).sort()).toEqual(["button", "h1", "p"])
      } finally {
        server.close()
      }
    },
    90_000,
  )
})

describe("extractPage error paths", () => {
  test(
    "throws UrlExtractError on navigation failure",
    async () => {
      try {
        await extractPage({
          url: "http://127.0.0.1:1/does-not-exist",
          noScreenshots: true,
          waitMs: 0,
        })
        throw new Error("should have thrown")
      } catch (error) {
        expect(UrlExtractError.isInstance(error)).toBe(true)
        if (UrlExtractError.isInstance(error)) {
          expect(["navigate", "launch"]).toContain(error.data.phase)
        }
      }
    },
    60_000,
  )

  test(
    "throws UrlExtractError on HTTP 403",
    async () => {
      const server = createServer((_req, res) => {
        res.writeHead(403, { "Content-Type": "text/plain" })
        res.end("Forbidden")
      })
      await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
      const port = (server.address() as AddressInfo).port
      try {
        await extractPage({
          url: `http://127.0.0.1:${port}/`,
          noScreenshots: true,
          waitMs: 0,
        })
        throw new Error("should have thrown")
      } catch (error) {
        expect(UrlExtractError.isInstance(error)).toBe(true)
        if (UrlExtractError.isInstance(error)) {
          // @ts-expect-error status is attached by the runtime error payload.
          expect(error.data.status).toBe(403)
        }
      } finally {
        server.close()
      }
    },
    60_000,
  )
})
