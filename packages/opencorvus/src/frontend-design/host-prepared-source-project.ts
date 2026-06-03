import fs from "node:fs/promises"
import path from "node:path"
import { decodePNG, type DecodedPNG } from "@/util/pixel-stats"
import { auditWebCloneSourceSkeletonConsumption } from "@/web-clone/source-skeleton-consumption-audit"
import {
  renderSourceProjectVisualIterationMatrix,
} from "@/web-clone/source-project-generator"

const FRONTEND_SKELETON_DEEP_REFERENCE_FILES = [
  "src/components/ContentTable.tsx",
  "src/components/SourceAssetPathGroup.tsx",
  "src/components/SourceFaqList.tsx",
  "src/data/sourceDomRegions.ts",
  "src/data/sourceDomReplacementPlan.ts",
  "src/data/sourceDomIterationState.ts",
  "src/data/sourceSvgAssetGroups.ts",
  "src/data/sourceFaqGroups.ts",
]

export interface SourceReplacementPlanForSummary {
  regionComponentName?: string
  regionFilePath?: string
  priority?: string
  replacementKind?: string
  problem?: string
  dataSources?: string[]
  assetSources?: string[]
  firstReplacementStep?: string
  parityGuard?: string
}

export interface HostPreparedFrontendProject {
  status: "created" | "blocked"
  projectRoot: string
  sourcePackage: string
  projectRootRef: string
  sourcePackageRef: string
  entrypoints: string[]
  generationTool: string
  warnings: string[]
  error?: string
  compactEvidence: string
  visualIterationMatrix?: string
  sourceReplacementPlan: SourceReplacementPlanForSummary[]
  sourceAuditEvidence?: string
}

function hostPreparedVisualIterationMatrix(project: HostPreparedFrontendProject): string {
  return project.visualIterationMatrix?.trim() || renderSourceProjectVisualIterationMatrix()
}

async function readHostPreparedSourceReplacementPlan(projectRoot: string): Promise<SourceReplacementPlanForSummary[]> {
  return readGeneratedConstArray<SourceReplacementPlanForSummary>(
    path.join(projectRoot, "src", "data", "sourceDomReplacementPlan.ts"),
    "sourceDomReplacementPlan",
  )
}

export async function readHostPreparedCompactEvidence(input: { sourcePackage: string; projectRoot: string; sourceAuditEvidence?: string }): Promise<string> {
  const referencePixelSummary = await summarizeReferencePixels(path.join(input.sourcePackage, "reference.png"))
  const sourceProjectSummary = await summarizeHostPreparedSourceProject(input.projectRoot)
  const sections: string[] = []
  if (referencePixelSummary.trim()) {
    sections.push(`## reference-pixel-summary.md\n${referencePixelSummary.trim()}`)
  }
  if (sourceProjectSummary.trim()) {
    sections.push(`## frontend-design-skeleton/source-project-handoff-summary.md\n${sourceProjectSummary.trim()}`)
  }
  if (input.sourceAuditEvidence?.trim()) {
    sections.push(`## source-audit-supervision.md\n${input.sourceAuditEvidence.trim()}`)
  }
  sections.push(renderHostPreparedEvidenceIndex())
  return sections.join("\n\n")
}

export async function summarizeHostPreparedSourceAudit(input: { sourcePackage: string; projectRoot: string }): Promise<string> {
  const lines = [
    "Host-prepared source audit supervision.",
    "This is current-state evidence for the captured source project, not a final acceptance decision.",
  ]
  for (const finalAcceptanceMode of ["visual_baseline_allowed", "maintainable_replacement_required"] as const) {
    try {
      const audit = await auditWebCloneSourceSkeletonConsumption({
        projectDir: input.projectRoot,
        sourcePackageDir: input.sourcePackage,
        finalAcceptanceMode,
      })
      lines.push(
        `- ${finalAcceptanceMode}: passed=${audit.passed}; generatedBaseline=${audit.risk.generatedBaselineDetected}; ` +
        `finalBaselineOnly=${audit.risk.finalBaselineOnlyDetected}; sourceDomResidue=${audit.risk.finalSourceDomModuleResidueDetected}; ` +
        `sourceDomModules=${audit.projectStats.sourceDomBaselineModuleCount}; sourceDomRegions=${audit.projectStats.sourceDomRegionFileCount}; ` +
        `largestSourceDomRegionBytes=${audit.projectStats.largestSourceDomRegionBytes}; oversizedGeneratedRegions=${audit.projectStats.oversizedSourceDomRegionCount}`,
      )
      for (const finding of audit.findings.slice(0, 4)) {
        lines.push(`  finding: ${finding}`)
      }
    } catch (err) {
      lines.push(`- ${finalAcceptanceMode}: audit_error=${err instanceof Error ? err.message : String(err)}`)
    }
  }
  lines.push(
    "Supervision rule: a passing visual_baseline_allowed audit proves only traceable captured-source baseline adoption. " +
    "A maintainable final remains unproven until maintainable_replacement_required passes with measured visual parity evidence.",
  )
  return lines.join("\n")
}

