import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { BrowserNodeSidecarError, runBrowserNodeSidecar } from "@/browser/runtime/node-executor"
import { resolveBrowserNodeSidecarRuntime } from "@/browser/runtime/node-sidecar"
import { BrowserRuntime } from "@/browser/runtime"
import { Identifier } from "@/id/id"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { requireRuntimePackage } from "@/runtime/package-require"
import { RUNTIME_CAPTURE_DEFAULTS } from "@/runtime/capture-contract"
import { findBrowserPreviewTargetByID, normalizeRuntimePathRefs, persistBrowserPreviewEvidence } from "./persist"
import {
  BrowserPreviewRegionBinding,
  BrowserPreviewRegionBox,
  BrowserPreviewRegionLocator,
  type BrowserPreviewSourceReferenceArtifactID,
} from "./region-schema"
import { resolveSourceReferencePath } from "./source-reference"
import { browserPreviewViewportByID, type BrowserPreviewViewport, type BrowserPreviewViewportID } from "./viewport"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")

export type LocalModuleSourceBindingInput = {
  projectRoot: string
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  regionID: string
  route: string
  implementationLocator: BrowserPreviewRegionLocator
  componentFiles: string[]
  sourceReferenceArtifactID: BrowserPreviewSourceReferenceArtifactID
  textAnchors: string[]
  sourcePadding: number
  localPadding: number
  signal?: AbortSignal
}

export type LocalModuleCapture = {
  screenshotPath: string
  bbox: BrowserPreviewRegionBox
  textAnchors: string[]
  fullText: string
}

export type SourceRegionCandidate = {
  id: string
  source: "source-dom-region" | "visual-surface-candidate" | "layout-map"
  bbox: BrowserPreviewRegionBox
  text: string
  sourceRefs: string[]
  score?: number
  matchedAnchors?: string[]
}

export type LocalModuleSourceBindingResult = {
  status: "passed" | "failed"
  manifestPath: string
  jobID: string
  taskID: string
  targetID: string
  viewportID: BrowserPreviewViewportID
  regionID: string
  sourceCandidate: SourceRegionCandidate
  localCapture: LocalModuleCapture
  binding: BrowserPreviewRegionBinding
  evidenceID: string
  artifacts: {
    source_crop: string
    implementation_crop: string
    source_context: string
    binding_puzzle: string
  }
  diagnostics: string[]
}

type LocalModuleSidecarInput = {
  url: string
  route: string
  outDir: string
  executablePath: string
  launchArgs: string[]
  launchTimeoutMs: number
  navigationTimeoutMs: number
  viewport: { width: number; height: number }
  locator: BrowserPreviewRegionLocator
}

type LocalModuleSidecarResult =
  | { ok: true; capture: LocalModuleCapture }
  | { ok: false; message: string; stack?: string }

