import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import {
  BrowserPreviewRegionBinding,
  compareBrowserPreviewRegions,
  resolveSourceReferencePath,
} from "@/browser-preview/region-comparison"
import {
  browserPreviewEvidenceIDFromRef,
  findBrowserPreviewTargetByID,
  findReadableBrowserPreviewEvidenceByID,
  resolveRuntimeRelativePath,
  type PersistedBrowserPreviewEvidence,
} from "@/browser-preview/persist"
import { BrowserPreviewViewportID } from "@/browser-preview/viewport"
import { Identifier } from "@/id/id"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { requireRuntimePackage } from "@/runtime/package-require"
import {
  VisualEvidenceBundleSchema,
  type VisualEvidenceBundle,
  type VisualRegionEvidence,
} from "./visual-evidence"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

const SourceBindingCaptureSchema = z
  .object({
    binding: BrowserPreviewRegionBinding,
  })
  .passthrough()

const ReferenceComparisonCaptureSchema = z
  .object({
    operation: z.literal("reference-comparison"),
    region: z
      .object({
        region_id: z.string().min(1),
        viewport_id: BrowserPreviewViewportID,
        state_id: z.string().optional(),
        crop_intent: z.enum(["full-region", "content-well"]).optional(),
        source_bbox: z
          .object({
            x: z.number().finite().nonnegative(),
            y: z.number().finite().nonnegative(),
            width: z.number().finite().positive(),
            height: z.number().finite().positive(),
          })
          .strict()
          .optional(),
        source_image_size: z
          .object({
            width: z.number().finite().positive(),
            height: z.number().finite().positive(),
          })
          .strict()
          .optional(),
        implementation_screenshot_path: z.string().min(1).optional(),
      })
      .passthrough(),
  })
  .passthrough()

type ComparisonRegionForBundle = {
  regionID: string
  viewportID: string
  cropIntent: "full-region" | "content-well"
  status: "passing" | "failing"
  evidenceRef: string
  sourceRefs: string[]
  sourceBBox?: { x: number; y: number; width: number; height: number }
  implementationScreenshotPath?: string
  notes: string
}

export type VisualEvidenceBundleMaterializationResult =
  | {
      status: "materialized"
      bundle: VisualEvidenceBundle
      bundlePath: string
      referenceComparisonEvidenceRefs: string[]
      sourceBindingEvidenceRefs: string[]
      issues: string[]
    }
  | {
      status: "not_ready"
      referenceComparisonEvidenceRefs: string[]
      sourceBindingEvidenceRefs: string[]
      issues: string[]
    }

