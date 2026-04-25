/**
 * `webpage_compile_html` tool — deterministically compiles a static
 * `index.html` from `mirror/extracted-page.json` (produced by
 * `webpage_extract`) plus the local image assets the extractor downloaded.
 *
 * Replaces the previous "agent hand-writes index.html from a screenshot"
 * step. The mirror toolchain already extracts the authoritative DOM tree
 * + computed styles + image map; this tool replays it as inline-styled
 * HTML. No LLM, no network, no JS framework — pure transformation.
 *
 * Layout:
 *   <worktree>/index.html      ← compiled deliverable
 *   <worktree>/images/         ← copy of mirror/images/ (img src remap target)
 *
 * Side-effect: copies `<outputDir>/images/` to `<worktree>/images/` so the
 * remapped relative paths in the compiled HTML resolve when `webpage_render`
 * serves the worktree root over the loopback server.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { Instance } from "../../project/instance"
import { Log } from "../../util/log"
import { compileExtractedPageToHtml } from "../url/compile-html"
import { ExtractedPageSchema } from "../ir/extracted-page"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

const log = Log.create({ service: "mirror.tool.webpage_compile_html" })

export const WebpageCompileHtmlTool = Tool.define("webpage_compile_html", {
  description: `Deterministically compile a static \`index.html\` clone from the mirror toolchain output.

Reads \`<mirrorDir>/extracted-page.json\` (from \`webpage_extract\`) and replays the DOM tree as inline-styled HTML. Promotes \`<mirrorDir>/images/\` to \`<targetDir>/images/\` so the compiled HTML's relative \`src\` paths resolve when served.

Use this BEFORE any manual editing — the compiled HTML is the high-fidelity baseline. After compile, run \`webpage_render\` + \`webpage_evaluate\`; only edit \`index.html\` directly when evaluation surfaces a specific gap (missing text, color drift, image swap). Do NOT hand-write the clone from scratch.

No LLM, no JavaScript frameworks, no network — pure transformation of the extracted DOM.`,
  parameters: z.object({
    mirrorDir: z
      .string()
      .describe(
        `Directory containing \`extracted-page.json\` and \`images/\`. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree.`,
      )
      .optional(),
    targetDir: z
      .string()
      .describe(
        "Directory to write the compiled `index.html` and `images/` into. Defaults to the current worktree root (where `webpage_render` and `webpage_text_diff` look by default).",
      )
      .optional(),
    title: z
      .string()
      .describe("Override the document `<title>`. Defaults to the title captured by `webpage_extract`.")
      .optional(),
  }),
  async execute(params) {
    const mirrorDir = await resolveMirrorOutputDir(params.mirrorDir)
    const targetDir = params.targetDir
      ? path.resolve(Instance.directory, params.targetDir)
      : Instance.directory

    const extractedPath = path.join(mirrorDir, "extracted-page.json")
    let raw: unknown
    try {
      raw = JSON.parse(await fs.readFile(extractedPath, "utf8"))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing ${extractedPath}. \`webpage_compile_html\` depends on \`webpage_extract\` output. ` +
            `Run \`webpage_extract\` first.`,
        )
      }
      throw err
    }
    const page = ExtractedPageSchema.parse(raw)

    const html = compileExtractedPageToHtml(page, { title: params.title })
    const indexPath = path.join(targetDir, "index.html")
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(indexPath, html, "utf8")

    // Promote mirror/images/ → <targetDir>/images/. Best-effort: if the
    // extractor was run with keep_images=false the mirror folder has no
    // images/ subdir and the compiled HTML's <img> tags will still point
    // at the original remote URLs — the agent can call webpage_extract
    // again with keep_images=true if local assets are required.
    const sourceImages = path.join(mirrorDir, "images")
    const targetImages = path.join(targetDir, "images")
    let copied = 0
    try {
      const entries = await fs.readdir(sourceImages, { withFileTypes: true })
      await fs.mkdir(targetImages, { recursive: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const src = path.join(sourceImages, entry.name)
        const dst = path.join(targetImages, entry.name)
        await fs.copyFile(src, dst)
        copied += 1
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }

    log.info("compiled HTML", {
      indexPath,
      bytes: html.length,
      imagesCopied: copied,
      elements: page.stats.extractedElements,
    })

    return {
      title: `Compiled index.html (${page.stats.extractedElements} elements, ${copied} images)`,
      output: [
        `# Compiled HTML`,
        ``,
        `- Source: \`${extractedPath}\``,
        `- Output: \`${indexPath}\` (${html.length.toLocaleString()} bytes)`,
        `- Images copied: ${copied} → \`${targetImages}\``,
        `- Elements: ${page.stats.extractedElements} / ${page.stats.totalElements}`,
        ``,
        `Next: call \`webpage_render\` then \`webpage_evaluate\` to score against \`reference.png\`. Only edit \`index.html\` if the score gap maps to a specific surfaced issue.`,
      ].join("\n"),
      metadata: {
        indexPath,
        targetDir,
        bytes: html.length,
        imagesCopied: copied,
      },
    }
  },
})
