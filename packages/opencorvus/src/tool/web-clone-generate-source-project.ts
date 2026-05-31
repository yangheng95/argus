import path from "node:path"
import z from "zod"
import { Instance } from "../project/instance"
import { Tool } from "./tool"
import { generateWebCloneSourceProject } from "../web-clone/source-project-generator"

export const WebCloneGenerateSourceProjectTool = Tool.define("web_clone_generate_source_project", {
  description: `Diagnostic-only generator for inspecting whether a web-clone-source handoff contains enough structure to synthesize editable React code.

Do not use this as a normal Build deliverable path. Webpage replica delivery must implement the target project directly from the visible web-clone-source/ package. This tool is for operator-requested diagnostics and benchmarks only; it writes a separate React sample with framework components, sourceData arrays, and CSS sidecars from the skeleton/IR. It does not render reference.png, replay screenshots, inline base64, inject raw HTML, or re-extract webpages. Run web_clone_source_audit and visual screenshot evaluation after generation before interpreting diagnostic quality.`,
  parameters: z.object({
    mirrorDir: z
      .string()
      .describe("Directory containing source-skeleton/, source-ir/, assets/, and reference.png. Defaults to <execution directory>/web-clone-source.")
      .optional(),
    outputDir: z
      .string()
      .describe("Directory where the editable React project should be written. Defaults to <execution directory>/web-clone-source-project.")
      .optional(),
    packageName: z
      .string()
      .describe("Optional package name for the generated React project.")
      .optional(),
    overwrite: z
      .boolean()
      .describe("Replace an existing non-empty output directory. Defaults to false.")
      .optional(),
  }),
  async execute(params) {
    const mirrorDir = resolveInputPath(params.mirrorDir ?? path.join(Instance.directory, "web-clone-source"))
    const outputDir = resolveInputPath(params.outputDir ?? path.join(Instance.directory, "web-clone-source-project"))
    const result = await generateWebCloneSourceProject({
      mirrorDir,
      outputDir,
      packageName: params.packageName,
      overwrite: params.overwrite === true,
    })

    const output = [
      "# Web clone source project generated",
      "",
      `- Framework: ${result.framework}`,
      `- Source package: ${result.mirrorDir}`,
      `- Output: ${result.outputDir}`,
      `- Files: ${result.files.length}`,
      `- Text signals: ${result.stats.textSignalCount}`,
      `- Components: ${result.stats.componentCount}`,
      `- Tables: ${result.stats.tableCount}`,
      `- Lists: ${result.stats.listCount}`,
      `- Cards: ${result.stats.cardCount}`,
      `- Repeated groups: ${result.stats.repeatedGroupCount}`,
      `- Asset references: ${result.stats.assetRefCount}`,
      `- CSS sidecars: ${result.stats.copiedCssFiles}`,
      "",
      "Next gates:",
      `- Run web_clone_source_audit with projectDir=${result.outputDir} and sourcePackageDir=${result.mirrorDir}.`,
      "- Build/run the project, render a screenshot, and compare against web-clone-source/reference.png with the visual evaluator.",
    ].join("\n")

    return {
      title: "Web clone source project generated",
      output,
      metadata: result,
    }
  },
})

function resolveInputPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(Instance.worktree, inputPath)
}