export async function materializeVisualEvidenceBundleFromEvidenceRefs(input: {
  projectRoot: string
  taskID: string
  evidenceRefs: readonly string[]
  source: VisualEvidenceBundle["source"]
  inspectedAt?: string
}): Promise<VisualEvidenceBundleMaterializationResult> {
  const evidenceIDs = uniqueEvidenceIDs(input.evidenceRefs)
  const issues: string[] = []
  const sourceBindingEvidenceRefs: string[] = []
  const referenceComparisonEvidenceRefs: string[] = []
  const sourceBindingsByTarget = new Map<string, BrowserPreviewRegionBinding[]>()
  const comparisonRegions: ComparisonRegionForBundle[] = []

  for (const evidenceID of evidenceIDs) {
    let evidence: PersistedBrowserPreviewEvidence | undefined
    try {
      evidence = await findReadableBrowserPreviewEvidenceByID({
        projectRoot: input.projectRoot,
        taskID: input.taskID,
        evidenceID,
      })
    } catch (error) {
      issues.push(`evidence ${evidenceID} is unreadable: ${errorMessage(error)}`)
      continue
    }
    if (!evidence) {
      issues.push(`evidence ${evidenceID} was not found for task ${input.taskID}`)
      continue
    }
    if (evidence.operationKind === "source-binding") {
      if (evidence.status !== "passed") {
        issues.push(`source-binding evidence ${evidenceID} status is ${evidence.status}`)
        continue
      }
      const parsed = SourceBindingCaptureSchema.safeParse(evidence.capture)
      if (!parsed.success) {
        issues.push(`source-binding evidence ${evidenceID} is missing a BrowserPreviewRegionBinding capture`)
        continue
      }
      sourceBindingEvidenceRefs.push(`browser_preview_evidence:${evidenceID}`)
      const existing = sourceBindingsByTarget.get(evidence.targetID) ?? []
      existing.push(parsed.data.binding)
      sourceBindingsByTarget.set(evidence.targetID, existing)
      continue
    }
    if (evidence.operationKind === "reference-comparison") {
      const region = comparisonRegionFromEvidence(evidence, `browser_preview_evidence:${evidenceID}`, issues)
      if (region) {
        referenceComparisonEvidenceRefs.push(`browser_preview_evidence:${evidenceID}`)
        comparisonRegions.push(region)
      }
      continue
    }
    issues.push(`evidence ${evidenceID} is ${evidence.operationKind}, not source-binding or reference-comparison`)
  }

  for (const [targetID, bindings] of sourceBindingsByTarget) {
    try {
      const result = await compareBrowserPreviewRegions({
        projectRoot: input.projectRoot,
        taskID: input.taskID,
        targetID,
        viewportIDs: uniqueViewportIDs(bindings),
        bindings,
        includeSideBySide: true,
        includeDiff: false,
        includeFullpageOverview: false,
      })
      for (const region of result.regions) {
        const evidenceID = result.evidenceIDs[comparisonRegionEvidenceKey(region)]
        if (!evidenceID) {
          issues.push(`reference comparison for ${region.region_id}@${region.viewport_id} did not persist evidence`)
          continue
        }
        const ref = `browser_preview_evidence:${evidenceID}`
        referenceComparisonEvidenceRefs.push(ref)
        comparisonRegions.push({
          regionID: region.region_id,
          viewportID: region.viewport_id,
          cropIntent: region.crop_intent ?? "content-well",
          status: region.status === "completed" ? "passing" : "failing",
          evidenceRef: ref,
          sourceRefs: [
            region.source_bbox ? `source_bbox:${region.source_bbox.x},${region.source_bbox.y},${region.source_bbox.width},${region.source_bbox.height}` : "",
          ].filter(Boolean),
          sourceBBox: region.source_bbox,
          implementationScreenshotPath: region.implementation_screenshot_path,
          notes:
            region.status === "completed"
              ? "Host materializer created formal reference-comparison evidence from source-binding capture."
              : `Host materializer created failing reference-comparison evidence: ${region.reason ?? "comparison failed"}`,
        })
      }
    } catch (error) {
      issues.push(`reference comparison materialization failed for target ${targetID}: ${errorMessage(error)}`)
    }
  }

  if (comparisonRegions.length === 0) {
    if (evidenceIDs.length === 0) issues.push("no browser_preview evidence refs were supplied for materialization")
    return {
      status: "not_ready",
      referenceComparisonEvidenceRefs: uniqueStrings(referenceComparisonEvidenceRefs),
      sourceBindingEvidenceRefs,
      issues,
    }
  }

  const referenceArtifactID = firstReferenceArtifactID(sourceBindingsByTarget) ?? "web-clone-source/reference.png"
  const referencePath = resolveSourceReferencePath({
    projectRoot: input.projectRoot,
    taskID: input.taskID,
    referenceArtifactID,
  })
  const referenceImage = await imageFileDescriptor(referencePath)
  const renderedPath = firstRenderedPath(input.projectRoot, comparisonRegions)
  if (!renderedPath) {
    issues.push("no implementation screenshot path was available from reference-comparison evidence")
    return {
      status: "not_ready",
      referenceComparisonEvidenceRefs: uniqueStrings(referenceComparisonEvidenceRefs),
      sourceBindingEvidenceRefs,
      issues,
    }
  }
  const renderedImage = await imageFileDescriptor(renderedPath.absolute)
  const inspectedAt = input.inspectedAt ?? new Date().toISOString()
  const regions = comparisonRegions.map((region): VisualRegionEvidence => {
    const sourceRefs = uniqueStrings([referenceArtifactID, ...region.sourceRefs])
    return {
      id: region.regionID,
      label: humanizeRegionID(region.regionID),
      requirementIDs: [],
      acceptanceSpecIDs: [],
      sourceRefs,
      viewport: region.viewportID,
      cropIntent: region.cropIntent,
      ...(region.sourceBBox ? { bounds: region.sourceBBox } : {}),
      required: true,
      status: region.status,
      evidenceRefs: [region.evidenceRef],
      notes: region.notes,
    }
  })
  const intervals = comparisonRegions
    .filter((region) => region.sourceBBox)
    .map((region) => ({
      id: `coverage_${safeID(region.regionID)}_${safeID(region.viewportID)}`,
      label: humanizeRegionID(region.regionID),
      y: region.sourceBBox!.y,
      height: region.sourceBBox!.height,
      regionIDs: [region.regionID],
      evidenceRefs: [region.evidenceRef],
      notes: "Covered by formal reference-comparison source bbox.",
    }))
  if (intervals.length === 0) {
    issues.push("reference-comparison evidence did not include any source bbox coverage intervals")
    return {
      status: "not_ready",
      referenceComparisonEvidenceRefs: uniqueStrings(referenceComparisonEvidenceRefs),
      sourceBindingEvidenceRefs,
      issues,
    }
  }

  const bundle = VisualEvidenceBundleSchema.parse({
    id: Identifier.ascending("artifact"),
    taskID: input.taskID,
    source: input.source,
    reference: {
      path: referenceArtifactID,
      sha256: referenceImage.sha256,
      width: referenceImage.width,
      height: referenceImage.height,
    },
    rendered: {
      path: renderedPath.display,
      sha256: renderedImage.sha256,
      width: renderedImage.width,
      height: renderedImage.height,
      capturedAt: inspectedAt,
      viewport: { width: renderedImage.width, height: renderedImage.height },
      appURL: targetUrlForBundle(input.taskID, sourceBindingsByTarget),
      projectDirectory: input.projectRoot,
    },
    inspection: {
      reviewedAt: inspectedAt,
      status: regions.every((region) => region.status === "passing") ? "passing" : "failing",
      blockerCount: regions.filter((region) => region.status !== "passing").length,
      notes:
        issues.length > 0
          ? `Materialized with issue(s): ${issues.join("; ")}`
          : "Materialized from task-scoped browser preview source-binding/reference-comparison evidence.",
    },
    pageCoverage: {
      coordinateSpace: "source_reference_image_px",
      implementationUse: "evidence_only",
      requiredRegionIDs: regions.map((region) => region.id),
      coveredIntervals: intervals,
      unexplainedBlankIntervals: [],
    },
    regions,
  })
  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectRoot, input.taskID)
  await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
  const bundlePath = path.join(paths.webpageEvidenceAbsolute, "visual-evidence-bundle.json")
  await fs.writeFile(bundlePath, JSON.stringify(bundle, null, 2), "utf8")
  return {
    status: "materialized",
    bundle,
    bundlePath,
    referenceComparisonEvidenceRefs: uniqueStrings(referenceComparisonEvidenceRefs),
    sourceBindingEvidenceRefs,
    issues,
  }
}

