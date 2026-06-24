import path from "node:path"
import z from "zod"
import { Instance } from "../project/instance"
import { Tool } from "./tool"
import { generateWebCloneSourceProject } from "../web-clone/source-project-generator"

export const WebCloneGenerateSourceProjectTool = Tool.define("web_clone_generate_source_project", {
  description: `Generate an editable React source skeleton from a web-clone-source handoff.

It writes framework components, sourceData arrays, CSS sidecars, copied assets, and reference.png from source-skeleton/source-IR. It does not render reference.png, replay screenshots, inline base64, inject raw HTML, or re-extract webpages. Downstream agents should preserve the generated CSS sidecars and refine the generated React modules in place as traceable source-region evidence. Use source evidence review and task-scoped preview screenshot inspection after generation.`,
  parameters: z.object({
    webpageEvidenceDir: z
      .string()
      .describe(
        "Directory containing source-skeleton/, source-ir/, assets/, and reference.png. Defaults to <execution directory>/web-clone-source.",
      )
      .optional(),
    outputDir: z
      .string()
      .describe(
        "Directory where the editable React project should be written. Defaults to <execution directory>/web-clone-source-project.",
      )
      .optional(),
    packageName: z.string().describe("Optional package name for the generated React project.").optional(),
    overwrite: z.boolean().describe("Replace an existing non-empty output directory. Defaults to false.").optional(),
  }),
  async execute(params) {
    const webpageEvidenceDir = resolveInputPath(
      params.webpageEvidenceDir ?? path.join(Instance.directory, "web-clone-source"),
    )
    const outputDir = resolveInputPath(params.outputDir ?? path.join(Instance.directory, "web-clone-source-project"))
    const result = await generateWebCloneSourceProject({
      webpageEvidenceDir,
      outputDir,
      packageName: params.packageName,
      overwrite: params.overwrite === true,
    })

    const output = [
      "# Web clone source project generated",
      "",
      `- Framework: ${result.framework}`,
      `- Source package: ${result.webpageEvidenceDir}`,
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
      `- Visual iteration matrix: ${result.visualIterationMatrix}`,
      "",
      "Next checks:",
      "- Review generated source against the source package evidence.",
      "- Build/run the project and inspect task-scoped preview screenshots against web-clone-source/reference.png.",
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