function renderHostPreparedEvidenceIndex(): string {
  const refs = [
    ["web-clone-source/implementation-blueprint.md", "source-derived implementation strategy and page contract"],
    ["web-clone-source/web-clone-context.md", "compact webpage/source context for Build"],
    ["web-clone-source/web-clone-implementation-contract.json", "machine-readable implementation contract"],
    ["web-clone-source/source-ir/component-tree.json", "captured page hierarchy and region names"],
    ["web-clone-source/source-ir/content-model.json", "visible repeated content and data candidates"],
    ["web-clone-source/source-ir/layout-map.json", "layout regions and dimensions"],
    ["web-clone-source/source-ir/style-tokens.json", "colors, type, spacing, and source style tokens"],
    ["web-clone-source/source-ir/interaction-hints.json", "interactive affordances from the capture"],
    ["web-clone-source/source-ir/interaction-state-snapshots.json", "browser runtime scroll/click state evidence"],
    ["web-clone-source/source-ir/source-quality-audit.json", "known extraction/source quality issues"],
    ["web-clone-source/source-skeleton/critical.css", "source critical CSS evidence"],
    ["web-clone-source/source-skeleton/source-skeleton-audit.json", "source skeleton coverage audit"],
    ["web-clone-source/visual-surface-candidates.json", "visual surface inventory"],
    ["web-clone-source/reference.png", "visual reference for overlay comparison"],
    ["frontend-design-skeleton/README.md", "source project usage and verification notes"],
    ["frontend-design-skeleton/src/App.tsx", "source project root entrypoint"],
    ["frontend-design-skeleton/src/components/SourceClonePage.tsx", "high-fidelity source baseline page"],
    ["frontend-design-skeleton/src/components/SourceDomPage.tsx", "generated DOM baseline wrapper"],
    ["frontend-design-skeleton/src/components/source-dom/*Region.tsx", "named generated source-dom regions"],
    ["frontend-design-skeleton/src/data/sourceProjectManifest.json", "source project manifest and region counts"],
    ["frontend-design-skeleton/src/data/sourceDomReplacementPlan.ts", "known-problem and region-replacement map"],
    ["frontend-design-skeleton/src/data/sourceDomIterationState.ts", "static replacement progress metadata and next candidate source region"],
    ["frontend-design-skeleton/src/data/sourceDomRegions.ts", "region registry"],
    ["frontend-design-skeleton/src/data/sourceData.ts", "source-derived repeated content data"],
    ["frontend-design-skeleton/src/data/sourceSvgAssetGroups.ts", "SVG asset grouping"],
    ["frontend-design-skeleton/src/data/sourceFaqGroups.ts", "FAQ source groups"],
    ["frontend-design-skeleton/src/data/svgPaths.ts", "captured SVG path data"],
    ["frontend-design-skeleton/src/styles.css", "source project stylesheet entry"],
    ["frontend-design-skeleton/src/styles/source-critical.css", "captured critical CSS sidecar"],
    ["frontend-design-skeleton/src/styles/source-full.css", "captured full CSS sidecar"],
    ["frontend-design-skeleton/public/assets/", "copied source assets"],
  ]
  const lines = [
    "## host-prepared-evidence-index.md",
    "Large source files are not inlined in this host-prepared turn. frontend_design should read only bounded evidence files needed for the current uncertainty, then submit the full public frontend template. Downstream agents must use the public task-runtime refs above for implementation details.",
    "",
  ]
  for (const [ref, purpose] of refs) lines.push(`- ${ref}: ${purpose}`)
  return lines.join("\n")
}