export async function bindLocalModuleToSourceRegion(
  input: LocalModuleSourceBindingInput,
): Promise<LocalModuleSourceBindingResult> {
  if (!input.taskID.trim() || !input.targetID.trim()) {
    throw new Error("Local module source binding requires taskID and targetID.")
  }
  const target = findBrowserPreviewTargetByID({ taskID: input.taskID, targetID: input.targetID })
  if (!target) throw new Error(`Browser preview target not found: ${input.targetID}`)

  const jobID = Identifier.ascending("artifact")
  const outDir = ProjectRuntimePaths.browserPreviewJobRoot(input.projectRoot, input.taskID, jobID)
  await fs.mkdir(outDir, { recursive: true })

  const sourceImagePath = resolveSourceReferencePath({
    projectRoot: input.projectRoot,
    taskID: input.taskID,
    referenceArtifactID: input.sourceReferenceArtifactID,
  })
  const localCapture = await captureLocalModule({
    projectRoot: input.projectRoot,
    outDir,
    targetUrl: target.url,
    route: input.route,
    viewports: target.viewports,
    viewportID: input.viewportID,
    locator: input.implementationLocator,
    signal: input.signal,
  })
  const candidates = await collectSourceRegionCandidates({
    projectRoot: input.projectRoot,
    taskID: input.taskID,
  })
  const sourceCandidate = selectSourceRegionCandidate({
    candidates,
    localCapture,
    regionID: input.regionID,
    componentFiles: input.componentFiles,
    explicitTextAnchors: input.textAnchors,
  })
  const sourceBox = await expandBoxInsideImage(sourceImagePath, sourceCandidate.bbox, input.sourcePadding)
  const localBox = await expandBoxInsideImage(localCapture.screenshotPath, localCapture.bbox, input.localPadding)
  const candidateWithExpandedBox: SourceRegionCandidate = { ...sourceCandidate, bbox: sourceBox }
  const artifacts = await materializeLocalModuleBindingArtifacts({
    outDir,
    regionID: input.regionID,
    sourceImagePath,
    sourceCandidate: candidateWithExpandedBox,
    localCapture: { ...localCapture, bbox: localBox },
  })
  const binding: BrowserPreviewRegionBinding = {
    region_id: input.regionID,
    viewport_id: input.viewportID,
    state_id: "default",
    region_scope: inferRegionScope(candidateWithExpandedBox, localCapture),
    crop_intent: "content-well",
    source: {
      reference_artifact_id: input.sourceReferenceArtifactID,
      bbox: sourceBox,
      semantic_role: candidateWithExpandedBox.source,
      text_anchors: Array.from(new Set([...input.textAnchors, ...localCapture.textAnchors])).slice(0, 12),
      source_refs: candidateWithExpandedBox.sourceRefs,
    },
    implementation: {
      route: input.route,
      locator: input.implementationLocator,
      component_files: input.componentFiles,
    },
    acceptance_refs: [artifacts.binding_puzzle],
  }
  const manifestPath = path.join(outDir, "local-module-source-binding.json")
  const diagnostics = [
    `Local module bound to source candidate ${candidateWithExpandedBox.id} from ${candidateWithExpandedBox.source}.`,
    `Matched anchors: ${(candidateWithExpandedBox.matchedAnchors ?? []).join(", ") || "(none)"}.`,
  ]
  const manifest = normalizeRuntimePathRefs(input.projectRoot, {
    status: "passed",
    jobID,
    taskID: input.taskID,
    targetID: input.targetID,
    viewportID: input.viewportID,
    regionID: input.regionID,
    sourceCandidate: candidateWithExpandedBox,
    localCapture,
    binding,
    artifacts,
    diagnostics,
  })
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  const evidenceID = persistBrowserPreviewEvidence({
    projectRoot: input.projectRoot,
    taskID: input.taskID,
    targetID: input.targetID,
    viewportID: input.viewportID,
    operationKind: "source-binding",
    regionID: input.regionID,
    manifestPath,
    artifactPaths: {
      source_crop: artifacts.source_crop,
      implementation_crop: artifacts.implementation_crop,
      side_by_side: artifacts.binding_puzzle,
    },
    status: "passed",
    summary: `local module ${input.regionID} bound to source region ${candidateWithExpandedBox.id}`,
    capture: manifest,
    diagnostics,
  })
  return {
    status: "passed",
    manifestPath,
    jobID,
    taskID: input.taskID,
    targetID: input.targetID,
    viewportID: input.viewportID,
    regionID: input.regionID,
    sourceCandidate: candidateWithExpandedBox,
    localCapture,
    binding,
    evidenceID,
    artifacts,
    diagnostics,
  }
}

export async function collectSourceRegionCandidates(input: {
  projectRoot: string
  taskID: string
}): Promise<SourceRegionCandidate[]> {
  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectRoot, input.taskID)
  const candidates: SourceRegionCandidate[] = []
  candidates.push(
    ...(await readVisualSurfaceCandidates(path.join(paths.sourcePackageAbsolute, "visual-surface-candidates.json"))),
  )
  candidates.push(
    ...(await readLayoutMapCandidates(path.join(paths.sourcePackageAbsolute, "source-ir", "layout-map.json"))),
  )
  candidates.push(
    ...(await readSourceDomRegionCandidates(
      path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomRegions.ts"),
    )),
  )
  const deduped = dedupeCandidates(candidates)
  if (deduped.length === 0) {
    throw new Error(
      "No source region candidates found. Expected visual-surface-candidates.json, source-ir/layout-map.json, or frontend-design-skeleton/src/data/sourceDomRegions.ts.",
    )
  }
  return deduped
}

export function selectSourceRegionCandidate(input: {
  candidates: SourceRegionCandidate[]
  localCapture: Pick<LocalModuleCapture, "bbox" | "textAnchors" | "fullText">
  regionID: string
  componentFiles: string[]
  explicitTextAnchors: string[]
}): SourceRegionCandidate {
  const anchors = normalizeAnchors([
    input.regionID,
    ...input.componentFiles.flatMap((file) => path.basename(file, path.extname(file)).split(/[-_.]/g)),
    ...input.explicitTextAnchors,
    ...input.localCapture.textAnchors,
    input.localCapture.fullText.slice(0, 200),
  ])
  if (anchors.length === 0) throw new Error("Local module source binding needs text anchors from the locator or input.")
  const localArea = input.localCapture.bbox.width * input.localCapture.bbox.height
  const scored = input.candidates
    .map((candidate) => scoreCandidate(candidate, anchors, localArea))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || candidateArea(a) - candidateArea(b))
  const selected = scored[0]
  if (!selected) {
    throw new Error(`No source candidate matched local module anchors: ${anchors.slice(0, 12).join(", ")}`)
  }
  const ambiguous = scored.filter(
    (candidate) => candidate.score === selected.score && candidateArea(candidate) === candidateArea(selected),
  )
  if (ambiguous.length > 1) {
    throw new Error(
      `Ambiguous source candidates matched local module anchors with the same score and area: ${ambiguous
        .map(sourceCandidateLabel)
        .join(", ")}`,
    )
  }
  return selected
}

