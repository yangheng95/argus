import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  browserPreviewEvidenceIDFromRef,
  findReadableBrowserPreviewEvidenceArtifactPath,
  findReadableBrowserPreviewEvidenceCapturePath,
  resolveRuntimeRelativePath,
} from "@/browser-preview/persist"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { AttachmentStore } from "@/storage/attachment-store"
import { requireRuntimePackage } from "@/runtime/package-require"
import type { VisualQaReport } from "./schema"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

type VisualQaProblemDomRegion = VisualQaReport["problem_dom_regions"][number]

interface ResolvedImageEvidence {
  sourceRef: string
  absPath: string
}

export interface VisualQaProblemDomAnnotationResult {
  annotatedEvidenceRefs: string[]
  diagnostics: string[]
  error?: string
}

export async function annotateVisualQaProblemDomRegion(input: {
  taskID?: string
  projectRoot?: string
  projectID?: string
  region: VisualQaProblemDomRegion
}): Promise<VisualQaProblemDomAnnotationResult> {
  const taskID = input.taskID?.trim()
  const projectRoot = input.projectRoot?.trim()
  if (!taskID || !projectRoot) {
    return {
      annotatedEvidenceRefs: [],
      diagnostics: ["Visual QA annotation not materialized because taskID/projectRoot were not supplied."],
    }
  }
  const bbox = input.region.bbox
  if (!bbox) {
    return {
      annotatedEvidenceRefs: [],
      diagnostics: [],
      error: `problem_dom_region ${input.region.id} requires bbox before a screenshot annotation can be materialized.`,
    }
  }
  if (input.region.evidence_refs.length === 0) {
    return {
      annotatedEvidenceRefs: [],
      diagnostics: [],
      error: `problem_dom_region ${input.region.id} requires screenshot evidence_refs before annotation.`,
    }
  }

  const diagnostics: string[] = []
  const resolved: ResolvedImageEvidence[] = []
  for (const ref of input.region.evidence_refs) {
    const candidate = await resolveImageEvidenceRef({ projectRoot, taskID, ref })
    if ("issue" in candidate) {
      diagnostics.push(candidate.issue)
      continue
    }
    resolved.push(candidate)
  }
  const unique = uniqueResolvedEvidence(resolved)
  if (unique.length === 0) {
    return {
      annotatedEvidenceRefs: [],
      diagnostics,
      error: `problem_dom_region ${input.region.id} has no resolvable screenshot evidence to annotate.`,
    }
  }

  const projectID = input.projectID ?? Instance.project.id
  const annotatedEvidenceRefs: string[] = []
  const outputDir = ProjectRuntimePaths.taskAbsolute(projectRoot, taskID, "visual-qa-annotations")
  await fs.mkdir(outputDir, { recursive: true })

  for (const [index, evidence] of unique.entries()) {
    const filename = `${safeFilename(input.region.id)}-${index + 1}.annotated.png`
    const outputPath = path.join(outputDir, filename)
    const render = await renderAnnotatedPng({
      inputPath: evidence.absPath,
      outputPath,
      sourceRef: evidence.sourceRef,
      region: input.region,
    })
    diagnostics.push(...render.diagnostics)
    const attachment = await AttachmentStore.writeFromPath(projectID, outputPath, "image/png", filename)
    annotatedEvidenceRefs.push(attachment.url)
  }

  return { annotatedEvidenceRefs, diagnostics }
}

async function resolveImageEvidenceRef(input: {
  projectRoot: string
  taskID: string
  ref: string
}): Promise<ResolvedImageEvidence | { issue: string }> {
  const ref = input.ref.trim()
  const attachment = AttachmentStore.nameFromUrl(ref)
  if (attachment) {
    const absPath = AttachmentStore.resolveAbsolute(attachment.projectID, attachment.name)
    if (!absPath) return { issue: `attachment evidence ref is not resolvable: ${ref}` }
    await assertReadableFile(absPath)
    return { sourceRef: ref, absPath }
  }

  const directPath = await resolveDirectPath(input.projectRoot, ref)
  if (directPath) return { sourceRef: ref, absPath: directPath }

  const evidenceID = browserPreviewEvidenceIDFromRef(ref)
  if (evidenceID) {
    const resolved = await resolveBrowserPreviewEvidenceImage({
      projectRoot: input.projectRoot,
      taskID: input.taskID,
      evidenceID,
      sourceRef: ref,
    })
    if (resolved) return resolved
  }

  return { issue: `Visual QA evidence ref is not a resolvable screenshot image: ${ref}` }
}

