import path from "node:path"
import z from "zod"
import { Instance } from "../project/instance"
import { Tool } from "./tool"
import { writeWebCloneSourceSkeletonConsumptionAudit } from "../web-clone/source-skeleton-consumption-audit"

export const WebCloneSourceAuditTool = Tool.define("web_clone_source_audit", {
  description: `Audit a downstream webpage clone implementation against the task-runtime or explicitly supplied web-clone-source source package.

Use this after a Build agent has written React/Vue/etc. source from web-clone-source/source-skeleton and web-clone-source/source-ir. Pass sourcePackageDir from the frontend_design public report when the source package lives under task runtime. The tool reads project-owned source files plus that source package, writes web-clone-source-skeleton-consumption-audit.json, and fails the audit when the project ignored the skeleton/IR, kept default framework scaffold text/assets, missed repeated data arrays/loops, or used HTML/base64/manual-DOM replay shortcuts. Use finalAcceptanceMode=maintainable_replacement_required when the original request asks for maintainability, real implementation, component reuse, or replacement of generated/mechanical output; in that mode the frontend-design generated DOM/CSS baseline cannot be the final deliverable. It does not re-extract webpages.`,
  parameters: z.object({
    projectDir: z
      .string()
      .describe(
        "Directory containing the implemented target app source. Defaults to the current OpenCorvus execution directory.",
      )
      .optional(),
    sourcePackageDir: z
      .string()
      .describe(
        "Directory containing reference.png, source-skeleton/, and source-ir/. Use the task-runtime path from frontend_design; omitted keeps the legacy <execution directory>/web-clone-source default.",
      )
      .optional(),
    outputPath: z
      .string()
      .describe("Audit JSON output path. Defaults to <projectDir>/web-clone-source-skeleton-consumption-audit.json.")
      .optional(),
    finalAcceptanceMode: z
      .enum(["visual_baseline_allowed", "maintainable_replacement_required"])
      .default("visual_baseline_allowed")
      .describe(
        "Use maintainable_replacement_required for final deliveries where the user asked for maintainable/real/component-reuse replacement instead of a generated baseline.",
      ),
  }),
  async execute(params) {
    const projectDir = resolveInputPath(params.projectDir ?? Instance.directory)
    const sourcePackageDir = resolveInputPath(
      params.sourcePackageDir ?? path.join(Instance.directory, "web-clone-source"),
    )
    const outputPath = params.outputPath ? resolveInputPath(params.outputPath) : undefined
    if (outputPath) assertInsideDirectory(outputPath, projectDir, "outputPath")
    const { audit, auditPath } = await writeWebCloneSourceSkeletonConsumptionAudit({
      projectDir,
      sourcePackageDir,
      outputPath,
      finalAcceptanceMode: params.finalAcceptanceMode,
    })

    const output = [
      "# Web clone source-skeleton consumption audit",
      "",
      `- Project: ${audit.projectDir}`,
      `- Source package: ${audit.sourcePackageDir}`,
      `- Audit JSON: ${auditPath}`,
      `- Passed: ${audit.passed}`,
      `- Final acceptance mode: ${audit.finalAcceptanceMode}`,
      `- Text coverage: ${audit.sourceCoverage.matchedTextCount}/${audit.sourceCoverage.requiredTextCount} (${Math.round(audit.sourceCoverage.textCoverageRatio * 100)}%)`,
      `- Component files: ${audit.projectStats.componentFileCount}`,
      `- Data arrays: ${audit.projectStats.dataArrayCount}`,
      `- Render loops: ${audit.projectStats.renderLoopCount}`,
      `- Generated source-dom regions: ${audit.projectStats.sourceDomRegionFileCount}`,
      `- Largest source-dom region bytes: ${audit.projectStats.largestSourceDomRegionBytes}`,
      `- Oversized source-dom regions: ${audit.projectStats.oversizedSourceDomRegionCount}`,
      `- Source-dom replacement plan exists: ${audit.projectStats.sourceDomReplacementPlanExists}`,
      `- Source SVG asset groups exist: ${audit.projectStats.sourceSvgAssetGroupExists}`,
      `- Source FAQ groups exist: ${audit.projectStats.sourceFaqGroupExists}`,
      `- Default scaffold detected: ${audit.risk.defaultScaffoldDetected}`,
      `- Skeleton ignored: ${audit.risk.skeletonIgnored}`,
      `- Generated baseline detected: ${audit.risk.generatedBaselineDetected}`,
      `- Final baseline-only detected: ${audit.risk.finalBaselineOnlyDetected}`,
      `- Oversized generated regions detected: ${audit.risk.oversizedGeneratedRegionDetected}`,
      "",
      audit.findings.length === 0 ? "No blocking findings." : "## Findings",
      ...audit.findings.map((finding) => `- ${finding}`),
    ].join("\n")

    return {
      title: audit.passed ? "Source-skeleton consumption audit passed" : "Source-skeleton consumption audit failed",
      output,
      metadata: {
        auditPath,
        audit,
      },
    }
  },
})

function resolveInputPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(Instance.worktree, inputPath)
}

function assertInsideDirectory(targetPath: string, rootPath: string, label: string): void {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the audited project directory: ${target}`)
  }
}
