/**
 * URL screenshot — render any http(s) URL to a PNG via headless Chromium so
 * design-analyst can treat arbitrary design-tool share links (Sketch Cloud,
 * Adobe XD, Framer, InVision, Zeplin, Penpot, live web pages, …) the same
 * way Figma frames are treated: pull a pixel-accurate image, attach it to
 * the task with `intent="visual_reference"`, and let the downstream SSIM
 * gate pick it up automatically.
 *
 * Shares puppeteer plumbing with `delivery/checks/visual.ts` — same
 * `findBrowserExecutable` helper, same launch args — to avoid a second
 * browser lifecycle policy drifting out of sync.
 *
 * No fallback: if browser launch, page load, or screenshot fails, throw a
 * typed error. The caller decides whether to proceed without this
 * reference (the design_analysis tool logs a warning and continues, same
 * pattern it uses for figma failures).
 */
import puppeteer from "puppeteer-core"
import { findBrowserExecutable } from "@/delivery/checks/visual"

export class UrlScreenshotError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "UrlScreenshotError"
    this.cause = cause
  }
}

export interface UrlScreenshot {
  url: string
  /** Final URL after redirects. */
  finalUrl: string
  /** Page <title>, useful for naming the attachment. */
  title: string
  /** Viewport used for the screenshot. */
  viewport: { width: number; height: number }
  /** PNG bytes. */
  png: Buffer
  mime: "image/png"
  /** Markdown blurb the design_analysis tool can inject into the prompt. */
  designContext: string
}

export async function fetchUrlScreenshot(input: {
  url: string
  /** Viewport; defaults to 1440×900 (desktop landing-page baseline). */
  viewport?: { width: number; height: number }
  /** Overall budget (launch + navigation + screenshot). */
  timeoutMs?: number
  /** Override Chrome/Edge path when detection isn't reliable. */
  browserExecutable?: string
  /** When true, screenshot the full scrollable page instead of just the
   *  viewport. Default false — the viewport-clipped image is much closer to
   *  what design replicas are compared against. */
  fullPage?: boolean
}): Promise<UrlScreenshot> {
  if (!/^https?:\/\//i.test(input.url)) {
    throw new UrlScreenshotError(`url must start with http:// or https://: ${input.url}`)
  }
  const viewport = input.viewport ?? { width: 1440, height: 900 }
  const timeoutMs = input.timeoutMs ?? 90_000

  let executablePath: string
  try {
    executablePath = await findBrowserExecutable(input.browserExecutable)
  } catch (e) {
    throw new UrlScreenshotError(
      "No Chrome/Edge executable available for URL screenshotting — install one or pass browserExecutable explicitly.",
      e,
    )
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 })
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    )
    // `networkidle0` is too strict for apps with long-poll/websocket traffic;
    // `networkidle2` waits for ≤2 in-flight requests, which is enough for
    // layout to have settled on most design-tool viewers.
    await page.goto(input.url, { waitUntil: "networkidle2", timeout: timeoutMs })
    const title = (await page.title().catch(() => "")) || new URL(input.url).hostname
    const finalUrl = page.url()
    const shotBuf = await page.screenshot({
      type: "png",
      fullPage: input.fullPage ?? false,
      ...(input.fullPage ? {} : {
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      }),
    })
    const png = Buffer.isBuffer(shotBuf) ? shotBuf : Buffer.from(shotBuf as Uint8Array)
    const designContext = [
      `# URL reference`,
      `- URL: ${input.url}`,
      ...(finalUrl !== input.url ? [`- Final URL: ${finalUrl}`] : []),
      `- Title: ${title}`,
      `- Viewport: ${viewport.width}×${viewport.height}`,
      `- Capture mode: ${input.fullPage ? "full scrollable page" : "viewport"}`,
    ].join("\n")
    return {
      url: input.url,
      finalUrl,
      title,
      viewport,
      png,
      mime: "image/png",
      designContext,
    }
  } catch (e) {
    if (e instanceof UrlScreenshotError) throw e
    throw new UrlScreenshotError(
      `URL screenshot failed for ${input.url}: ${e instanceof Error ? e.message : String(e)}`,
      e,
    )
  } finally {
    // finally-block cleanup — browser may already be closing after an
    // earlier abort; we swallow the close error rather than mask the
    // primary screenshot error that led us here.
    await browser.close().catch(() => undefined)
  }
}