interface SourceProjectManifestForSummary {
  sourceDomRegions?: {
    count?: number
    largestBytes?: number
    highPriorityCount?: number
    replacementPlanCount?: number
    iterationStateModule?: string
    semanticReplacementCount?: number
    svgAssetGroupCount?: number
    faqGroupCount?: number
    metricsModule?: string
    replacementPlanModule?: string
    svgAssetGroupModule?: string
    faqGroupModule?: string
  }
  semanticReplacements?: {
    count?: number
    iterationStateModule?: string
    components?: string[]
  }
  visualIteration?: {
    referenceImage?: string
    comparisonTool?: string
    viewportMatrix?: Array<{
      name?: string
      width?: number
      height?: number
      evidenceRole?: string
      comparison?: string
    }>
    rule?: string
  }
}

interface SourceDomIterationStateForSummary {
  generatedRegionCount?: number
  semanticReplacementCount?: number
  remainingRegionCount?: number
  nextReplacement?: {
    regionComponentName?: string
    regionFilePath?: string
    priority?: string
    replacementKind?: string
    recommendedComponentName?: string
    firstReplacementStep?: string
    parityGuard?: string
  } | null
}

export async function summarizeHostPreparedSourceProject(projectRoot: string): Promise<string> {
  const manifest = await readJsonFile<SourceProjectManifestForSummary>(path.join(projectRoot, "src", "data", "sourceProjectManifest.json"))
  const replacementPlan = await readGeneratedConstArray<SourceReplacementPlanForSummary>(
    path.join(projectRoot, "src", "data", "sourceDomReplacementPlan.ts"),
    "sourceDomReplacementPlan",
  )
  const iterationState = await readGeneratedConstObject<SourceDomIterationStateForSummary>(
    path.join(projectRoot, "src", "data", "sourceDomIterationState.ts"),
    "sourceDomIterationState",
  )
  const sidecars = await existingProjectSidecars(projectRoot)
  if (!manifest && replacementPlan.length === 0 && !iterationState && sidecars.length === 0) return ""

  const lines: string[] = [
    "Host-prepared source project maintainability summary.",
    "Use this as the compact handoff map before reading large source-dom region files.",
  ]
  const visualIteration = manifest?.visualIteration
  if (visualIteration) {
    lines.push("")
    lines.push("Visual iteration matrix:")
    lines.push(`- referenceImage: ${visualIteration.referenceImage ?? "unknown"}`)
    lines.push(`- comparisonTool: ${visualIteration.comparisonTool ?? "unknown"}`)
    for (const viewport of visualIteration.viewportMatrix ?? []) {
      const size = typeof viewport.width === "number" && typeof viewport.height === "number"
        ? `${viewport.width}x${viewport.height}`
        : "unknown"
      lines.push(`- ${viewport.name ?? "viewport"}: ${size} (${viewport.evidenceRole ?? "unknown"})`)
      if (viewport.comparison) lines.push(`  comparison: ${viewport.comparison}`)
    }
    if (visualIteration.rule) lines.push(`- rule: ${visualIteration.rule}`)
  }
  const regions = manifest?.sourceDomRegions
  if (regions) {
    lines.push("")
    lines.push("Source-dom region stats:")
    lines.push(`- count: ${regions.count ?? "unknown"}`)
    lines.push(`- largestBytes: ${regions.largestBytes ?? "unknown"}`)
    lines.push(`- highPriorityCount: ${regions.highPriorityCount ?? "unknown"}`)
    lines.push(`- replacementPlanCount: ${regions.replacementPlanCount ?? "unknown"}`)
    lines.push(`- iterationStateModule: ${regions.iterationStateModule ?? manifest?.semanticReplacements?.iterationStateModule ?? "unknown"}`)
    lines.push(`- semanticReplacementCount: ${regions.semanticReplacementCount ?? manifest?.semanticReplacements?.count ?? "unknown"}`)
    lines.push(`- svgAssetGroupCount: ${regions.svgAssetGroupCount ?? "unknown"}`)
    lines.push(`- faqGroupCount: ${regions.faqGroupCount ?? "unknown"}`)
  }

  if (iterationState) {
    lines.push("")
    lines.push("Maintainable iteration state:")
    lines.push(`- generatedRegionCount: ${iterationState.generatedRegionCount ?? "unknown"}`)
    lines.push(`- semanticReplacementCount: ${iterationState.semanticReplacementCount ?? "unknown"}`)
    lines.push(`- remainingRegionCount: ${iterationState.remainingRegionCount ?? "unknown"}`)
    const nextReplacement = iterationState.nextReplacement
    if (nextReplacement) {
      lines.push(`- nextReplacement: ${nextReplacement.regionComponentName ?? nextReplacement.regionFilePath ?? "unknown region"} -> ${nextReplacement.recommendedComponentName ?? "unknown component"}`)
      lines.push(`  priority: ${nextReplacement.priority ?? "unknown"}, kind: ${nextReplacement.replacementKind ?? "unknown"}`)
      if (nextReplacement.firstReplacementStep) lines.push(`  firstReplacementStep: ${nextReplacement.firstReplacementStep}`)
      if (nextReplacement.parityGuard) lines.push(`  parityGuard: ${nextReplacement.parityGuard}`)
    } else {
      lines.push("- nextReplacement: none; rerun the maintainable audit and visual comparison before claiming final acceptance.")
    }
  }

  if (sidecars.length > 0) {
    lines.push("")
    lines.push("Source sidecars to read as extraction evidence, then retire from final target app source:")
    for (const sidecar of sidecars) lines.push(`- ${sidecar}`)
  }

  if (replacementPlan.length > 0) {
    lines.push("")
    lines.push(`Complete in-scope replacement queue (${replacementPlan.length} rows):`)
    for (const item of replacementPlan
      .slice()
      .sort(compareReplacementPriority)) {
      const name = item.regionComponentName ?? item.regionFilePath ?? "unknown region"
      const priority = item.priority ?? "unknown"
      const kind = item.replacementKind ?? "unknown"
      lines.push(`- ${name}: priority=${priority}, kind=${kind}`)
      if (item.firstReplacementStep) lines.push(`  firstReplacementStep: ${item.firstReplacementStep}`)
      const dataSources = item.dataSources?.filter(Boolean)
      if (dataSources?.length) lines.push(`  dataSources: ${dataSources.join(", ")}`)
      const assetSources = item.assetSources?.filter(Boolean)
      if (assetSources?.length) lines.push(`  assetSources: ${assetSources.join(", ")}`)
      if (item.parityGuard) lines.push(`  parityGuard: ${item.parityGuard}`)
    }
  }

  lines.push("")
  lines.push("Extraction rule: frontend_design should start from sourceDomIterationState.ts, then consume sourceDomReplacementPlan.ts, inspect existing target-project components/libraries before coding, and extract each source-dom region into target-project semantic source only when parity can be preserved. The skeleton remains evidence; it is not the final working project.")
  return lines.join("\n")
}

