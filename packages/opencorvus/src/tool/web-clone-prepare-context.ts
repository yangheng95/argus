import path from "node:path"
import z from "zod"
import { Instance } from "../project/instance"
import { Tool } from "./tool"
import { prepareWebCloneContext } from "../web-clone/context"

export const WebClonePrepareContextTool = Tool.define("web_clone_prepare_context", {
  description: `Prepare a visible, mandatory webpage-clone source package from an existing mirror handoff.

This is a same-worktree host repair tool. It reads the current project/worktree's webpage-evidence/source-skeleton, webpage-evidence/source-ir, and webpage-evidence/assets summaries (legacy mirror/ paths are accepted only as compatibility aliases), then writes a project-root web-clone-source/ handoff containing implementation-blueprint.md, web-clone-context.md, web-clone-implementation-contract.json, source-skeleton/, source-ir/, reference.png, and reusable asset sidecars. Do not use it to chase primary-project paths, sibling worktrees, or absolute external directories. It does not re-extract webpages and does not generate application source.`,
  parameters: z.object({
    mirrorDir: z
      .string()
      .describe("Directory containing reference.png, source-skeleton/, source-ir/, and optional assets/. Defaults to <execution directory>/mirror.")
      .optional(),
    outputDir: z
      .string()
      .describe("Directory where the visible web-clone source package should be written. Defaults to <execution directory>/web-clone-source.")
      .optional(),
  }),
  async execute(params) {
    const mirrorDir = resolveInputPath(params.mirrorDir ?? path.join(Instance.directory, "mirror"))
    const outputDir = params.outputDir
      ? resolveOutputPath(params.outputDir)
      : path.join(path.dirname(mirrorDir), "web-clone-source")
    assertInsideProject(mirrorDir, "mirrorDir")
    assertInsideProject(outputDir, "outputDir")
    const result = await prepareWebCloneContext({ mirrorDir, outputDir })
    const output = [
      "# Web clone context prepared",
      "",
      `- Mirror: ${result.mirrorDir}`,
      `- Visible source package: ${result.sourcePackageDir}`,
      `- Start here: ${result.sourceReadmePath}`,
      `- Context: ${result.contextPath}`,
      `- Contract: ${result.contractPath}`,
      `- Materialized files: ${result.materializedFiles.length}`,
      `- Components: ${result.stats.components}`,
      `- Tables: ${result.stats.tables}`,
      `- Lists: ${result.stats.lists}`,
      `- Cards: ${result.stats.cards}`,
      `- Repeated groups: ${result.stats.repeatedGroups}`,
      `- Style tokens: ${result.stats.styleTokens}`,
      `- Interaction hints: ${result.stats.interactionHints}`,
      `- Asset refs: ${result.stats.assets}`,
      `- Source skeleton audit passed: ${result.stats.sourceSkeletonAuditPassed ?? "unknown"}`,
      `- Source IR audit passed: ${result.stats.sourceQualityAuditPassed ?? "unknown"}`,
    ].join("\n")

    return {
      title: "Web clone context prepared",
      output,
      metadata: result,
    }
  },
})

function resolveInputPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(Instance.worktree, inputPath)
}

function resolveOutputPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(Instance.directory, inputPath)
}

function assertInsideProject(targetPath: string, label: string): void {
  const root = path.resolve(Instance.directory)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the current project directory: ${target}`)
  }
}
