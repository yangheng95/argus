/**
 * Visual render — serve a self-contained output directory over a loopback
 * HTTP server and capture a headless-Chrome screenshot.
 *
 * Ported from `mirror/src/service/render.ts`. Adaptations vs. upstream:
 *   - `findChromePath` → opencorvus `findBrowserExecutable` (shared with
 *     `delivery/checks/visual.ts` and `design-analyst/url-screenshot.ts`
 *     so a single browser-lifecycle policy stays in sync).
 *   - CDN cache path → `Global.Path.cache/mirror-cdn/` (XDG-compliant,
 *     survives package rebuilds — never in `src/`).
 *   - Silent `catch` blocks → `Log.create({ service: "mirror.render" })`
 *     with structured context.
 *   - Failure modes raise `RenderError` (typed) instead of plain `Error`.
 *
 * This is an atomic tool: it reads from `outputDir`, writes a screenshot,
 * and nothing else. It does not call any other mirror module.
 */

import { createServer, type Server } from "node:http"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, extname } from "node:path"
import z from "zod"
import puppeteer, { type Browser } from "puppeteer-core"

import { findBrowserExecutable } from "@/delivery/checks/visual"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { RenderError } from "../errors"

const log = Log.create({ service: "mirror.render" })

// ─── Screenshot stabilization CSS ────────────────────────────────────────