async function resolveDirectPath(projectRoot: string, ref: string): Promise<string | undefined> {
  const normalized = ref.replaceAll("\\", "/")
  let candidate: string | undefined
  if (normalized.startsWith("file://")) {
    candidate = fileURLToPath(normalized)
  } else if (path.isAbsolute(ref)) {
    candidate = ref
  } else if (
    normalized === ProjectRuntimePaths.relativeRuntimeRoot() ||
    normalized.startsWith(`${ProjectRuntimePaths.relativeRuntimeRoot()}/`)
  ) {
    candidate = resolveRuntimeRelativePath(projectRoot, normalized)
  }
  if (!candidate) return undefined
  await assertReadableFile(candidate)
  return candidate
}

async function resolveBrowserPreviewEvidenceImage(input: {
  projectRoot: string
  taskID: string
  evidenceID: string
  sourceRef: string
}): Promise<ResolvedImageEvidence | undefined> {
  const capturePath = await findReadableBrowserPreviewEvidenceCapturePath({
    projectRoot: input.projectRoot,
    taskID: input.taskID,
    evidenceID: input.evidenceID,
  })
  if (capturePath) {
    return {
      sourceRef: input.sourceRef,
      absPath: resolveRuntimeRelativePath(input.projectRoot, capturePath),
    }
  }
  for (const artifactName of ["implementation", "side-by-side", "diff", "source"] as const) {
    const artifactPath = await findReadableBrowserPreviewEvidenceArtifactPath({
      projectRoot: input.projectRoot,
      taskID: input.taskID,
      evidenceID: input.evidenceID,
      artifactName,
    })
    if (!artifactPath) continue
    return {
      sourceRef: input.sourceRef,
      absPath: resolveRuntimeRelativePath(input.projectRoot, artifactPath),
    }
  }
  return undefined
}

async function assertReadableFile(absPath: string): Promise<void> {
  const stat = await fs.stat(absPath)
  if (!stat.isFile()) throw new Error(`screenshot evidence path is not a file: ${absPath}`)
}