export async function materializeLocalModuleBindingArtifacts(input: {
  outDir: string
  regionID: string
  sourceImagePath: string
  sourceCandidate: SourceRegionCandidate
  localCapture: LocalModuleCapture
}): Promise<LocalModuleSourceBindingResult["artifacts"]> {
  const dir = path.join(input.outDir, "local-module-binding", safeSegment(input.regionID))
  await fs.mkdir(dir, { recursive: true })
  const sourceCrop = path.join(dir, "source-crop.png")
  const implementationCrop = path.join(dir, "implementation-crop.png")
  const sourceContext = path.join(dir, "source-context.png")
  const bindingPuzzle = path.join(dir, "binding-puzzle.png")
  await cropPng(input.sourceImagePath, sourceCrop, input.sourceCandidate.bbox)
  await cropPng(input.localCapture.screenshotPath, implementationCrop, input.localCapture.bbox)
  await writeSourceContext({
    sourceImagePath: input.sourceImagePath,
    sourceBox: input.sourceCandidate.bbox,
    outputPath: sourceContext,
  })
  await writeBindingPuzzle({
    outputPath: bindingPuzzle,
    title: input.regionID,
    sourceContextPath: sourceContext,
    sourceCropPath: sourceCrop,
    implementationCropPath: implementationCrop,
    sourceCandidate: input.sourceCandidate,
    localCapture: input.localCapture,
  })
  return {
    source_crop: sourceCrop,
    implementation_crop: implementationCrop,
    source_context: sourceContext,
    binding_puzzle: bindingPuzzle,
  }
}

async function captureLocalModule(input: {
  projectRoot: string
  outDir: string
  targetUrl: string
  route: string
  viewports: BrowserPreviewViewport[]
  viewportID: BrowserPreviewViewportID
  locator: BrowserPreviewRegionLocator
  signal?: AbortSignal
}): Promise<LocalModuleCapture> {
  const viewport = browserPreviewViewportByID(input.viewports, input.viewportID)
  const runtime = await resolveBrowserNodeSidecarRuntime()
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const launchTimeoutMs = BrowserRuntime.resolveBrowserLaunchTimeoutMs(undefined)
  const sidecar = await runBrowserNodeSidecar<LocalModuleSidecarResult>({
    runtime,
    script: LOCAL_MODULE_CAPTURE_SCRIPT,
    payload: {
      url: input.targetUrl,
      route: input.route,
      outDir: input.outDir,
      executablePath,
      launchArgs: BrowserRuntime.defaultLaunchArgs(),
      launchTimeoutMs,
      navigationTimeoutMs: RUNTIME_CAPTURE_DEFAULTS.wait_timeout_ms,
      viewport: { width: viewport.width, height: viewport.height },
      locator: input.locator,
    } satisfies LocalModuleSidecarInput,
    payloadEnvName: "OPENCORVUS_BROWSER_PREVIEW_LOCAL_MODULE_BINDING_INPUT",
    inactivityTimeoutMs: launchTimeoutMs + RUNTIME_CAPTURE_DEFAULTS.wait_timeout_ms + 60_000,
    label: "Browser preview local module binding runner",
    signal: input.signal,
  }).catch((error) => {
    if (error instanceof BrowserNodeSidecarError) throw error
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error })
  })
  if (!sidecar.result.ok) {
    throw new Error(
      `Browser preview local module binding runner failed: ${sidecar.result.message}${sidecar.result.stack ? `\n${sidecar.result.stack}` : ""}`,
    )
  }
  if (sidecar.exitCode !== 0) {
    throw new Error(
      `Browser preview local module binding runner exited with ${sidecar.signal ?? sidecar.exitCode}. ${sidecar.stderr.trim()}`,
    )
  }
  return sidecar.result.capture
}

async function readVisualSurfaceCandidates(file: string): Promise<SourceRegionCandidate[]> {
  const json = await readJsonFile(file)
  if (json === undefined) return []
  const rows = asRecord(json).candidates
  if (!Array.isArray(rows)) {
    throw new Error(`Malformed visual surface candidates JSON: ${file}: expected candidates array`)
  }
  return rows.flatMap((row, index) => {
    const record = asRecord(row)
    const bbox = readBounds(record.bounds)
    if (!bbox) return []
    const id = readString(record.id) ?? `visual-surface-${index + 1}`
    const text = [...readStringArray(record.textPreview), readString(record.name)].filter(Boolean).join(" ")
    const rootNodeID = readString(record.rootNodeId)
    const sourceRefs = [
      "web-clone-source/visual-surface-candidates.json",
      `candidate:${id}`,
      rootNodeID ? `root:${rootNodeID}` : undefined,
      ...readStringArray(record.sourceRefs).map((sourceRef) => `node:${sourceRef}`),
    ].filter((sourceRef): sourceRef is string => typeof sourceRef === "string")
    return [
      {
        id,
        source: "visual-surface-candidate" as const,
        bbox,
        text,
        sourceRefs,
      },
    ]
  })
}

