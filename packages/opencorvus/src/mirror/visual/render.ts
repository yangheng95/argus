/**
 * Visual render — capture an explicit browser URL.
 *
 * Ported from `mirror/src/service/render.ts`. Adaptations vs. upstream:
 *   - `findChromePath` → opencorvus `findBrowserExecutable` (shared with
 *     `delivery/checks/visual.ts` and `frontend-design/url-screenshot.ts`
 *     so a single browser-lifecycle policy stays in sync).
 *   - Silent `catch` blocks → `Log.create({ service: "mirror.render" })`
 *     with structured context.
 *   - Failure modes raise `RenderError` (typed) instead of plain `Error`.
 *
 * This is an atomic tool: it navigates to the caller-provided URL and returns
 * the captured screenshot. It does not start servers, infer project shape, or
 * substitute resources.
 */

import z from "zod"
import { type Browser } from "playwright"

import { BrowserRuntime } from "@/browser/runtime"
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

// ─── Public API ──────────────────────────────────────────────────────────

export const RenderInputSchema = z.object({
  /** Explicit page URL to capture. */
  url: z.string().url(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  timeout: z.number().optional(),
  fullPage: z.boolean().optional(),
})
export type RenderInput = z.infer<typeof RenderInputSchema>

export const RenderOutputSchema = z.object({
  screenshotDataUrl: z.string(),
  screenshotBuffer: z.instanceof(Buffer),
  viewport: z.object({ width: z.number(), height: z.number() }),
  renderTimeMs: z.number(),
  bodyText: z.string().optional(),
  visibleText: z.string().optional(),
  consoleErrors: z.array(z.string()).optional(),
})
export type RenderOutput = z.infer<typeof RenderOutputSchema>

export interface RenderFilesCtx {
  emit?: (event: {
    phase: "launch-browser" | "load-page" | "screenshot"
    detail?: string
  }) => void
}

/**
 * Render the explicit `url` and return a PNG screenshot.
 *
 * @throws {RenderError} when browser launch fails, navigation times out, or
 * screenshot capture fails.
 */
export async function renderFiles(input: RenderInput, ctx?: RenderFilesCtx): Promise<RenderOutput> {
  const parsed = RenderInputSchema.parse(input)
  const startTime = Date.now()
  const timeout = parsed.timeout ?? 30_000
  const fullPage = parsed.fullPage ?? false
  const { url, viewport } = parsed

  let browser: Browser | undefined
  try {
    ctx?.emit?.({ phase: "launch-browser" })

    try {
      browser = await BrowserRuntime.launchPlaywrightBrowser({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-extensions",
          "--disable-background-networking",
          `--window-size=${viewport.width},${viewport.height}`,
        ],
      })
    } catch (err) {
      throw new RenderError(
        {
          url,
          reason: err instanceof Error ? err.message : String(err),
          phase: "launch",
        },
        { cause: err },
      )
    }
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()

    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    page.on("pageerror", (err) => {
      consoleErrors.push(err instanceof Error ? err.message : String(err))
    })

    ctx?.emit?.({ phase: "load-page" })
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout })
    } catch (err) {
      const baseReason = err instanceof Error ? err.message : String(err)
      throw new RenderError(
        {
          url,
          reason: baseReason,
          phase: "navigate",
        },
        { cause: err },
      )
    }

    // Fonts + images settle.
    try {
      await Promise.race([
        page.evaluate(() => (document as any).fonts?.ready),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch {
      // older browsers may not expose document.fonts
    }
    try {
      await Promise.race([
        page.evaluate(() => {
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
        }),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch {
      // DOM may be empty — nothing to wait for.
    }

    await page.addStyleTag({ content: SCREENSHOT_STABILIZATION_CSS })
    await new Promise((r) => setTimeout(r, 3_000))
    const textSignals = await page.evaluate(() => {
      function isElementVisible(element: Element): boolean {
        const style = window.getComputedStyle(element)
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false
        if (style.display === "contents") return true
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
          return false
        }
        return true
      }

      function isTextNodeVisible(node: Text): boolean {
        const parent = node.parentElement
        if (!parent || !node.textContent?.trim()) return false
        let element: Element | null = parent
        while (element) {
          if (!isElementVisible(element)) return false
          element = element.parentElement
        }
        const range = document.createRange()
        range.selectNodeContents(node)
        const visible = Array.from(range.getClientRects()).some((rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth,
        )
        range.detach()
        return visible
      }

      const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT)
      const visible: string[] = []
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (node instanceof Text && isTextNodeVisible(node)) visible.push(node.textContent ?? "")
      }
      return {
        bodyText: document.body?.innerText ?? "",
        visibleText: visible.join(" "),
      }
    }).catch(() => ({ bodyText: "", visibleText: "" }))

    ctx?.emit?.({ phase: "screenshot" })
    let screenshotBuffer: Buffer
    try {
      const screenshotUint8 = await page.screenshot({ type: "png", fullPage })
      screenshotBuffer = Buffer.from(screenshotUint8)
    } catch (err) {
      throw new RenderError(
        {
          url,
          reason: err instanceof Error ? err.message : String(err),
          phase: "screenshot",
        },
        { cause: err },
      )
    }

    const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`
    const renderTimeMs = Date.now() - startTime

    return {
      screenshotDataUrl,
      screenshotBuffer,
      viewport,
      renderTimeMs,
      bodyText: textSignals.bodyText,
      visibleText: textSignals.visibleText,
      consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
    }
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch (err) {
        log.warn("browser close failed", { error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}
