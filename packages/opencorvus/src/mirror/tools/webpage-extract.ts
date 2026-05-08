/**
 * `webpage_extract` tool — wraps `mirror/url/extract::extractPage`.
 *
 * Launches a headless browser, pulls the DOM tree + computed styles + full-
 * page screenshot, and writes four artifacts to the worktree:
 *   - `<outputDir>/reference.png`          reference screenshot (binary)
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
import { extractPage } from "../url/extract"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

const log = Log.create({ service: "mirror.tool.webpage_extract" })

export const WebpageExtractTool = Tool.define("webpage_extract", {
  description:
    `Extract a live webpage via headless Chrome. Captures the DOM tree, ~33 computed CSS properties per element, and a full-page PNG screenshot.

Writes to the output directory (defaults to the worktree):
  - reference.png                the reference screenshot — visual target for later scoring
  - extracted-page.json          the full ExtractedPage object (DOM + tokens + assets)
  - images/*                     downloaded image assets (so the clone can reference local paths)

Returns a compact summary (title, viewport, element count, artifact paths). The design-analysis agent should call \`webpage_compile\` and \`webpage_analyze\`, then use \`page-ir.xml\`, \`shared-context.md\`, and the tool summaries as its prompt-facing evidence. \`extracted-page.json\` is the raw source artifact for deterministic tools and the evidence manifest; do not read it wholesale into prompt context.

Use this as step 1 of the design-analysis webpage PRD/SPEC workflow. Requires network access to the target URL.`,
  parameters: z.object({
    url: z.string().describe("The webpage to extract. Must start with http:// or https://."),
    outputDir: z
      .string()
      .describe(
        `Directory to write artifacts. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree so mirror artifacts (reference.png, extracted-page.json, images/) stay out of the project source tree. Override with an absolute or worktree-relative path when a different layout is needed.`,
      )
      .optional(),
    viewport_width: z.number().int().positive().describe("Viewport width in logical pixels. Default 1440.").optional(),
    viewport_height: z.number().int().positive().describe("Viewport height in logical pixels. Default 900.").optional(),
    scope_selector: z
      .string()
      .describe("CSS selector scoping the extraction (default: <body>).")
      .optional(),
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

    const outputDir = await resolveMirrorOutputDir(params.outputDir)

    const viewport = {
      width: params.viewport_width ?? 1440,
      height: params.viewport_height ?? 900,
    }
    const keepImages = params.keep_images ?? true

    log.info("extracting webpage", { url: params.url, outputDir })

    const page = await extractPage({
      url: params.url,
      viewport,
      scopeSelector: params.scope_selector ?? null,
      waitMs: 3000,
      noScreenshots: false,
      outputDir: keepImages ? outputDir : undefined,
      signal: ctx.abort,
      onProgress: (msg) => log.info(msg),
    })

    // Save reference screenshot as a real PNG (binary, not base64).
    const referencePath = path.join(outputDir, "reference.png")
    const refBase64 = page.screenshotUrl.replace(/^data:image\/png;base64,/, "")
    await fs.writeFile(referencePath, Buffer.from(refBase64, "base64"))

    const jsonPath = path.join(outputDir, "extracted-page.json")
    await fs.writeFile(jsonPath, JSON.stringify(page, null, 2), "utf8")

    const summary = {
      url: params.url,
      title: page.title,
      viewport: page.viewport,
      referencePath,
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
        `**Full extracted page JSON:** \`${jsonPath}\``,
        "",
        "Next: call `webpage_compile`, then `webpage_analyze`, then read `page-ir.xml`, `shared-context.md`, and bounded scaffold details before writing the PRD/SPEC. Do not read `extracted-page.json` wholesale.",
      ].join("\n"),
      metadata: summary,
    }
  },
})