export function collectVisualEvidenceMaterializationRefs(input: {
  checkItems?: ReadonlyArray<{ evidence_refs?: readonly string[] }>
  coverage?: ReadonlyArray<{ evidence_refs?: readonly string[] }>
  evidence?: ReadonlyArray<{ ref?: string }>
  referenceParity?: {
    reference_comparison_evidence_refs?: readonly string[]
  }
}): string[] {
  return uniqueStrings([
    ...(input.checkItems ?? []).flatMap((item) => [...(item.evidence_refs ?? [])]),
    ...(input.coverage ?? []).flatMap((item) => [...(item.evidence_refs ?? [])]),
    ...(input.evidence ?? []).flatMap((item) => (item.ref ? [item.ref] : [])),
    ...(input.referenceParity?.reference_comparison_evidence_refs ?? []),
  ])
}

export function renderVisualEvidenceBundleMaterializationSummary(
  result: VisualEvidenceBundleMaterializationResult,
): string {
  const lines = [
    `status=${result.status}`,
    `reference_comparison_evidence=${result.referenceComparisonEvidenceRefs.join(", ") || "(none)"}`,
    `source_binding_evidence=${result.sourceBindingEvidenceRefs.join(", ") || "(none)"}`,
  ]
  if (result.status === "materialized") {
    lines.push(`bundle_id=${result.bundle.id}`)
    lines.push(`bundle_path=${result.bundlePath}`)
    lines.push(`required_regions=${result.bundle.regions.map((region) => `${region.id}@${region.viewport}`).join(", ")}`)
    lines.push(`inspection_status=${result.bundle.inspection.status}`)
  }
  if (result.issues.length > 0) lines.push(`issues=${result.issues.join(" | ")}`)
  return lines.join("\n")
}