/** Injected before capture so screenshots are pixel-identical across runs. */
export const SCREENSHOT_STABILIZATION_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
::-webkit-scrollbar { display: none !important; width: 0 !important; }
html { scrollbar-width: none !important; }
* { caret-color: transparent !important; }
`

// ─── CDN cache ───────────────────────────────────────────────────────────

const CDN_URLS = [
  "https://cdn.tailwindcss.com",
  "https://cdn.tailwindcss.com/3.4.17",
]

function cdnCacheDir(): string {
  return resolve(Global.Path.cache, "mirror-cdn")
}

/** Cached CDN response, or `null` if neither cache nor network can supply. */
export async function getCdnContent(url: string): Promise<Buffer | null> {
  const safeName = url.replace(/[^a-zA-Z0-9._-]/g, "_")
  const cachePath = resolve(cdnCacheDir(), safeName)
  if (existsSync(cachePath)) return readFileSync(cachePath) as Buffer

  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120" },
    })
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer())
      mkdirSync(cdnCacheDir(), { recursive: true })
      writeFileSync(cachePath, buf)
      return buf
    }
  } catch (err) {
    log.warn("cdn fetch failed", { url, error: err instanceof Error ? err.message : String(err) })
  }
  return null
}

/** Pre-warm the known Tailwind CDN entries. */
export async function ensureCdnCache(): Promise<Map<string, Buffer>> {
  const cache = new Map<string, Buffer>()
  for (const url of CDN_URLS) {
    const content = await getCdnContent(url)
    if (content) {
      cache.set(url, content)
      if (url === "https://cdn.tailwindcss.com") {
        cache.set("https://cdn.tailwindcss.com/3.4.17", content)
      }
    }
  }
  return cache
}

/** On-demand cache for arbitrary external resources (Google Fonts etc.). */
export async function fetchAndCache(url: string): Promise<Buffer | null> {
  const safeName = url.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)
  const cachePath = resolve(cdnCacheDir(), safeName)
  if (existsSync(cachePath)) return readFileSync(cachePath) as Buffer

  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120" },
    })
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer())
      mkdirSync(cdnCacheDir(), { recursive: true })
      writeFileSync(cachePath, buf)
      return buf
    }
  } catch (err) {
    log.warn("fetch-and-cache failed", { url, error: err instanceof Error ? err.message : String(err) })
  }
  return null
}

/** Content-Type inferred from URL (fonts/CSS/JS). */
export function contentTypeFromUrl(url: string): string {
  if (url.includes(".woff2")) return "font/woff2"
  if (url.includes(".woff")) return "font/woff"
  if (url.includes(".css") || url.includes("fonts.googleapis.com/css")) return "text/css"
  if (url.includes(".js")) return "application/javascript"
  return "application/octet-stream"
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

// ─── Static file server ──────────────────────────────────────────────────

/** Loopback-only static server with path-traversal protection. */
export function createStaticServer(outputDir: string): Promise<{ server: Server; port: number }> {
  return new Promise((ok, fail) => {
    const normalizedDir = resolve(outputDir).replace(/\\/g, "/") + "/"
    const server = createServer((req, res) => {
      const urlPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html")
      const filePath = resolve(outputDir, urlPath.slice(1)).replace(/\\/g, "/")

      // Prevent path traversal: resolved path must stay within outputDir.
      if (!filePath.startsWith(normalizedDir) && filePath !== resolve(outputDir).replace(/\\/g, "/")) {
        res.writeHead(403)
        res.end("Forbidden")
        return
      }

      if (!existsSync(filePath)) {
        res.writeHead(404)
        res.end("Not found")
        return
      }

      const ext = extname(filePath)
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream"
      const content = readFileSync(filePath)
      res.writeHead(200, { "Content-Type": contentType, Connection: "close" })
      res.end(content)
    })

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (addr && typeof addr === "object") {
        ok({ server, port: addr.port })
      } else {
        server.close()
        fail(new RenderError({ outputDir, reason: "server listen failed: no address", phase: "server" }))
      }
    })
    server.on("error", (err) => {
      fail(new RenderError({ outputDir, reason: err.message, phase: "server" }, { cause: err }))
    })
  })
}

// ─── Public API ──────────────────────────────────────────────────────────

export const RenderInputSchema = z.object({
  outputDir: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  timeout: z.number().optional(),
  fullPage: z.boolean().optional(),
  /**
   * If provided, navigate puppeteer to this URL instead of booting the
   * built-in static loopback server. Use this when the project needs a
   * live backend (Express/Fastify/etc.) that the agent has already started.
   */
  url: z.string().url().optional(),
})
export type RenderInput = z.infer<typeof RenderInputSchema>

export const RenderOutputSchema = z.object({
  screenshotDataUrl: z.string(),
  screenshotBuffer: z.instanceof(Buffer),
  viewport: z.object({ width: z.number(), height: z.number() }),
  renderTimeMs: z.number(),
  consoleErrors: z.array(z.string()).optional(),
})
export type RenderOutput = z.infer<typeof RenderOutputSchema>

export interface RenderFilesCtx {
  emit?: (event: {
    phase: "start-server" | "launch-browser" | "load-page" | "screenshot"
    detail?: string
  }) => void
}

/**
 * Render the `index.html` at `outputDir` and return a PNG screenshot.
 *
 * @throws {RenderError} when `index.html` is missing, browser launch fails,
 * navigation times out, or screenshot capture fails.
 */
export async function renderFiles(input: RenderInput, ctx?: RenderFilesCtx): Promise<RenderOutput> {
  const parsed = RenderInputSchema.parse(input)
  const startTime = Date.now()
  const timeout = parsed.timeout ?? 30_000
  const fullPage = parsed.fullPage ?? false
  const { outputDir, viewport, url: liveUrl } = parsed

  // Two modes:
  //   1. liveUrl provided  → agent already booted a server; skip the static loopback.
  //   2. liveUrl absent    → static-file mode; require index.html and serve outputDir.
  let server: Server | undefined
  let targetUrl: string
  if (liveUrl) {
    ctx?.emit?.({ phase: "start-server", detail: `external: ${liveUrl}` })
    targetUrl = liveUrl
  } else {
    const indexPath = resolve(outputDir, "index.html")
    if (!existsSync(indexPath)) {
      throw new RenderError({
        outputDir,
        reason:
          `index.html not found in ${outputDir}. ` +
          `If your project needs a backend (Express/Fastify/etc.) to serve its pages, ` +
          `start the server yourself (e.g. \`bun run dev\` or \`npm start\`) on a known port ` +
          `and call webpage_render again with \`url=http://127.0.0.1:<port>/<route>\`. ` +
          `Otherwise produce a self-contained \`index.html\` in the worktree root.`,
      })
    }
    ctx?.emit?.({ phase: "start-server" })
    const started = await createStaticServer(outputDir)
    server = started.server
    targetUrl = `http://127.0.0.1:${started.port}/`
  }

  let browser: Browser | undefined
  try {
    ctx?.emit?.({ phase: "launch-browser" })

    const execPath = await findBrowserExecutable()
    browser = await puppeteer.launch({
      executablePath: execPath,
      headless: true,
      timeout: 15_000,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-background-networking",
        `--window-size=${viewport.width},${viewport.height}`,
      ],
    })
    const page = await browser.newPage()
    await page.setViewport(viewport)

    const cdnCache = await ensureCdnCache()
    await page.setRequestInterception(true)
    page.on("request", async (req) => {
      const url = req.url()
      const corsHeaders = { "Access-Control-Allow-Origin": "*" }

      for (const [cdnUrl, content] of cdnCache) {
        if (url === cdnUrl || url.startsWith(cdnUrl)) {
          req.respond({ status: 200, contentType: "application/javascript", headers: corsHeaders, body: content })
          return
        }
      }

      if (url.includes("fonts.googleapis.com/") || url.includes("fonts.gstatic.com/")) {
        const cached = await fetchAndCache(url)
        if (cached) {
          req.respond({ status: 200, contentType: contentTypeFromUrl(url), headers: corsHeaders, body: cached })
          return
        }
      }

      req.continue()
    })

    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    page.on("pageerror", (err) => {
      consoleErrors.push(err instanceof Error ? err.message : String(err))
    })

    ctx?.emit?.({ phase: "load-page" })
    try {
      await page.goto(targetUrl, { waitUntil: "networkidle0", timeout })
    } catch (err) {
      const baseReason = err instanceof Error ? err.message : String(err)
      const hint = liveUrl
        ? ` Verify the server at ${liveUrl} is running and serving the requested route.`
        : ` If your project requires a live backend, start it (e.g. \`bun run dev\`) and call webpage_render with \`url=http://127.0.0.1:<port>/<route>\` instead of relying on the static-file fallback.`
      throw new RenderError(
        {
          outputDir,
          reason: baseReason + hint,
          phase: "navigate",
        },
        { cause: err },
      )
    }

    // Fonts + images settle.
    try {
      await page.evaluate(() => (document as any).fonts?.ready)
    } catch {
      // older browsers may not expose document.fonts
    }
    try {
      await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"))
        return Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((r) => {
                  img.onload = r
                  img.onerror = r
                }),
          ),
        )
      })
    } catch {
      // DOM may be empty — nothing to wait for.
    }

    await page.addStyleTag({ content: SCREENSHOT_STABILIZATION_CSS })
    await new Promise((r) => setTimeout(r, 3_000))

    ctx?.emit?.({ phase: "screenshot" })
    let screenshotBuffer: Buffer
    try {
      const screenshotUint8 = await page.screenshot({ type: "png", fullPage })
      screenshotBuffer = Buffer.from(screenshotUint8)
    } catch (err) {
      throw new RenderError(
        {
          outputDir,
          reason: err instanceof Error ? err.message : String(err),
          phase: "screenshot",
        },
        { cause: err },
      )
    }

    const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`
    const renderTimeMs = Date.now() - startTime

    // Filter out non-fatal warnings (DevTools, CDN noise).
    const filteredErrors = consoleErrors.filter((e) => !/DevTools|cdn\.tailwindcss\.com/i.test(e))

    // Detect 404s / fetch failures that indicate the page expected a live
    // backend but no `url` was supplied. The screenshot will show broken /
    // empty data sections — surface this hard so the agent stops iterating
    // on a degraded render.
    const backendErrorPattern =
      /\b(404|500|503)\b|Failed to fetch|NetworkError|net::ERR_|fetch failed|TypeError: Failed to fetch|Unexpected token .* "Not found"/i
    const backendErrors = filteredErrors.filter((e) => backendErrorPattern.test(e))
    if (backendErrors.length > 0 && !liveUrl) {
      throw new RenderError({
        outputDir,
        reason:
          `Rendered page logged ${backendErrors.length} backend / network failure(s) — ` +
          `the screenshot would not faithfully represent the target. ` +
          `First console errors: ${backendErrors.slice(0, 3).join(" | ")}. ` +
          `If your project depends on a backend server, start it yourself ` +
          `(e.g. \`bun run dev\` / \`npm start\`) on a known port and re-call webpage_render ` +
          `with \`url=http://127.0.0.1:<port>/<route>\`. ` +
          `Otherwise inline the data directly into a self-contained \`index.html\` so the ` +
          `static-file fallback can render it without network calls.`,
        phase: "screenshot",
      })
    }

    return {
      screenshotDataUrl,
      screenshotBuffer,
      viewport,
      renderTimeMs,
      consoleErrors: filteredErrors.length > 0 ? filteredErrors : undefined,
    }
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch (err) {
        log.warn("browser close failed", { error: err instanceof Error ? err.message : String(err) })
      }
    }
    server?.close()
  }
}
