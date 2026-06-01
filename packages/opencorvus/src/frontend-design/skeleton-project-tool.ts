import path from "node:path"
import { tool } from "ai"
import z from "zod"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { generateWebCloneSourceProject } from "@/web-clone/source-project-generator"

export function createFrontendSkeletonProjectTool(options: { taskID?: string } = {}) {
  return {
    create_frontend_skeleton_project: tool({
      description:
        "Create the frontend-design editable source skeleton from the task-runtime web-clone-source package. " +
        "Use this for webpage replicas before submit_frontend_template: it writes a runnable React/Vite source project with JSX generated from source-skeleton, sourceData arrays, CSS sidecars, and asset references. " +
        "Downstream Build should copy/adapt this source skeleton as the implementation starting point and refine named modules in place.",
      inputSchema: z.object({
        sourcePackageDir: z
          .string()
          .optional()
          .describe("Directory containing web-clone-source. Defaults to the task runtime source package."),
        outputDir: z
          .string()
          .optional()
          .describe("Directory where the skeleton project is written. Defaults to the task runtime frontend-design-skeleton directory."),
        singleFileHtmlPath: z
          .string()
          .optional()
          .describe("Deprecated compatibility field. The source skeleton generator consumes web-clone-source/source-skeleton and ignores SingleFile HTML."),
        packageName: z.string().optional(),
        overwrite: z.boolean().optional().describe("Replace existing outputDir. Defaults to false."),
      }),
      execute: async (params) => {
        const defaults = options.taskID ? ProjectRuntimePaths.frontendDesignPaths(Instance.directory, options.taskID) : undefined
        const sourcePackageDir = resolveProjectPath(params.sourcePackageDir ?? requireTaskRuntimeDefault(defaults?.sourcePackageAbsolute, "sourcePackageDir"))
        const outputDir = resolveProjectPath(params.outputDir ?? requireTaskRuntimeDefault(defaults?.skeletonProjectAbsolute, "outputDir"))
        const result = await generateWebCloneSourceProject({
          mirrorDir: sourcePackageDir,
          outputDir,
          packageName: params.packageName,
          overwrite: params.overwrite === true,
        })
        return {
          title: "Frontend source skeleton project created",
          output: [
            "# Frontend source skeleton project created",
            "",
            `- Source package: ${result.mirrorDir}`,
            `- Output: ${result.outputDir}`,
            `- Files: ${result.files.length}`,
            `- Text signals: ${result.stats.textSignalCount}`,
            `- Components: ${result.stats.componentCount}`,
            `- Tables: ${result.stats.tableCount}`,
            `- Lists: ${result.stats.listCount}`,
            `- Cards: ${result.stats.cardCount}`,
            `- Asset references: ${result.stats.assetRefCount}`,
            `- CSS sidecars: ${result.stats.copiedCssFiles}`,
          ].join("\n"),
          metadata: result,
        }
      },
    }),
  }
}

function requireTaskRuntimeDefault(value: string | undefined, field: string): string {
  if (value) return value
  throw new Error(`create_frontend_skeleton_project requires taskID-scoped runtime paths when ${field} is omitted`)
}

function resolveProjectPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(Instance.directory, inputPath)
}