async function existingProjectSidecars(projectRoot: string): Promise<string[]> {
  const candidates = [
    "src/components/source-dom/*Region.tsx",
    "src/data/sourceDomRegions.ts",
    "src/data/sourceDomReplacementPlan.ts",
    "src/data/sourceDomIterationState.ts",
    "src/data/sourceSvgAssetGroups.ts",
    "src/data/sourceFaqGroups.ts",
    "src/data/sourceData.ts",
    "src/data/svgPaths.ts",
    "src/styles/source-critical.css",
    "src/styles/source-full.css",
    "public/assets/",
  ]
  const existing: string[] = []
  for (const candidate of candidates) {
    if (candidate.includes("*")) {
      const directory = path.join(projectRoot, candidate.slice(0, candidate.indexOf("*")))
      if (await pathExists(directory)) existing.push(candidate)
      continue
    }
    const candidatePath = path.join(projectRoot, candidate)
    if (await pathExists(candidatePath)) existing.push(candidate)
  }
  return existing
}

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

async function readGeneratedConstArray<T>(file: string, constName: string): Promise<T[]> {
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`export const ${escapedName} = (\\[[\\s\\S]*?\\]) as const`).exec(text)
  if (!match?.[1]) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

async function readGeneratedConstObject<T>(file: string, constName: string): Promise<T | undefined> {
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`export const ${escapedName} = (\\{[\\s\\S]*\\}) as const`).exec(text)
  if (!match?.[1]) return undefined
  try {
    const parsed = JSON.parse(match[1])
    return parsed && typeof parsed === "object" ? parsed as T : undefined
  } catch {
    return undefined
  }
}

