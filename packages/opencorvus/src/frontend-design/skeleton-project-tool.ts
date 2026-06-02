import path from "node:path"
import { tool } from "ai"
import z from "zod"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { generateWebCloneSourceProject } from "@/web-clone/source-project-generator"

export interface FrontendSkeletonProjectToolEvent {
  name: "create_frontend_skeleton_project"
  status: "started" | "passed" | "failed"
  details?: Record<string, unknown>
}

export function createFrontendSkeletonProjectTool(options: {
  taskID?: string
  onToolEvent?: (event: FrontendSkeletonProjectToolEvent) => void
} = {}) {
  return {
    create_frontend_skeleton_project: tool({
      description:
        "Create the frontend-design editable source skeleton from the task-runtime web-clone-source package. " +
        "Use this for webpage replicas before submit_frontend_template: it writes a runnable React/Vite source project with JSX generated from source-skeleton, sourceData arrays, CSS sidecars, and asset references. " +
        "The skeleton is evidence, not the target delivery project. Frontend-design should use its bounded manifest/iteration sidecars to extract named source regions into the target project.",
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
        options.onToolEvent?.({
          name: "create_frontend_skeleton_project",
          status: "started",
          details: {
            sourcePackageDir: params.sourcePackageDir,
            outputDir: params.outputDir,
          },
        })
        const defaults = options.taskID ? ProjectRuntimePaths.frontendDesignPaths(Instance.directory, options.taskID) : undefined
        const sourcePackageDir = resolveProjectPath(params.sourcePackageDir ?? requireTaskRuntimeDefault(defaults?.sourcePackageAbsolute, "sourcePackageDir"))
        const outputDir = resolveProjectPath(params.outputDir ?? requireTaskRuntimeDefault(defaults?.skeletonProjectAbsolute, "outputDir"))
        let result: Awaited<ReturnType<typeof generateWebCloneSourceProject>>
        try {
          result = await generateWebCloneSourceProject({
            mirrorDir: sourcePackageDir,
            outputDir,
            packageName: params.packageName,
            overwrite: params.overwrite === true,
          })
        } catch (error) {
          options.onToolEvent?.({
            name: "create_frontend_skeleton_project",
            status: "failed",
            details: { error: error instanceof Error ? error.message : String(error) },
          })
          throw error
        }
        options.onToolEvent?.({
          name: "create_frontend_skeleton_project",
          status: "passed",
          details: {
            sourcePackageDir: result.mirrorDir,
            outputDir: result.outputDir,
            files: result.files.length,
            stats: result.stats,
          },
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
            "",
            "## Bounded next action for frontend_design",
            "",
            "1. Treat this skeleton as read-only evidence. Do not install, build, render, or edit inside this output directory as the final project.",
            "2. Read these bounded entry files first: `src/data/sourceProjectManifest.json`, `src/data/sourceDomIterationState.ts`, and named rows in `src/data/sourceDomReplacementPlan.ts`.",
            "3. Use `src/data/sourceDomReplacementPlan.ts` as the region queue, but locate rows by region/component name. Do not spend the next turns reading dense data sidecars wholesale.",
            "4. Do not read `src/data/sourceData.ts`, `src/data/svgPaths.ts`, raw HTML, or generated CSS in full. Search or read only the current region's named data/style/asset excerpt when a replacement row points to it.",
            "5. Before writing target project source, call `record_frontend_region_selection` for the concrete source region/row you are migrating. Target writes without a recorded source region are off-track.",
            "6. Populate target source files next for that selected region. The next target-project filesystem-changing operation should be a source vertical-slice file write (`src/App.tsx` or a semantic component/data/style/asset module), not `bash mkdir`, `index.html`, `package.json`, `tsconfig.json`, or bundler config. The write tool creates parent directories for new files; do not begin the target project with directory-only setup or root config. One region selection covers only that selected region's data/component/style/assets/App wiring; record a replacement result and call `record_frontend_region_selection` again before writing another region. Data modules, mock fixtures, and API adapters are part of the selected region slice; do not put records from unselected footer/economy/news/calendar/FAQ/map/chart/card/list regions into the current region's data file. App wiring belongs to the same slice: import and mount only the selected region component plus previously completed region components, leaving future region slots as comments/placeholders without imports. Cross-region combined data files belong after the included regions each have a completed replacement result. Do not write imports for components/data/style modules that you are not creating in the same pass.",
            "7. Do not run install/build/render/dev-server commands yet. Package-manager commands start only after `src/App.tsx`, at least one semantic component, one data/mock module, and one style module exist in the target project.",
            "8. Treat root config files (`package.json`, `tsconfig.json`, bundler config) as late integration edits. Do not write/edit root config during the source-coverage pass. Read each existing config file immediately before editing it, after source coverage exists.",
            "9. After each target-project region replacement, run build/audit/render evidence against the target project and record the replacement result.",
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
