import path from "node:path"
import { tool } from "ai"
import z from "zod"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { taskPrimaryProjectRoot } from "@/project/task-runtime-root"
import { generateWebCloneSourceProject } from "@/web-clone/source-project-generator"

export interface FrontendSkeletonProjectToolEvent {
  name: "create_frontend_skeleton_project"
  status: "started" | "passed" | "failed"
  details?: Record<string, unknown>
}

export function createFrontendSkeletonProjectTool(
  options: {
    taskID?: string
    onToolEvent?: (event: FrontendSkeletonProjectToolEvent) => void
  } = {},
) {
  return {
    create_frontend_skeleton_project: tool({
      description:
        "Create the frontend-design editable source skeleton from the task-runtime web-clone-source package. " +
        "Use this for webpage replicas before submit_frontend_template: it writes a runnable React/Vite source project with JSX generated from source-skeleton, sourceData arrays, CSS sidecars, and asset references. " +
        "The skeleton is captured source evidence, not the visual HTML skeleton or target acceptance project. Its outputDir must be the frontend-design-skeleton evidence directory, never the target app root such as web-clone-target. Frontend-design should use its bounded manifest/iteration sidecars to restore named source regions into a separate static HTML/CSS visual skeleton.",
      inputSchema: z.object({
        sourcePackageDir: z
          .string()
          .optional()
          .describe("Directory containing web-clone-source. Defaults to the task runtime source package."),
        outputDir: z
          .string()
          .optional()
          .describe(
            "Directory where the skeleton evidence project is written. Omit this when task runtime defaults exist, or pass the frontend-design-skeleton path only. Never pass web-clone-target or any target acceptance app root.",
          ),
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
        const projectRoot = options.taskID
          ? taskPrimaryProjectRoot(options.taskID, { activeProjectID: Instance.project.id })
          : Instance.directory
        const defaults = options.taskID
          ? ProjectRuntimePaths.frontendDesignPaths(projectRoot, options.taskID)
          : undefined
        const sourcePackageDir = resolveProjectPath(
          params.sourcePackageDir ?? requireTaskRuntimeDefault(defaults?.sourcePackageAbsolute, "sourcePackageDir"),
          projectRoot,
        )
        const outputDir = resolveSkeletonOutputDir(
          {
            requested: params.outputDir,
            defaultOutputDir: defaults?.skeletonProjectAbsolute,
          },
          projectRoot,
        )
        let result: Awaited<ReturnType<typeof generateWebCloneSourceProject>>
        try {
          result = await generateWebCloneSourceProject({
            webpageEvidenceDir: sourcePackageDir,
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
            sourcePackageDir: result.webpageEvidenceDir,
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
            `- Source package: ${result.webpageEvidenceDir}`,
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
            "1b. Do not move, rename, or repurpose this skeleton output as the visual HTML skeleton or target acceptance project. The visual skeleton remains a separate static HTML/CSS artifact populated with `write`/`edit` from selected source regions.",
            "2. Read these bounded entry files first: `src/data/sourceProjectManifest.json`, `src/data/sourceDomIterationState.ts`, and named rows in `src/data/sourceDomReplacementPlan.ts`.",
            "3. Use `src/data/sourceDomReplacementPlan.ts` as the region queue, but locate rows by region/component name. Do not spend the next turns reading dense data sidecars wholesale. Pre-selection browsing is only for choosing the next source region: after the iteration state and candidate replacement-plan row identify a region, read that candidate component/row evidence and call `record_frontend_region_selection` immediately. The candidate component read is the last source component read before selection: do not read a second `src/components/source-dom/*` file, any `src/components/semantic/*` file, sibling semantic components, page wrappers, root package/config files, or broad source-IR/style/data inventories before selection. If the candidate is `HeaderNavigation`, do not read `FooterNavigation`, `App.tsx`, `package.json`, `tsconfig.json`, or full source-IR/style catalogs before recording the header selection. If the candidate is a large table/map/content region, do not read neighboring generated regions or global header/footer semantic components before recording that selection.",
            "4. Do not read `src/data/sourceData.ts`, `src/data/svgPaths.ts`, raw HTML, or generated CSS in full. Search or read only the current region's named data/style/asset excerpt when a replacement row points to it.",
            "5. First populate the visual HTML skeleton with source-editable static HTML/CSS/assets copied or adapted from this evidence project and `web-clone-source`, not from memory: `visual-html-skeleton/index.html`, `visual-html-skeleton/styles/tokens.css`, layout/region CSS files, asset references, representative-state markup, screenshots/diff artifacts when available, and a README/source note that names the skeleton evidence source. This is the required pre-region visual write sequence, and it must happen before selecting a large replacement region. Do not start from an empty app scaffold with isolated handwritten components, compiled app output, raw source DOM dumps, iframe previews, or screenshot wrappers.",
            "5b. Extract visual tokens before broad region styling. Use `web-clone-source/source-ir/style-tokens.json`, `web-clone-source/source-ir/style-profile.json`, selected `layout-map.json` regions, `source-skeleton/critical.css`, and visible reference pixels to define role-based CSS variables for colors, typography, spacing/density, radii, borders, shadows, media/icon sizes, chart/table/map ranges, and source-backed desktop layout widths. Region CSS should consume `tokens.css`; record any source-backed exceptions in the final report.",
            "6. After the visual skeleton baseline exists, render it through one explicit static URL or file path and compare it with `reference.png`. Do not run build/render inside `frontend-design-skeleton` as the final deliverable.",
            "7. Then call `record_frontend_region_selection` for the concrete source region/row you are restoring. Skeleton writes after selection must be owned by that selected region until `record_frontend_replacement_result` is called. Populate the selected HTML/CSS/assets/content slice by replacing the corresponding visual boundary, not by adding unrelated placeholder panels or future-region imports. Data/content snippets are part of the selected region slice; do not put records from unselected footer/economy/news/calendar/FAQ/map/chart/card/list regions into the current region's data/content file.",
            "8. Restore the selected source component/row by transcribing its actual labels, numeric data, source IDs, class responsibilities, SVG paths/assets, and interaction-state visuals into the HTML skeleton. Do not invent simplified SVGs, approximate values, generic styling, fake spacers, or labeled placeholder boxes when the selected evidence has exact values. If the selected skeleton file is already semantic, use it as source evidence first and preserve source IDs, ARIA/data attributes, wrapper nesting, asset resolver usage, viewBox/fill/size values, and helper responsibilities until render/evaluation evidence proves simplification is safe.",
            "9. After each visual-region restoration, inspect task-scoped preview or screenshot evidence against the visual skeleton and `reference.png`, repair the same region from source evidence when screenshot review names mismatches, then record the replacement result. Do not record completed for charts, maps, tables, calendars, or other complex controls that are only labeled placeholder boxes; restore them from source data/assets and component-kind evidence, or record blocked/deferred visual debt. Do not try multiple dev/preview/Python/Vite servers or use `skill`/shell output as visual evidence.",
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

function resolveProjectPath(inputPath: string, projectRoot: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(projectRoot, inputPath)
}

function resolveSkeletonOutputDir(
  input: { requested: string | undefined; defaultOutputDir: string | undefined },
  projectRoot: string,
): string {
  const outputDir = resolveProjectPath(
    input.requested ?? requireTaskRuntimeDefault(input.defaultOutputDir, "outputDir"),
    projectRoot,
  )
  const expectedOutputDir = input.defaultOutputDir
    ? path.resolve(input.defaultOutputDir)
    : path.resolve(projectRoot, "frontend-design-skeleton")
  if (!sameResolvedPath(outputDir, expectedOutputDir)) {
    const expectedRef = input.defaultOutputDir ? expectedOutputDir : "frontend-design-skeleton"
    throw new Error(
      `create_frontend_skeleton_project outputDir must be the frontend-design-skeleton evidence directory (${expectedRef}); received ${outputDir}`,
    )
  }
  return outputDir
}

function sameResolvedPath(left: string, right: string): boolean {
  const a = path.normalize(left)
  const b = path.normalize(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}
