/**
 * `figma_analyze` tool — wraps `mirror/figma/analyze::analyzeFigma` + the
 * shared scaffold-helpers emitters.
 *
 * Figma2code's analogue of `webpage_analyze` / `webpage_image_analyze`.
 * Reads `figma-design.json`, synthesises a `ProjectScaffold`, and writes
 * the same four artifacts URL and image flows write — `scaffold.json` /
 * `design-tokens.ts` / `App.tsx` / `shared-context.md`. The build agent's
 * downstream codegen prompt + skill text reference these exact filenames;
 * rule 22 keeps every source on one downstream contract.
 */

import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

import { Tool } from "../../tool/tool"
import { analyzeFigma } from "../figma/analyze"
import { CompressedDesignSchema } from "../ir/compressed-design"
import {
  buildSharedContext,
  generateAppFile,
  generateTokensFile,
} from "../shared/scaffold-helpers"
import { resolveMirrorOutputDir, DEFAULT_MIRROR_SUBDIR } from "./output-dir"

export const FigmaAnalyzeTool = Tool.define("figma_analyze", {
  description: `Analyze a CompressedDesign into a deterministic ProjectScaffold (sections, file contracts, design-token system). Zero LLM — the Figma REST fetch already ran in figma_extract; this stage folds its output into the same cross-source ProjectScaffold contract that webpage_analyze (URL) and webpage_image_analyze produce.

Reads \`<outputDir>/figma-design.json\` (from figma_extract). Writes the same four artifacts the URL / image analyze steps write:
  - scaffold.json           full ProjectScaffold
  - design-tokens.ts        COLORS / FONTS / SPACING / RADII constants
  - App.tsx                 auto-generated section composition (reference)
  - shared-context.md       compact token + section summary

Returns a compact summary; agent should \`read\` scaffold.json for full detail.

Artifact-dependent: do NOT call until \`figma_extract\` has finished. Never batch with figma_extract.

Step 3 of the figma2code workflow. Pure function, no network or LLM.`,
  parameters: z.object({
    outputDir: z
      .string()
      .describe(
        `Directory containing figma-design.json. Writes scaffold.json, design-tokens.ts, App.tsx, shared-context.md here. Defaults to \`${DEFAULT_MIRROR_SUBDIR}\` under the current worktree.`,
      )
      .optional(),
  }),
  async execute(params) {
    const outputDir = await resolveMirrorOutputDir(params.outputDir)
    const designPath = path.join(outputDir, "figma-design.json")

    let designText: string
    try {
      designText = await fs.readFile(designPath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Missing ${designPath}. \`figma_analyze\` depends on \`figma_extract\` output. ` +
            `Run \`figma_extract\` first and wait for it to finish before calling \`figma_analyze\`.`,
        )
      }
      throw error
    }

    const raw = JSON.parse(designText)
    const design = CompressedDesignSchema.parse(raw)
    const scaffold = analyzeFigma(design)
    const tokensFile = generateTokensFile(scaffold)
    const appFile = generateAppFile(scaffold)
    const sharedContext = buildSharedContext(scaffold, {
      url: design.figmaUrl,
      title: design.fileName,
      // CompressedDesign has no top-level viewport — synthesise one from the
      // bounding box of the first frame so shared-context's preamble has
      // something honest. Falls back to 0x0 when no frame has bounds.
      viewport: pickViewport(design),
    })

    const scaffoldPath = path.join(outputDir, "scaffold.json")
    const tokensPath = path.join(outputDir, "design-tokens.ts")
    const appPath = path.join(outputDir, "App.tsx")
    const contextPath = path.join(outputDir, "shared-context.md")

    await Promise.all([
      fs.writeFile(scaffoldPath, JSON.stringify(scaffold, null, 2), "utf8"),
      fs.writeFile(tokensPath, tokensFile.code, "utf8"),
      fs.writeFile(appPath, appFile.code, "utf8"),
      fs.writeFile(contextPath, sharedContext, "utf8"),
    ])

    const sectionList = scaffold.sections
      .map((s) => `  - ${s.name} (${s.elementCount} el, ${s.bounds.w}×${s.bounds.h}px)`)
      .join("\n")

    return {
      title: `Scaffold (figma2code) — ${scaffold.sections.length} sections, ${scaffold.tokens.colors.length} colors`,
      output: [
        `# ProjectScaffold (figma2code)`,
        "",
        `- Source: ${designPath}`,
        `- Sections: ${scaffold.sections.length}`,
        `- Tokens: ${scaffold.tokens.colors.length} colors, ${scaffold.tokens.fonts.length} fonts, ${scaffold.tokens.spacing.length} spacings, ${scaffold.tokens.radii.length} radii`,
        `- Pattern catalog: empty (figma flow surfaces explicit components / componentSets directly; see analyze.ts header).`,
        "",
        "## Sections",
        sectionList || "  (none)",
        "",
        `**Artifacts written:**`,
        `- \`${scaffoldPath}\` — full ProjectScaffold`,
        `- \`${tokensPath}\` — design tokens`,
        `- \`${appPath}\` — auto-generated App composition`,
        `- \`${contextPath}\` — compact prompt-ready summary`,
        "",
        "Next: implement the page (any tech stack), then iterate via `webpage_render` + `webpage_vision_judge` + `webpage_evaluate`.",
      ].join("\n"),
      metadata: {
        scaffoldPath,
        tokensPath,
        appPath,
        contextPath,
        sectionCount: scaffold.sections.length,
        tokenColors: scaffold.tokens.colors.length,
      },
    }
  },
})

function pickViewport(design: import("../ir/compressed-design").CompressedDesign): { width: number; height: number } {
  for (const page of design.pages) {
    for (const frame of page.frames) {
      if (frame.bounds && frame.bounds.w > 0 && frame.bounds.h > 0) {
        return { width: Math.round(frame.bounds.w), height: Math.round(frame.bounds.h) }
      }
    }
  }
  return { width: 0, height: 0 }
}