function comparisonRegionFromEvidence(
  evidence: PersistedBrowserPreviewEvidence,
  evidenceRef: string,
  issues: string[],
): ComparisonRegionForBundle | undefined {
  const parsed = ReferenceComparisonCaptureSchema.safeParse(evidence.capture)
  if (!parsed.success) {
    issues.push(`reference-comparison evidence ${evidence.id} is missing structured capture.region`)
    return undefined
  }
  const region = parsed.data.region
  return {
    regionID: region.region_id,
    viewportID: region.viewport_id,
    cropIntent: region.crop_intent ?? evidence.cropIntent ?? "content-well",
    status: evidence.status === "passed" ? "passing" : "failing",
    evidenceRef,
    sourceRefs: [evidence.manifestPath ?? ""].filter(Boolean),
    sourceBBox: region.source_bbox,
    implementationScreenshotPath: region.implementation_screenshot_path,
    notes:
      evidence.status === "passed"
        ? "Existing formal reference-comparison evidence was included in the visual evidence bundle."
        : "Existing formal reference-comparison evidence is failing and was included for concrete repair feedback.",
  }
}

function uniqueEvidenceIDs(refs: readonly string[]): string[] {
  return uniqueStrings(refs.flatMap((ref) => browserPreviewEvidenceIDFromRef(ref) ?? []))
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function uniqueViewportIDs(bindings: readonly BrowserPreviewRegionBinding[]): BrowserPreviewViewportID[] {
  return uniqueStrings(bindings.map((binding) => binding.viewport_id)) as BrowserPreviewViewportID[]
}

function comparisonRegionEvidenceKey(region: { viewport_id: string; state_id?: string; region_id: string }): string {
  return `${region.viewport_id}:${region.state_id ?? "default"}:${region.region_id}`
}

function firstReferenceArtifactID(
  sourceBindingsByTarget: ReadonlyMap<string, readonly BrowserPreviewRegionBinding[]>,
): "reference.png" | "web-clone-source/reference.png" | undefined {
  for (const bindings of sourceBindingsByTarget.values()) {
    for (const binding of bindings) return binding.source.reference_artifact_id
  }
  return undefined
}

function firstRenderedPath(
  projectRoot: string,
  regions: readonly ComparisonRegionForBundle[],
): { absolute: string; display: string } | undefined {
  for (const region of regions) {
    if (!region.implementationScreenshotPath) continue
    const normalized = region.implementationScreenshotPath.replaceAll("\\", "/")
    if (path.isAbsolute(region.implementationScreenshotPath)) {
      return {
        absolute: path.resolve(region.implementationScreenshotPath),
        display: path.relative(projectRoot, path.resolve(region.implementationScreenshotPath)).replaceAll(path.sep, "/"),
      }
    }
    if (normalized.startsWith(`${ProjectRuntimePaths.relativeRuntimeRoot()}/`)) {
      return {
        absolute: resolveRuntimeRelativePath(projectRoot, normalized),
        display: normalized,
      }
    }
  }
  return undefined
}

function targetUrlForBundle(
  taskID: string,
  sourceBindingsByTarget: ReadonlyMap<string, readonly BrowserPreviewRegionBinding[]>,
): string {
  for (const targetID of sourceBindingsByTarget.keys()) {
    const target = findBrowserPreviewTargetByID({ taskID, targetID })
    if (target) return target.url
  }
  return "browser_preview_target:unknown"
}

async function imageFileDescriptor(filePath: string): Promise<{ sha256: string; width: number; height: number }> {
  const [bytes, metadata] = await Promise.all([fs.readFile(filePath), sharp(filePath).metadata()])
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read image dimensions: ${filePath}`)
  return {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    width: metadata.width,
    height: metadata.height,
  }
}

function humanizeRegionID(input: string): string {
  return input
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^./, (value) => value.toUpperCase())
}

function safeID(input: string): string {
  return input
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "region"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