async function readLayoutMapCandidates(file: string): Promise<SourceRegionCandidate[]> {
  const json = await readJsonFile(file)
  if (json === undefined) return []
  const rows = asRecord(json).elements
  if (!Array.isArray(rows)) {
    throw new Error(`Malformed layout map JSON: ${file}: expected elements array`)
  }
  return rows.flatMap((row, index) => {
    const record = asRecord(row)
    const bbox = readBounds(record.bounds)
    const text = readString(record.textPreview) ?? ""
    if (!bbox || !text.trim() || bbox.width < 80 || bbox.height < 24) return []
    const id = readString(record.nodeId) ?? `layout-map-${index + 1}`
    const selector = readString(record.selector)
    const role = readString(record.role)
    const sourceRefs = [
      "web-clone-source/source-ir/layout-map.json",
      `node:${id}`,
      selector ? `selector:${selector}` : undefined,
      role ? `role:${role}` : undefined,
    ].filter((sourceRef): sourceRef is string => typeof sourceRef === "string")
    return [
      {
        id,
        source: "layout-map" as const,
        bbox,
        text,
        sourceRefs,
      },
    ]
  })
}

async function readSourceDomRegionCandidates(file: string): Promise<SourceRegionCandidate[]> {
  let text: string
  try {
    text = await fs.readFile(file, "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) return []
    throw new Error(`Cannot read source DOM regions file: ${file}: ${errorMessage(error)}`)
  }
  if (!text.trim()) {
    throw new Error(`Malformed source DOM regions file: ${file}: empty file`)
  }
  const match = text.match(/export const sourceDomRegions = ([\s\S]*?) as const/)
  if (!match) {
    throw new Error(`Malformed source DOM regions file: ${file}`)
  }
  let rows: unknown[]
  try {
    rows = JSON.parse(match[1]!) as unknown[]
  } catch (error) {
    throw new Error(`Malformed source DOM regions JSON: ${file}: ${errorMessage(error)}`)
  }
  if (!Array.isArray(rows)) {
    throw new Error(`Malformed source DOM regions JSON: ${file}: expected array`)
  }
  return rows.flatMap((row, index) => {
    const record = asRecord(row)
    const bbox = readBounds(record.sourceBounds)
    if (!bbox) return []
    const componentName = readString(record.componentName) ?? `SourceDomRegion${index + 1}`
    const regionText = [componentName, readString(record.heading), readString(record.textPreview)]
      .filter(Boolean)
      .join(" ")
    const sourceNodeID = readString(record.sourceNodeId)
    const sourceSegmentID = readString(record.sourceSegmentId)
    const sourceRefs = [
      "frontend-design-skeleton/src/data/sourceDomRegions.ts",
      `component:${componentName}`,
      sourceNodeID ? `node:${sourceNodeID}` : undefined,
      sourceSegmentID ? `segment:${sourceSegmentID}` : undefined,
    ].filter((sourceRef): sourceRef is string => typeof sourceRef === "string")
    return [
      {
        id: componentName,
        source: "source-dom-region" as const,
        bbox,
        text: regionText,
        sourceRefs,
      },
    ]
  })
}

async function readJsonFile(file: string): Promise<unknown | undefined> {
  let text: string
  try {
    text = await fs.readFile(file, "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined
    }
    throw new Error(`Cannot read source evidence JSON: ${file}: ${errorMessage(error)}`)
  }
  if (!text.trim()) {
    throw new Error(`Malformed source evidence JSON: ${file}: empty file`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Malformed source evidence JSON: ${file}: ${errorMessage(error)}`)
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return asRecord(error).code === "ENOENT"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function scoreCandidate(
  candidate: SourceRegionCandidate,
  anchors: string[],
  localArea: number,
): SourceRegionCandidate & {
  score: number
  matchedAnchors: string[]
} {
  const haystack = normalizeText([candidate.id, candidate.text, ...candidate.sourceRefs].join(" "))
  const matchedAnchors = anchors.filter((anchor) => anchorMatchesNormalizedText(haystack, anchor))
  const sourceRefHaystack = normalizeText(candidate.sourceRefs.join(" "))
  const matchedSourceRefAnchors = anchors.filter((anchor) => anchorMatchesNormalizedText(sourceRefHaystack, anchor))
  const sourceWeight =
    candidate.source === "source-dom-region" ? 45 : candidate.source === "visual-surface-candidate" ? 35 : 5
  const candidateID = normalizeText(expandAnchorText(candidate.id).join(" "))
  const identityWeight = matchedAnchors.some((anchor) => anchorMatchesNormalizedText(candidateID, anchor)) ? 90 : 0
  const anchorScore = Math.min(
    360,
    matchedAnchors.reduce((sum, anchor) => sum + anchorWeight(anchor), 0),
  )
  const sourceRefScore = Math.min(
    240,
    matchedSourceRefAnchors.reduce((sum, anchor) => sum + anchorWeight(anchor), 0),
  )
  const areaWeight = candidateAreaWeight(candidateArea(candidate), localArea)
  return {
    ...candidate,
    score: anchorScore + sourceRefScore + identityWeight + sourceWeight + areaWeight,
    matchedAnchors,
  }
}

function normalizeAnchors(values: string[]): string[] {
  const stop = new Set([
    "src",
    "components",
    "component",
    "region",
    "tsx",
    "jsx",
    "index",
    "the",
    "and",
    "for",
    "module",
    "container",
    "wrapper",
    "candidate",
    "node",
    "root",
    "segment",
  ])
  const out = new Set<string>()
  for (const value of values) {
    for (const expanded of expandAnchorText(value)) {
      const normalized = normalizeText(expanded)
      if (normalized.length >= 3 && !stop.has(normalized)) out.add(normalized)
      for (const token of normalized.split(/\s+/g)) {
        if (token.length >= 4 && !stop.has(token)) out.add(token)
      }
    }
  }
  return Array.from(out).slice(0, 60)
}

function expandAnchorText(value: string): string[] {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_.\\/]+/g, " ")
  return [value, spaced]
}

function normalizeText(value: string): string {
  return (
    value
      // NFKC is Unicode Normalization Form KC; it folds fullwidth metric text to ASCII equivalents.
      .normalize("NFKC")
      .toLowerCase()
      .replace(/(?:\p{L}\.){2,}/gu, (match) => match.replace(/\./g, ""))
      // S&P means Standard & Poor's; source captures often include the ampersand while local text uses SP.
      .replace(/(?<![\p{L}\p{N}])(\p{L})\s*&\s*(\p{L})(?![\p{L}\p{N}])/gu, "$1$2")
      // QoQ, YoY, and MoM mean quarter-over-quarter, year-over-year, and month-over-month.
      .replace(/\bq\s*\/\s*q\b/gu, "qoq")
      .replace(/\by\s*\/\s*y\b/gu, "yoy")
      .replace(/\bm\s*\/\s*m\b/gu, "mom")
      .replace(/\u2212/g, "-")
      // Normalize locale decimal commas before preserving thousands group separators.
      .replace(/(?<=\p{N}),(?=\p{N}{1,2}(?!\p{N}))/gu, ".")
      .replace(/(?<=\p{N}),(?=\p{N})/gu, "\uE000")
      // Preserve numeric ranges separately from signed values.
      .replace(/(?<=[\p{N}%])[-\u2013\u2014](?=\p{N})/gu, "\uE002")
      .replace(/(?<![\p{L}\p{N}%])-(?=\p{N})/gu, "\uE001")
      .replace(/[^\p{L}\p{N}%.$+\uE000\uE001\uE002]+/gu, " ")
      .replace(/\uE000/g, ",")
      .replace(/\uE001/g, "-")
      .replace(/\uE002/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  )
}

function anchorMatchesNormalizedText(haystack: string, anchor: string): boolean {
  if (!anchor) return false
  if (anchorHasUnspacedScript(anchor)) return haystack.includes(anchor)
  return ` ${haystack} `.includes(` ${anchor} `)
}

function anchorHasUnspacedScript(anchor: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(anchor)
}

function dedupeCandidates(candidates: SourceRegionCandidate[]): SourceRegionCandidate[] {
  const seen = new Set<string>()
  const out: SourceRegionCandidate[] = []
  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.id}:${candidate.bbox.x},${candidate.bbox.y},${candidate.bbox.width},${candidate.bbox.height}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

function readBounds(input: unknown): BrowserPreviewRegionBox | undefined {
  const record = asRecord(input)
  const x = readNumber(record.x)
  const y = readNumber(record.y)
  const width = readNumber(record.w) ?? readNumber(record.width)
  const height = readNumber(record.h) ?? readNumber(record.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined
  if (width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

async function expandBoxInsideImage(
  imagePath: string,
  box: BrowserPreviewRegionBox,
  padding: number,
): Promise<BrowserPreviewRegionBox> {
  const metadata = await sharp(imagePath).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read PNG dimensions: ${imagePath}`)
  const x = clamp(Math.floor(box.x - padding), 0, metadata.width - 1)
  const y = clamp(Math.floor(box.y - padding), 0, metadata.height - 1)
  const right = clamp(Math.ceil(box.x + box.width + padding), x + 1, metadata.width)
  const bottom = clamp(Math.ceil(box.y + box.height + padding), y + 1, metadata.height)
  return { x, y, width: right - x, height: bottom - y }
}

async function cropPng(inputPath: string, outputPath: string, box: BrowserPreviewRegionBox): Promise<void> {
  const metadata = await sharp(inputPath).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read PNG dimensions: ${inputPath}`)
  const left = clamp(Math.floor(box.x), 0, metadata.width - 1)
  const top = clamp(Math.floor(box.y), 0, metadata.height - 1)
  const width = clamp(Math.ceil(box.width), 1, metadata.width - left)
  const height = clamp(Math.ceil(box.height), 1, metadata.height - top)
  await sharp(inputPath).extract({ left, top, width, height }).png().toFile(outputPath)
}

async function writeSourceContext(input: {
  sourceImagePath: string
  sourceBox: BrowserPreviewRegionBox
  outputPath: string
}): Promise<void> {
  const contextBox = await expandBoxInsideImage(input.sourceImagePath, input.sourceBox, 240)
  const rel = {
    x: input.sourceBox.x - contextBox.x,
    y: input.sourceBox.y - contextBox.y,
    width: input.sourceBox.width,
    height: input.sourceBox.height,
  }
  const overlay = `<svg width="${contextBox.width}" height="${contextBox.height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${rel.x}" y="${rel.y}" width="${rel.width}" height="${rel.height}" fill="none" stroke="#dc2626" stroke-width="6"/>
    <rect x="${rel.x}" y="${Math.max(0, rel.y - 28)}" width="360" height="28" fill="#dc2626" opacity="0.92"/>
    <text x="${rel.x + 8}" y="${Math.max(20, rel.y - 8)}" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#ffffff">selected source module bbox</text>
  </svg>`
  await sharp(input.sourceImagePath)
    .extract({ left: contextBox.x, top: contextBox.y, width: contextBox.width, height: contextBox.height })
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(input.outputPath)
}

async function writeBindingPuzzle(input: {
  outputPath: string
  title: string
  sourceContextPath: string
  sourceCropPath: string
  implementationCropPath: string
  sourceCandidate: SourceRegionCandidate
  localCapture: LocalModuleCapture
}): Promise<void> {
  const maxPanelWidth = 680
  const maxPanelHeight = 560
  const context = await resizeForPanel(input.sourceContextPath, maxPanelWidth * 2 + 20, 320)
  const source = await resizeForPanel(input.sourceCropPath, maxPanelWidth, maxPanelHeight)
  const local = await resizeForPanel(input.implementationCropPath, maxPanelWidth, maxPanelHeight)
  const width = Math.max(context.width, source.width + local.width + 24)
  const headerHeight = 96
  const contextTop = headerHeight
  const labelHeight = 38
  const cropsTop = contextTop + context.height + labelHeight + 18
  const height = cropsTop + Math.max(source.height, local.height) + 20
  const labels = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f6f7f9"/>
    <text x="16" y="30" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#111827">${escapeXml(input.title)} local module source binding</text>
    <text x="16" y="56" font-family="Arial, sans-serif" font-size="14" fill="#374151">source: ${escapeXml(input.sourceCandidate.id)} (${escapeXml(input.sourceCandidate.source)}) bbox=${boxLabel(input.sourceCandidate.bbox)}</text>
    <text x="16" y="78" font-family="Arial, sans-serif" font-size="14" fill="#374151">local bbox=${boxLabel(input.localCapture.bbox)} anchors=${escapeXml(input.localCapture.textAnchors.slice(0, 5).join(" | "))}</text>
    <text x="16" y="${contextTop + context.height + 26}" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#374151">Source crop</text>
    <text x="${source.width + 40}" y="${contextTop + context.height + 26}" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#374151">Local implementation crop</text>
  </svg>`
  await sharp({
    create: { width, height, channels: 4, background: "#f6f7f9" },
  })
    .composite([
      { input: Buffer.from(labels), left: 0, top: 0 },
      { input: context.buffer, left: Math.floor((width - context.width) / 2), top: contextTop },
      { input: source.buffer, left: 16, top: cropsTop },
      { input: local.buffer, left: source.width + 40, top: cropsTop },
    ])
    .png()
    .toFile(input.outputPath)
}

async function resizeForPanel(
  imagePath: string,
  maxWidth: number,
  maxHeight: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const buffer = await sharp(imagePath).resize({ width: maxWidth, height: maxHeight, fit: "inside" }).png().toBuffer()
  const metadata = await sharp(buffer).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot resize image for puzzle: ${imagePath}`)
  return { buffer, width: metadata.width, height: metadata.height }
}

function inferRegionScope(
  candidate: SourceRegionCandidate,
  localCapture: Pick<LocalModuleCapture, "bbox" | "fullText">,
): BrowserPreviewRegionBinding["region_scope"] {
  const text = `${candidate.text} ${localCapture.fullText}`.toLowerCase()
  if (/table|row|column|gdp|inflation|rate/.test(text)) return "table"
  if (/map|chart|growth|trend/.test(text)) return "chart"
  if (/tab|button|chip|filter/.test(text)) return "control"
  if (/header|nav|menu|footer/.test(text)) return "navigation"
  if (localCapture.bbox.height < 80) return "content"
  return "page-section"
}

function candidateArea(candidate: Pick<SourceRegionCandidate, "bbox">): number {
  return candidate.bbox.width * candidate.bbox.height
}

function sourceCandidateLabel(candidate: Pick<SourceRegionCandidate, "id" | "source">): string {
  return `${candidate.id} (${candidate.source})`
}

function anchorWeight(anchor: string): number {
  const generic = new Set(["overview", "section", "content", "page", "card", "item", "list"])
  if (generic.has(anchor)) return 5
  const words = anchor.split(/\s+/g).filter(Boolean).length
  return Math.min(anchor.length, 32) * (words > 1 ? 8 : 5)
}

function candidateAreaWeight(candidateAreaValue: number, localArea: number): number {
  if (!Number.isFinite(localArea) || localArea <= 0) return 0
  const ratio = candidateAreaValue / localArea
  if (ratio > 12) return -420
  if (ratio > 6) return -240
  if (ratio > 3) return -120
  if (ratio < 0.05) return -140
  if (ratio < 0.12) return -70
  return 40 - Math.round(Math.abs(Math.log2(ratio)) * 18)
}

function safeSegment(input: string): string {
  return (
    input
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "region"
  )
}

function boxLabel(box: BrowserPreviewRegionBox): string {
  return `${box.x},${box.y},${box.width}x${box.height}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  const stringValue = readString(value)
  return stringValue ? [stringValue] : []
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    const entities: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }
    return entities[char] ?? char
  })
}

