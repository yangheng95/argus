import path from "node:path"
import { tool } from "ai"
import z from "zod"
import { Instance } from "@/project/instance"
import { generateWebCloneSkeletonProject } from "@/web-clone/skeleton-project-generator"

export function createFrontendSkeletonProjectTool() {
  return {
    create_frontend_skeleton_project: tool({
      description:
        "Create the frontend-design visual baseline project from the visible web-clone-source package. " +
        "Use this for webpage replicas before submit_frontend_template: it writes a runnable React/Vite baseline input " +
        "that extracts source HTML/CSS/assets into public/source.html and src/generated/* plus fillable slot metadata. This raw extracted project is not the frontend_design deliverable; " +
        "submit_frontend_template must also define the high-quality maintainable target project in quality_project_contract.",
      inputSchema: z.object({
        sourcePackageDir: z
          .string()
          .optional()
          .describe("Directory containing web-clone-source. Defaults to <project>/web-clone-source."),
        outputDir: z
          .string()
          .optional()
          .describe("Directory where the skeleton project is written. Defaults to <project>/frontend-design-skeleton."),
        singleFileHtmlPath: z
          .string()
          .optional()
          .describe("Optional SingleFile HTML path, absolute or relative to sourcePackageDir. Prefer SingleFile when available."),
        packageName: z.string().optional(),
        overwrite: z.boolean().optional().describe("Replace existing outputDir. Defaults to false."),
      }),
      execute: async (params) => {
        const sourcePackageDir = resolveProjectPath(params.sourcePackageDir ?? "web-clone-source")
        const outputDir = resolveProjectPath(params.outputDir ?? "frontend-design-skeleton")
        const result = await generateWebCloneSkeletonProject({
          sourcePackageDir,
          outputDir,
          singleFileHtmlPath: params.singleFileHtmlPath,
          packageName: params.packageName,
          overwrite: params.overwrite === true,
        })
        return {
          title: "Frontend visual baseline project created",
          output: [
            "# Frontend visual baseline project created",
            "",
            `- Source package: ${result.sourcePackageDir}`,
            `- Output: ${result.outputDir}`,
            `- HTML source: ${result.stats.sourceHtml}`,
            `- Files: ${result.files.length}`,
            `- Hydrated SVG paths: ${result.stats.hydratedSvgPaths}`,
            `- Copied assets: ${result.stats.copiedAssets}`,
            `- Fillable slots: ${result.stats.slotCount}`,
            ...(result.warnings.length > 0 ? ["", "Warnings:", ...result.warnings.map((item) => `- ${item}`)] : []),
          ].join("\n"),
          metadata: result,
        }
      },
    }),
  }
}

function resolveProjectPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(Instance.directory, inputPath)
}