function compareReplacementPriority(a: SourceReplacementPlanForSummary, b: SourceReplacementPlanForSummary): number {
  const rank = (value?: string) => value === "high" ? 0 : value === "medium" ? 1 : value === "low" ? 2 : 3
  return rank(a.priority) - rank(b.priority)
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

interface PixelRegionSummary {
  label: string
  yRange: string
  sampleCount: number
  avgRgb: [number, number, number]
  avgLuminance: number
  nearWhiteRatio: number
  lightRatio: number
  darkRatio: number
  topColors: string[]
  tone: "light" | "dark" | "mixed"
}

export async function summarizeReferencePixels(referencePath: string): Promise<string> {
  let img: DecodedPNG
  try {
    img = await decodePNG(referencePath)
  } catch {
    return ""
  }

  const viewportHeight = Math.min(img.height, 900)
  const regions = [
    summarizePixelRegion(img, "top navigation band", 0, Math.min(img.height, 96)),
    summarizePixelRegion(img, "first viewport", 0, viewportHeight),
    summarizePixelRegion(img, "main fold below navigation", Math.min(img.height, 96), viewportHeight),
    summarizePixelRegion(img, "page middle band", Math.floor(img.height * 0.42), Math.floor(img.height * 0.58)),
    summarizePixelRegion(img, "bottom band", Math.max(0, img.height - Math.min(900, Math.ceil(img.height * 0.18))), img.height),
  ].filter((region): region is PixelRegionSummary => !!region)

  const firstViewport = regions.find((region) => region.label === "first viewport")
  const mainFold = regions.find((region) => region.label === "main fold below navigation")
  const darkBands = findDarkHorizontalBands(img)
  const lines: string[] = [
    `Source: ${path.basename(referencePath)} (${img.width}x${img.height})`,
    "Deterministic pixel summary from the reference screenshot. This is visual evidence, not an acceptance decision.",
    "",
    "Region tones:",
  ]

  for (const region of regions) {
    lines.push(
      `- ${region.label} (${region.yRange}): ${region.tone}; ` +
      `avg rgb(${region.avgRgb.join(", ")}), luminance ${formatRatio(region.avgLuminance / 255)}, ` +
      `near-white ${formatPercent(region.nearWhiteRatio)}, light ${formatPercent(region.lightRatio)}, ` +
      `dark ${formatPercent(region.darkRatio)}, top colors ${region.topColors.join(", ")}`,
    )
  }

  if (darkBands.length > 0) {
    lines.push("")
    lines.push("Detected localized dark horizontal bands:")
    for (const band of darkBands.slice(0, 5)) {
      lines.push(`- y=${band.start}-${band.end}, approx ${band.height}px tall`)
    }
  }

  const mainIsLight = [firstViewport, mainFold]
    .filter((region): region is PixelRegionSummary => !!region)
    .some((region) => region.tone === "light" && region.darkRatio < 0.18)
  if (mainIsLight) {
    lines.push("")
    lines.push(
      "Theme evidence: the visible first viewport/main fold is light. Dark CSS/token frequency maps to localized text, footer, chart, icon, or asset color unless a specific region above is dark.",
    )
  }

  return lines.join("\n")
}

function summarizePixelRegion(img: DecodedPNG, label: string, y0: number, y1: number): PixelRegionSummary | undefined {
  const top = clampInt(y0, 0, img.height)
  const bottom = clampInt(y1, 0, img.height)
  if (bottom <= top) return undefined
  const width = img.width
  const height = bottom - top
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 24_000)))
  const colorBuckets = new Map<string, number>()
  let samples = 0
  let rSum = 0
  let gSum = 0
  let bSum = 0
  let luminanceSum = 0
  let nearWhite = 0
  let light = 0
  let dark = 0

  for (let y = top; y < bottom; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * img.width + x) * 4
      const a = img.data[idx + 3]
      if (a < 16) continue
      const r = img.data[idx]
      const g = img.data[idx + 1]
      const b = img.data[idx + 2]
      const lum = luminance(r, g, b)
      samples++
      rSum += r
      gSum += g
      bSum += b
      luminanceSum += lum
      if (lum >= 245 && r >= 240 && g >= 240 && b >= 240) nearWhite++
      if (lum >= 218) light++
      if (lum <= 72) dark++
      const color = bucketHex(r, g, b)
      colorBuckets.set(color, (colorBuckets.get(color) ?? 0) + 1)
    }
  }

  if (samples === 0) return undefined
  const nearWhiteRatio = nearWhite / samples
  const lightRatio = light / samples
  const darkRatio = dark / samples
  const avgLuminance = luminanceSum / samples
  const tone: PixelRegionSummary["tone"] =
    lightRatio >= 0.58 && darkRatio <= 0.22 ? "light"
      : darkRatio >= 0.45 && lightRatio <= 0.32 ? "dark"
        : "mixed"

  return {
    label,
    yRange: `${top}-${bottom}`,
    sampleCount: samples,
    avgRgb: [
      Math.round(rSum / samples),
      Math.round(gSum / samples),
      Math.round(bSum / samples),
    ],
    avgLuminance: Math.round(avgLuminance),
    nearWhiteRatio,
    lightRatio,
    darkRatio,
    topColors: Array.from(colorBuckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([color]) => color),
    tone,
  }
}