const LOCAL_MODULE_CAPTURE_SCRIPT = String.raw`
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

function routeUrl(base, route) {
  return new URL(route || "/", base).toString();
}

function isBrowserImplicitAssetRequest(rawUrl) {
  try {
    return new URL(rawUrl).pathname === "/favicon.ico";
  } catch {
    return false;
  }
}

function browserActivityLabel(event, payload) {
  if (payload && typeof payload.url === "function") return event + " " + payload.url();
  if (payload && typeof payload.message === "function") return event + " " + payload.message();
  if (payload && typeof payload.message === "string") return event + " " + payload.message;
  if (payload && typeof payload.text === "function") return event + " " + payload.text();
  if (payload && typeof payload.text === "string") return event + " " + payload.text;
  if (payload && typeof payload.errorText === "string") return event + " " + payload.errorText;
  return event;
}

function taggedBrowserInactivityError(message) {
  const error = new Error(message);
  error.opencorvusBrowserInactivity = true;
  return error;
}

function isBrowserInactivityError(error) {
  return Boolean(error && error.opencorvusBrowserInactivity === true);
}

function installBrowserFailureTracker(page, label) {
  const failures = [];
  const listeners = [];
  const record = (source) => {
    if (!failures.includes(source)) failures.push(source);
  };
  const on = (event, handler) => {
    page.on(event, handler);
    listeners.push([event, handler]);
  };
  on("response", (payload) => {
    const status = typeof payload.status === "function" ? payload.status() : 0;
    const url = typeof payload.url === "function" ? payload.url() : "";
    if (status >= 400 && status < 600 && !isBrowserImplicitAssetRequest(url)) {
      record(browserActivityLabel("response", payload) + " HTTP " + status);
    }
  });
  on("requestfailed", (payload) => {
    const url = typeof payload.url === "function" ? payload.url() : "";
    if (isBrowserImplicitAssetRequest(url)) return;
    record(browserActivityLabel("requestfailed", payload));
  });
  on("pageerror", (payload) => record(browserActivityLabel("pageerror", payload)));
  return {
    assertNoFailures(stage) {
      if (failures.length > 0) throw new Error(label + " browser failure before " + stage + ": " + failures.join("; "));
    },
    dispose() {
      for (const [event, handler] of listeners) page.off(event, handler);
    },
  };
}

async function withBrowserInactivity(page, label, inactivityTimeoutMs, action) {
  let settled = false;
  let lastActivity = "start";
  let timer;
  let rejectInactive;
  let rejectFailure;
  const listeners = [];
  const inactive = new Promise((_, reject) => {
    rejectInactive = reject;
  });
  const browserFailure = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const reset = (source) => {
    if (settled) return;
    lastActivity = source;
    clearTimer();
    timer = setTimeout(() => {
      rejectInactive(taggedBrowserInactivityError(label + " browser inactive for " + inactivityTimeoutMs + "ms after " + lastActivity));
    }, inactivityTimeoutMs);
  };
  const fail = (source) => {
    if (settled) return;
    rejectFailure(new Error(label + " browser failure before source binding: " + source));
  };
  const on = (event, handler) => {
    page.on(event, handler);
    listeners.push([event, handler]);
  };
  on("console", (payload) => reset(browserActivityLabel("console", payload)));
  on("response", (payload) => {
    const status = typeof payload.status === "function" ? payload.status() : 0;
    const url = typeof payload.url === "function" ? payload.url() : "";
    if (status >= 400 && status < 600 && !isBrowserImplicitAssetRequest(url)) {
      fail(browserActivityLabel("response", payload) + " HTTP " + status);
      return;
    }
    reset(browserActivityLabel("response", payload));
  });
  on("requestfailed", (payload) => {
    const url = typeof payload.url === "function" ? payload.url() : "";
    if (isBrowserImplicitAssetRequest(url)) return;
    fail(browserActivityLabel("requestfailed", payload));
  });
  on("pageerror", (payload) => fail(browserActivityLabel("pageerror", payload)));
  reset("start");
  try {
    return await Promise.race([action(), inactive, browserFailure]);
  } finally {
    settled = true;
    clearTimer();
    for (const [event, handler] of listeners) page.off(event, handler);
  }
}

function selectorFor(locator) {
  if (locator.kind === "selector") return locator.value;
  if (locator.kind === "test-id") return "[data-testid=" + JSON.stringify(locator.value) + "]";
  if (locator.kind === "data-oc-region") return "[data-oc-region=" + JSON.stringify(locator.value) + "]";
  throw new Error("Unsupported locator kind: " + locator.kind);
}

async function findNode(page, locator) {
  if (locator.kind === "role") return page.getByRole(locator.role, { name: locator.name }).first();
  return page.locator(selectorFor(locator)).first();
}

async function main() {
  const input = JSON.parse(Buffer.from(process.env.OPENCORVUS_BROWSER_PREVIEW_LOCAL_MODULE_BINDING_INPUT || "", "base64").toString("utf8"));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: input.executablePath,
      headless: true,
      timeout: input.launchTimeoutMs,
      args: input.launchArgs,
    });
    const context = await browser.newContext({ viewport: input.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const targetUrl = routeUrl(input.url, input.route);
    const browserFailures = installBrowserFailureTracker(page, "local module source binding");
    let capture;
    let screenshotPath;
    try {
      await withBrowserInactivity(
        page,
        "navigate " + targetUrl,
        input.navigationTimeoutMs,
        () => page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 0 }),
      );
      await withBrowserInactivity(
        page,
        "networkidle " + targetUrl,
        Math.min(5000, input.navigationTimeoutMs),
        () => page.waitForLoadState("networkidle", { timeout: 0 }),
      ).catch((error) => {
        if (isBrowserInactivityError(error)) return undefined;
        throw error;
      });
      browserFailures.assertNoFailures("source binding capture");
      const locator = await findNode(page, input.locator);
      const visible = await locator.isVisible();
      if (!visible) throw new Error("Implementation locator did not match any visible element.");
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(200);
      browserFailures.assertNoFailures("source binding capture");
      const box = await locator.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) {
        throw new Error("Implementation locator did not match any visible element.");
      }
      capture = await locator.evaluate((node, bbox) => {
      const fullText = (node.innerText || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const texts = [];
      function add(value) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        if (text.length >= 2 && text.length <= 120 && !texts.includes(text)) texts.push(text);
      }
      add(node.getAttribute("aria-label"));
      for (const item of node.querySelectorAll("h1,h2,h3,h4,th,[role='columnheader'],button,a,[aria-label]")) {
        add(item.innerText || item.textContent || item.getAttribute("aria-label"));
        if (texts.length >= 16) break;
      }
      for (const line of fullText.split(/\n| {2,}/g)) {
        add(line);
        if (texts.length >= 16) break;
      }
      return {
        bbox: {
          x: Math.max(0, Math.round(bbox.x + window.scrollX)),
          y: Math.max(0, Math.round(bbox.y + window.scrollY)),
          width: Math.ceil(bbox.width),
          height: Math.ceil(bbox.height),
        },
        textAnchors: texts.slice(0, 16),
        fullText,
      };
      }, box);
      await fs.mkdir(input.outDir, { recursive: true });
      screenshotPath = path.join(input.outDir, "local-fullpage.png");
      await page.screenshot({ path: screenshotPath, type: "png", fullPage: true });
      browserFailures.assertNoFailures("source binding capture");
    } finally {
      browserFailures.dispose();
    }
    await context.close();
    process.stdout.write(JSON.stringify({ ok: true, capture: { ...capture, screenshotPath } }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, message: error?.message || String(error), stack: error?.stack }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

main();
`
