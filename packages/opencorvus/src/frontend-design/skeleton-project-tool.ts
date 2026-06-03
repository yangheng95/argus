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
        "The skeleton is evidence, not the target delivery project. Its outputDir must be the frontend-design-skeleton evidence directory, never the target app root such as web-clone-target. Frontend-design should use its bounded manifest/iteration sidecars to extract named source regions into the target project.",
      inputSchema: z.object({
        sourcePackageDir: z
          .string()
          .optional()
          .describe("Directory containing web-clone-source. Defaults to the task runtime source package."),
        outputDir: z
          .string()
          .optional()
          .describe("Directory where the skeleton evidence project is written. Omit this when task runtime defaults exist, or pass the frontend-design-skeleton path only. Never pass web-clone-target or any target delivery app root."),
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
            "1b. Do not move, rename, or repurpose this skeleton output as the target delivery project. The target project remains a separate app populated with `write`/`edit` from selected source regions.",
            "2. Read these bounded entry files first: `src/data/sourceProjectManifest.json`, `src/data/sourceDomIterationState.ts`, and named rows in `src/data/sourceDomReplacementPlan.ts`.",
            "3. Use `src/data/sourceDomReplacementPlan.ts` as the region queue, but locate rows by region/component name. Do not spend the next turns reading dense data sidecars wholesale. Pre-selection browsing is only for choosing the next source region: after the iteration state and candidate replacement-plan row identify a region, read that candidate component/row evidence and call `record_frontend_region_selection` immediately. The candidate component read is the last source component read before selection: do not read a second `src/components/source-dom/*` file, any `src/components/semantic/*` file, sibling semantic components, page wrappers, root package/config files, or broad source-IR/style/data inventories before selection. If the candidate is `HeaderNavigation`, do not read `FooterNavigation`, `App.tsx`, `package.json`, `tsconfig.json`, or full source-IR/style catalogs before recording the header selection. If the candidate is a large table/map/content region, do not read neighboring generated regions or global header/footer semantic components before recording that selection.",
            "4. Do not read `src/data/sourceData.ts`, `src/data/svgPaths.ts`, raw HTML, or generated CSS in full. Search or read only the current region's named data/style/asset excerpt when a replacement row points to it.",
            "5. First populate the target delivery project with a runnable skeleton-baseline app copied/adapted from this evidence project, not from memory: `package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `src/main.tsx`, the skeleton `src/App.tsx` entry wiring, baseline CSS/assets/data needed for render, and a README/source note that names the skeleton evidence source. This is the only allowed pre-region target write sequence, and it must happen before selecting a large replacement region. Do not start from an empty `web-clone-target/src` with isolated handwritten components.",
            "6. After the target baseline exists, run install/build/render evidence against the target delivery project and compare it with `reference.png`. The baseline may still contain generated source-dom modules; that is temporary source evidence copied into the target so visual parity is measurable before refactoring. Do not run build/render inside `frontend-design-skeleton`.",
            "7. Then call `record_frontend_region_selection` for the concrete source region/row you are migrating. Target writes after selection must be owned by that selected region until `record_frontend_replacement_result` is called. Populate the selected component/data/scoped-style/asset resolver and update `App.tsx` by replacing the corresponding baseline boundary, not by adding unrelated placeholder panels or future-region imports. Data modules, mock fixtures, and API adapters are part of the selected region slice; do not put records from unselected footer/economy/news/calendar/FAQ/map/chart/card/list regions into the current region's data file.",
            "8. Refactor the selected source component/row by transcribing its actual labels, numeric data, source IDs, class responsibilities, SVG paths/assets, and interaction states into target-owned modules. Do not invent simplified SVGs, approximate values, generic styling, fake spacers, or labeled placeholder boxes when the selected evidence has exact values. If the selected skeleton file is already semantic, port it faithfully first and preserve source IDs, ARIA/data attributes, wrapper nesting, asset resolver usage, viewBox/fill/size values, and helper responsibilities until render and source-audit evidence proves simplification is safe.",
            "9. After each target-project region replacement, run build/audit/render evidence against the target project: use one explicit running target URL, call `webpage_render`, compare against `reference.png` with `webpage_evaluate`, call `webpage_vision_judge` for visible theme/layout/density/control mismatches, placeholder UI, or fake spacers, repair the same region from source evidence, then record the replacement result. Do not record completed for charts, maps, tables, calendars, or other complex controls that are only labeled placeholder boxes; implement them from source data/assets plus a project component or mature library when applicable, or record blocked/deferred source debt. Start one target server only if needed; with the `bash` tool, use `background: true` and no shell `&` for that long-lived server so `webpage_render` can reach it after the tool call returns. Do not try multiple dev/preview/Python/Vite servers or use `skill`/shell output as visual evidence.",
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
