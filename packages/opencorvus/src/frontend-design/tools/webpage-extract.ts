/**
 * `webpage_extract` tool — wraps the webpage extraction runtime.
 *
 * Launches a headless browser, pulls the DOM tree + computed styles + full-
 * page screenshot, and writes primary artifacts to the worktree:
 *   - `<outputDir>/reference.png`          reference screenshot (binary)
 *   - `<outputDir>/reference-mobile.png`   mobile viewport reference screenshot (binary)
 *   - `<outputDir>/capture.html`           post-load archive HTML snapshot
 *   - `<outputDir>/extracted-page.json`    full ExtractedPage (tree + tokens + assets)
 *   - `<outputDir>/images/*`               downloaded image assets (when keep_images=true)
 *
 * The tool returns just the summary + artifact paths so the agent's context
 * isn't polluted with a large tree dump. The raw JSON is durable evidence and
 * a compile/analyze input; prompt-facing work should use the compiled IR and
 * shared context artifacts.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { Log } from "../../util/log"
import { extractPage } from "@/browser/webpage/extract"
import { resolveWebpageEvidenceOutputDir, DEFAULT_WEBPAGE_EVIDENCE_SUBDIR } from "./output-dir"
import { resolveFrontendDesignBrowserProxy } from "../browser-proxy"

const log = Log.create({ service: "webpage-evidence.tool.webpage_extract" })

const DEFAULT_MOBILE_REFERENCE_VIEWPORT = {
  width: 390,
  height: 844,
} as const

export const WebpageExtractTool = Tool.define("webpage_extract", {
  description: `Extract a live webpage via headless Chrome. Captures the DOM tree, ~33 computed CSS properties per element, and a full-page PNG screenshot.

Writes to the output directory (defaults to the worktree):
  - reference.png                the reference screenshot — visual validation evidence
  - reference-mobile.png         the mobile viewport reference screenshot for responsive validation
  - capture.html                 post-load archive HTML snapshot for canonical structure IR + asset graph compilation
  - extracted-page.json          the full ExtractedPage object (DOM + tokens + assets)
  - images/*                     downloaded image assets (so the clone can reference local paths)

Returns a compact summary (title, viewport, element count, artifact paths). \`extracted-page.json\` is the raw source artifact for deterministic tools and the evidence manifest; do not read it wholesale into prompt context.

Use this only when URL evidence is missing for the requested output directory. Do not rerun it for the same URL/outputDir once \`reference.png\` and \`extracted-page.json\` exist. Requires network access to the target URL.`,
  parameters: z.object({
    url: z.string().describe("The webpage to extract. Must start with http:// or https://."),
    outputDir: z
      .string()
      .describe(
        `Directory to write artifacts. Defaults to task-scoped \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`. Do not set this during task sessions; overrides are for benchmarks/tests and task-session overrides must stay under \`${DEFAULT_WEBPAGE_EVIDENCE_SUBDIR}\`.`,
      )
      .optional(),
    viewport_width: z.number().int().positive().describe("Viewport width in logical pixels. Default 1440.").optional(),
    viewport_height: z.number().int().positive().describe("Viewport height in logical pixels. Default 900.").optional(),
    mobile_viewport_width: z
      .number()
      .int()
      .positive()
      .describe(
        `Mobile reference viewport width in logical pixels. Default ${DEFAULT_MOBILE_REFERENCE_VIEWPORT.width}.`,
      )
      .optional(),
    mobile_viewport_height: z
      .number()
      .int()
      .positive()
      .describe(
        `Mobile reference viewport height in logical pixels. Default ${DEFAULT_MOBILE_REFERENCE_VIEWPORT.height}.`,
      )
      .optional(),
    scope_selector: z.string().describe("CSS selector scoping the extraction (default: <body>).").optional(),
    keep_images: z
      .boolean()
      .describe("When true, download image assets into images/ and populate assets.imageMap. Default true.")
      .optional(),
  }),
  async execute(params, ctx) {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("url must start with http:// or https://")
    }

    await ctx.ask({
      permission: "webpage_extract",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url },
    })

    const outputDir = await resolveWebpageEvidenceOutputDir({ override: params.outputDir, sessionID: ctx.sessionID })

    const viewport = {
      width: params.viewport_width ?? 1440,
      height: params.viewport_height ?? 900,
    }
    const keepImages = params.keep_images ?? true
    const browserProxy = await resolveFrontendDesignBrowserProxy()

    log.info("extracting webpage", { url: params.url, outputDir })
    const captureHtmlPath = path.join(outputDir, "capture.html")

    const page = await extractPage({
      url: params.url,
      viewport,
      scopeSelector: params.scope_selector ?? null,
      waitMs: 3000,
      noScreenshots: false,
      outputDir,
      captureHtmlPath,
      downloadImages: keepImages,
      browserProxy,
      signal: ctx.abort,
      onProgress: (msg) => log.info(msg),
    })

    // Save reference screenshot as a real PNG (binary, not base64).
    const referencePath = path.join(outputDir, "reference.png")
    await writeReferencePng({ screenshotUrl: page.screenshotUrl, outputDir, referencePath })

    const mobileViewport = {
      width: params.mobile_viewport_width ?? DEFAULT_MOBILE_REFERENCE_VIEWPORT.width,
      height: params.mobile_viewport_height ?? DEFAULT_MOBILE_REFERENCE_VIEWPORT.height,
    }
    log.info("extracting mobile webpage reference", { url: params.url, outputDir, mobileViewport })
    const mobilePage = await extractPage({
      url: params.url,
      viewport: mobileViewport,
      scopeSelector: params.scope_selector ?? null,
      waitMs: 3000,
      noScreenshots: false,
      downloadImages: false,
      browserProxy,
      signal: ctx.abort,
      onProgress: (msg) => log.info(`mobile reference: ${msg}`),
    })
    const mobileReferencePath = path.join(outputDir, "reference-mobile.png")
    await writeReferencePng({ screenshotUrl: mobilePage.screenshotUrl, outputDir, referencePath: mobileReferencePath })

    const jsonPath = path.join(outputDir, "extracted-page.json")
    await fs.writeFile(jsonPath, JSON.stringify(page, null, 2), "utf8")

    const summary = {
      url: params.url,
      title: page.title,
      viewport: page.viewport,
      mobileViewport,
      referencePath,
      mobileReferencePath,
      captureHtmlPath,
      extractedPagePath: jsonPath,
      stats: page.stats,
      tokens: {
        colors: Object.keys(page.tokens.colors).length,
        fonts: page.tokens.fonts.length,
        customProperties: Object.keys(page.tokens.customProperties).length,
      },
      assets: {
        images: page.assets.images.length,
        icons: page.assets.icons.length,
        imagesDownloaded: page.assets.imageMap ? Object.keys(page.assets.imageMap).length : 0,
      },
    }

    return {
      title: `Extracted ${page.title || params.url} (${page.stats.extractedElements} elements)`,
      output: [
        `# Webpage extracted: ${page.title || "(untitled)"}`,
        "",
        `- URL: ${params.url}`,
        `- Viewport: ${page.viewport.width} × ${page.viewport.height}`,
        `- Elements: ${page.stats.extractedElements} / ${page.stats.totalElements}`,
        `- Tokens: ${summary.tokens.colors} colors, ${summary.tokens.fonts} fonts, ${summary.tokens.customProperties} CSS vars`,
        `- Assets: ${summary.assets.images} images, ${summary.assets.icons} icons` +
          (summary.assets.imagesDownloaded > 0 ? `, ${summary.assets.imagesDownloaded} downloaded` : ""),
        "",
        `**Reference screenshot:** \`${referencePath}\``,
        `**Mobile reference screenshot:** \`${mobileReferencePath}\``,
        `**HTML capture:** \`${captureHtmlPath}\``,
        `**Full extracted page JSON:** \`${jsonPath}\``,
        "",
        "Evidence acquired. Do not rerun extraction for this URL/outputDir unless the source changed. Use compact webpage evidence artifacts for frontend template synthesis; do not read `extracted-page.json` wholesale.",
      ].join("\n"),
      metadata: summary,
    }
  },
})

async function writeReferencePng(input: {
  screenshotUrl: string
  outputDir: string
  referencePath: string
}): Promise<void> {
  if (!input.screenshotUrl) {
    throw new Error(`Missing screenshot data for ${input.referencePath}`)
  }
  if (input.screenshotUrl.startsWith("data:image/png;base64,")) {
    const refBase64 = input.screenshotUrl.replace(/^data:image\/png;base64,/, "")
    await fs.writeFile(input.referencePath, Buffer.from(refBase64, "base64"))
    return
  }
  const source = path.isAbsolute(input.screenshotUrl)
    ? input.screenshotUrl
    : path.join(input.outputDir, input.screenshotUrl)
  await fs.copyFile(source, input.referencePath)
}