function uniqueResolvedEvidence(items: ResolvedImageEvidence[]): ResolvedImageEvidence[] {
  const seen = new Set<string>()
  const result: ResolvedImageEvidence[] = []
  for (const item of items) {
    const key = path.resolve(item.absPath).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

async function renderAnnotatedPng(input: {
  inputPath: string
  outputPath: string
  sourceRef: string
  region: VisualQaProblemDomRegion
}): Promise<{ diagnostics: string[] }> {
  const image = sharp(input.inputPath, { failOn: "error" })
  const metadata = await image.metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error(`screenshot evidence has no readable dimensions: ${input.inputPath}`)

  const mapped = mapDomBoxToImage({
    bbox: input.region.bbox!,
    viewport: input.region.viewport,
    imageWidth: width,
    imageHeight: height,
  })
  const labelLines = annotationLabelLines(input.region, input.sourceRef, mapped.mode)
  const overlay = annotationSvg({
    width,
    height,
    box: mapped.box,
    labelLines,
  })
  await sharp(input.inputPath, { failOn: "error" })
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toFile(input.outputPath)
  return { diagnostics: mapped.diagnostics }
}

interface ImageBox {
  x: number
  y: number
  width: number
  height: number
}

function mapDomBoxToImage(input: {
  bbox: NonNullable<VisualQaProblemDomRegion["bbox"]>
  viewport?: VisualQaProblemDomRegion["viewport"]
  imageWidth: number
  imageHeight: number
}): { box: ImageBox; mode: string; diagnostics: string[] } {
  const direct = normalizeBox(input.bbox)
  if (boxFitsImage(direct, input.imageWidth, input.imageHeight)) {
    return { box: direct, mode: "css-pixel", diagnostics: [] }
  }
  if (input.viewport) {
    const scaled = normalizeBox({
      x: input.bbox.x * (input.imageWidth / input.viewport.width),
      y: input.bbox.y * (input.imageHeight / input.viewport.height),
      width: input.bbox.width * (input.imageWidth / input.viewport.width),
      height: input.bbox.height * (input.imageHeight / input.viewport.height),
    })
    if (boxFitsImage(scaled, input.imageWidth, input.imageHeight)) {
      return { box: scaled, mode: "viewport-scaled", diagnostics: [] }
    }
  }
  return {
    box: clampBoxToImage(direct, input.imageWidth, input.imageHeight),
    mode: "clamped-css-pixel",
    diagnostics: [
      `DOM bbox exceeded screenshot bounds; annotation was clamped to image ${input.imageWidth}x${input.imageHeight}.`,
    ],
  }
}

function normalizeBox(box: ImageBox): ImageBox {
  return {
    x: finiteNonnegative(box.x),
    y: finiteNonnegative(box.y),
    width: Math.max(1, finiteNonnegative(box.width)),
    height: Math.max(1, finiteNonnegative(box.height)),
  }
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function boxFitsImage(box: ImageBox, width: number, height: number): boolean {
  return box.x < width && box.y < height && box.x + box.width <= width && box.y + box.height <= height
}

function clampBoxToImage(box: ImageBox, width: number, height: number): ImageBox {
  const x = Math.min(Math.max(0, box.x), Math.max(0, width - 1))
  const y = Math.min(Math.max(0, box.y), Math.max(0, height - 1))
  const maxWidth = Math.max(1, width - x)
  const maxHeight = Math.max(1, height - y)
  return {
    x,
    y,
    width: Math.min(Math.max(1, box.width), maxWidth),
    height: Math.min(Math.max(1, box.height), maxHeight),
  }
}

function annotationLabelLines(region: VisualQaProblemDomRegion, sourceRef: string, coordinateMode: string): string[] {
  const bbox = region.bbox
  const searchTerms = region.code_search_terms.join(", ")
  return [
    `DOM REGION: ${region.id}`,
    `blockers: ${region.blocker_ids.join(", ")}`,
    `locator: ${region.locator}`,
    bbox ? `bbox: x=${bbox.x} y=${bbox.y} w=${bbox.width} h=${bbox.height}` : "",
    `coords: ${coordinateMode}`,
    searchTerms ? `search: ${searchTerms}` : "",
    `source: ${sourceRef}`,
    `notes: ${region.notes}`,
  ].filter((line) => line.trim().length > 0)
}

function annotationSvg(input: {
  width: number
  height: number
  box: ImageBox
  labelLines: string[]
}): string {
  const stroke = Math.max(3, Math.round(Math.min(input.width, input.height) / 300))
  const padding = 10
  const fontSize = Math.max(13, Math.min(18, Math.round(input.width / 80)))
  const lineHeight = Math.round(fontSize * 1.35)
  const wrapped = input.labelLines.flatMap((line) => wrapText(line, 74)).slice(0, 10)
  const labelWidth = Math.min(input.width - padding * 2, 760)
  const labelHeight = Math.min(input.height - padding * 2, padding * 2 + wrapped.length * lineHeight)
  const labelX = clamp(input.box.x, padding, Math.max(padding, input.width - labelWidth - padding))
  const preferredAbove = input.box.y - labelHeight - padding
  const preferredBelow = input.box.y + input.box.height + padding
  const labelY =
    preferredAbove >= padding
      ? preferredAbove
      : clamp(preferredBelow, padding, Math.max(padding, input.height - labelHeight - padding))
  const textY = labelY + padding + fontSize
  const text = wrapped
    .map(
      (line, index) =>
        `<text x="${labelX + padding}" y="${textY + index * lineHeight}" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join("")
  const centerX = input.box.x + input.box.width / 2
  const centerY = input.box.y + input.box.height / 2
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">`,
    `<rect x="${input.box.x}" y="${input.box.y}" width="${input.box.width}" height="${input.box.height}" fill="rgba(255,23,68,0.12)" stroke="#ff1744" stroke-width="${stroke}"/>`,
    `<line x1="${centerX}" y1="${centerY}" x2="${labelX}" y2="${labelY + labelHeight / 2}" stroke="#ff1744" stroke-width="${stroke}" stroke-linecap="round"/>`,
    `<rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="4" ry="4" fill="rgba(15,23,42,0.94)" stroke="#ff1744" stroke-width="${stroke}"/>`,
    `<g font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700">${text}</g>`,
    "</svg>",
  ].join("")
}

function wrapText(input: string, maxChars: number): string[] {
  if (input.length <= maxChars) return [input]
  const words = input.split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxChars) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word.length > maxChars ? `${word.slice(0, maxChars - 3)}...` : word
  }
  if (current) lines.push(current)
  return lines
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function safeFilename(input: string): string {
  const safe = input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return safe || "visual-qa-dom-region"
}