function findDarkHorizontalBands(img: DecodedPNG): Array<{ start: number; end: number; height: number }> {
  const rowStep = Math.max(1, Math.ceil(img.height / 900))
  const xStep = Math.max(1, Math.ceil(img.width / 240))
  const darkRows: number[] = []
  for (let y = 0; y < img.height; y += rowStep) {
    let samples = 0
    let dark = 0
    let lumSum = 0
    for (let x = 0; x < img.width; x += xStep) {
      const idx = (y * img.width + x) * 4
      if (img.data[idx + 3] < 16) continue
      const lum = luminance(img.data[idx], img.data[idx + 1], img.data[idx + 2])
      samples++
      lumSum += lum
      if (lum <= 80) dark++
    }
    if (samples === 0) continue
    const darkRatio = dark / samples
    const avgLum = lumSum / samples
    if (darkRatio >= 0.35 && avgLum <= 150) darkRows.push(y)
  }

  const bands: Array<{ start: number; end: number; height: number }> = []
  let start: number | undefined
  let prev: number | undefined
  for (const y of darkRows) {
    if (start === undefined || prev === undefined || y - prev > rowStep * 2) {
      if (start !== undefined && prev !== undefined) pushBand(bands, start, prev + rowStep)
      start = y
    }
    prev = y
  }
  if (start !== undefined && prev !== undefined) pushBand(bands, start, prev + rowStep)
  return bands
    .filter((band) => band.height >= 32)
    .sort((a, b) => b.height - a.height)
}

