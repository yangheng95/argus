/**
 * `figma_extract` tool — wraps `mirror/figma/fetch-tree::fetchFigmaTree`.
 *
 * Figma2code's analogue of `webpage_extract`. Fetches a Figma file (or a
 * sub-tree via `nodeId`) via the Figma REST API, exports rendered PNGs for
 * exportable nodes, and writes a `CompressedDesign` to disk plus a canonical
 * `reference.png` (the first rendered frame — visual target for the
 * downstream render/evaluate/vision-judge loop).
 *
 * Tool wrapper only: input parsing + artifact persistence + image download.
 * The algorithm is `mirror/figma/fetch-tree.ts`.
 *
 * Requires `FIGMA_API_TOKEN` in env (or `token` parameter). Falls loudly
 * (typed `MirrorFigmaFetchError`) when missing — rule 1 no silent fallback.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { Log } from "../../util/log"
import { fetchFigmaTree } from "../figma/fetch-tree"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

const log = Log.create({ service: "mirror.tool.figma_extract" })

export const FigmaExtractTool = Tool.define("figma_extract", {
  description: `Fetch a Figma file (or sub-tree by nodeId) via the Figma REST API and emit a CompressedDesign IR + canonical reference screenshot. Step 1 of the figma2code workflow.

Writes to the output directory (defaults to \`mirror/\` under the worktree):
  - figma-design.json   the full CompressedDesign (frames + tokens + components + images map)
  - reference.png       the first rendered frame — visual target for downstream render/evaluate/vision-judge

Returns a compact summary (pages, frame count, token counts, image-export count). The agent should \`read\` figma-design.json or call \`figma_compile\` next; do NOT inline the design tree in chat context.

Authentication: requires FIGMA_API_TOKEN environment variable, or pass \`token\` explicitly. Throws a typed MirrorFigmaFetchError when the token is missing or the URL is malformed.`,
  parameters: z.object({
    figma_url: z
      .string()
      .describe("Figma file URL (https://figma.com/file/... or /design/...) or raw file key."),
    node_id: z
      .string()
      .describe("Optional explicit node id (overrides one parsed from the URL).")
      .optional(),
    token: z
      .string()
      .describe("Figma Personal Access Token. Defaults to FIGMA_API_TOKEN env.")
      .optional(),
    outputDir: z
      .string()
      .describe(
        `Directory to write artifacts. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree (matching webpage_extract / webpage_image_extract).`,
      )
      .optional(),
    depth: z
      .number()
      .int()
      .positive()
      .describe("Max compression depth (default 15).")
      .optional(),
    no_images: z
      .boolean()
      .describe("Skip exporting node PNGs from Figma. Default false (images exported up to max_images).")
      .optional(),
    max_images: z
      .number()
      .int()
      .positive()
      .describe("Maximum image-export count. Default 60.")
      .optional(),
    image_scale: z
      .number()
      .min(1)
      .max(4)
      .describe("PNG render scale (1-4). Default 2.")
      .optional(),
  }),
  async execute(params, ctx) {
    const outputDir = await resolveMirrorOutputDir(params.outputDir)

    log.info("fetching figma tree", {
      figmaUrl: params.figma_url,
      nodeId: params.node_id,
      outputDir,
    })

    const design = await fetchFigmaTree({
      figmaUrl: params.figma_url,
      nodeId: params.node_id,
      token: params.token,
      depth: params.depth,
      noImages: params.no_images,
      maxImages: params.max_images,
      imageScale: params.image_scale,
      signal: ctx.abort,
      onProgress: (msg) => log.info(msg),
    })

    const designPath = path.join(outputDir, "figma-design.json")
    await fs.writeFile(designPath, JSON.stringify(design, null, 2), "utf8")

    // Pick a canonical reference image: first entry in design.images. Figma's
    // image map keys nodes by id; values are remote URLs. Download to
    // `mirror/reference.png` so the existing webpage_render/evaluate loop
    // finds the same path layout the URL flow uses.
    let referencePath: string | undefined
    const imageEntries = Object.entries(design.images)
    if (imageEntries.length > 0) {
      const [, firstUrl] = imageEntries[0]
      try {
        const res = await fetch(firstUrl, { signal: ctx.abort })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        referencePath = path.join(outputDir, "reference.png")
        await fs.writeFile(referencePath, buf)
      } catch (err) {
        // Surface but do not throw — downstream tools will fail loudly if
        // they need reference.png and it's missing. Logging here keeps the
        // root cause visible without poisoning the figma_extract result
        // which DID succeed at fetching the design.
        log.warn("failed to download canonical reference image from Figma — downstream visual gate may fail", {
          firstUrl,
          err: err instanceof Error ? err.message : String(err),
        })
        referencePath = undefined
      }
    }

    const totalFrames = design.pages.reduce((sum, p) => sum + p.frames.length, 0)
    const summary = {
      figmaUrl: design.figmaUrl,
      fileName: design.fileName,
      designPath,
      referencePath,
      pages: design.pages.length,
      frames: totalFrames,
      images: imageEntries.length,
      stats: design.stats,
      tokens: {
        colors: Object.keys(design.tokens.colors).length,
        fonts: design.tokens.fonts.length,
        textStyles: design.tokens.textStyles.length,
        effects: design.tokens.effects.length,
      },
      components: Object.keys(design.components).length,
    }

    return {
      title: `Figma extracted ${design.fileName} (${totalFrames} frames, ${summary.tokens.colors} colors)`,
      output: [
        `# Figma design extracted: ${design.fileName}`,
        "",
        `- File: ${design.figmaUrl}`,
        `- Last modified: ${design.lastModified}`,
        `- Pages: ${design.pages.length}, frames: ${totalFrames}`,
        `- Tokens: ${summary.tokens.colors} colors, ${summary.tokens.fonts} fonts, ${summary.tokens.textStyles} text styles, ${summary.tokens.effects} effects`,
        `- Components: ${summary.components}`,
        `- Images exported: ${imageEntries.length}` + (referencePath ? ` (reference saved at \`${referencePath}\`)` : " (download failed — no reference.png)"),
        "",
        `**Design JSON:** \`${designPath}\``,
        referencePath ? `**Reference image:** \`${referencePath}\`` : "_Reference image unavailable — visual judge will fail without it._",
        "",
        "Next: call `figma_compile` to get compact XML IR, then `figma_analyze` for the ProjectScaffold.",
      ].join("\n"),
      metadata: summary,
    }
  },
})