function pushBand(bands: Array<{ start: number; end: number; height: number }>, start: number, end: number) {
  const boundedStart = Math.max(0, start)
  const boundedEnd = Math.max(boundedStart, end)
  bands.push({ start: boundedStart, end: boundedEnd, height: boundedEnd - boundedStart })
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function bucketHex(r: number, g: number, b: number): string {
  const bucket = (value: number) => Math.max(0, Math.min(255, Math.floor(value / 16) * 16 + 8))
  const hex = (value: number) => value.toString(16).padStart(2, "0")
  return `#${hex(bucket(r))}${hex(bucket(g))}${hex(bucket(b))}`
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatRatio(value: number): string {
  return value.toFixed(2)
}

export function renderHostPreparedFrontendProjectSection(project: HostPreparedFrontendProject): string {
  const visualIterationMatrix = hostPreparedVisualIterationMatrix(project)
  const lines = [
    "# Host-Prepared Frontend Project",
    "",
    "The host already prepared the frontend-design high-fidelity skeleton evidence project before this model turn. Do not call `create_frontend_skeleton_project` again unless status is blocked and you can name a different output path.",
    "Host-prepared means source evidence exists; it does not mean the frontend template is already designed. Use `read_file`, `list_directory`, `find_files`, and `search_code` to inspect the bounded task-runtime evidence and obvious target project/package/component structure before finalizing. Do not call webpage evidence acquisition tools again unless the host-prepared status is blocked and you can name the exact missing evidence.",
    "Register `frontend-design-skeleton` only as source_baseline_input evidence. Register role=implementation_target only for the target acceptance project after frontend_design has extracted the requested surface into maintainable target-project source; otherwise use role=source_baseline_input and name the unfinished source debt. Build receives the target project for integration and precision fixes, not for primary rawproject-to-maintainable conversion.",
    "Do not install, build, render, or start a dev/preview server inside `frontend-design-skeleton` during maintainable acceptance. Create or populate the target acceptance project first; all build, render, visual comparison, and maintainable audit commands must run against that target project.",
    "Use the maintainable rawproject refactor algorithm inside the normal frontend-design agent flow: source map, region map, one replacement decision per region, then vertical-slice extraction into the target project with source data extraction, semantic component boundary, scoped style ownership, no generated fixed-layout boundary in target source, asset ownership, interaction wiring, screenshot comparison, and audit evidence. Do not replace this judgment with host-side deterministic selector/card/table/map extraction rules.",
    `Visual iteration viewport matrix: ${visualIterationMatrix}`,
    "For webpage clones, perform and describe source-region traceable refactoring: every new component, data module, scoped style, and boundary cleanup must map back to rawproject source nodes/regions/assets/reference screenshots. A region replacement is complete only after source data extraction, semantic component rendering, scoped CSS, generated boundary cleanup, screenshot comparison for that region, measured webpage_evaluate evidence for the visual iteration viewport matrix, and zero-finding web_clone_source_audit evidence before any final maintainability claim. If a region is deferred, frontend_design must label it as unfinished source debt.",
    "Do not alter evaluators, other agent prompts, communication paths, generated outputs, or runtime source packages to satisfy the report.",
    "Webpage/source evidence stays in task runtime paths. Do not instruct downstream agents to move or clean `web-clone-source/`, `frontend-design-skeleton/`, raw `webpage-evidence/`, `references/`, or `reference.png` into the acceptance root as app-owned deliverables; extract only the observed source structure, data, styles, and assets needed by the target project.",
    "Do not output a standalone component checklist or advice-only report. Use the full `submit_frontend_template` schema to identify the source baseline, replacement plan, quality project contract, visual/data contracts, completeness review, and open questions needed to produce the maintainable project source.",
    "Principle for frontend_design source work: inspect the target app structure first; reuse existing repository components/design-system primitives; use mature maintained libraries for hard UI domains; custom-code only simple glue and micro-adjustments needed for parity. Use the embedded source-project-handoff summary and the referenced sourceDomIterationState.ts/sourceDomReplacementPlan.ts as static progress metadata and the known-problem map.",
    "",
    `- status: ${project.status}`,
    "- role: source_baseline_input",
    `- project_root: ${project.projectRoot}`,
    `- source_package: ${project.sourcePackage}`,
    `- public_project_root_ref: ${project.projectRootRef}`,
    `- public_source_package_ref: ${project.sourcePackageRef}`,
    `- generation_tool: ${project.generationTool}`,
    `- entrypoints: ${project.entrypoints.join(", ") || "(none)"}`,
    `- deep_reference_files: ${FRONTEND_SKELETON_DEEP_REFERENCE_FILES.join(", ")}`,
  ]
  if (project.warnings.length > 0) {
    lines.push("- warnings:")
    for (const warning of project.warnings) lines.push(`  - ${warning}`)
  }
  if (project.error) lines.push(`- error: ${project.error}`)
  if (project.compactEvidence.trim()) {
    lines.push("")
    lines.push("# Host-Prepared Source Evidence")
    lines.push(project.compactEvidence.trim())
  }
  lines.push("")
  lines.push("# Finalization")
  lines.push("After bounded evidence read/review plus target-project source-region extraction you can complete with the exposed tools, call `submit_frontend_template` with the full frontend-design contract. The report must identify the target acceptance project as `implementation_target` only when it contains the maintainable extracted source, describe completed source-region replacements, and name any unfinished source debt as frontend_design incomplete/blocked work rather than Build follow-up work.")
  lines.push("Host-prepared webpage rawproject refinement stays in `final_acceptance_mode=maintainable_replacement_required`; deferred regions must be reported as unfinished source debt. If compact evidence leaves a named uncertainty, resolve it by reading the smallest relevant source file excerpt instead of replacing agent reasoning with a host-generated generic report.")
  return lines.join("\n")
}
