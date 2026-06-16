import fs from "node:fs/promises"
import path from "node:path"
import {
  inspectWebCloneSourceManifest,
  listExistingWebCloneSourcePackageContamination,
  readPngEvidence,
  WEB_CLONE_SOURCE_PACKAGE_DIR,
} from "./evidence-integrity"

export interface WebCloneSourceSkeletonConsumptionAuditInput {
  projectDir: string
  sourcePackageDir: string
  outputPath?: string
  finalAcceptanceMode: WebCloneFinalAcceptanceMode
}

export type WebCloneFinalAcceptanceMode = "visual_baseline_allowed" | "maintainable_replacement_required"

export interface WebCloneSourceSkeletonConsumptionAudit {
  version: 1
  purpose: "web-clone-source-skeleton-consumption-audit"
  passed: boolean
  finalAcceptanceMode: WebCloneFinalAcceptanceMode
  projectDir: string
  sourcePackageDir: string
  sourceEvidence: {
    referenceImageExists: boolean
    referenceImageValidPng: boolean
    referenceImageWidth?: number
    referenceImageHeight?: number
    referenceImageSha256?: string
    sourceSkeletonExists: boolean
    contentModelExists: boolean
    componentTreeExists: boolean
    criticalCssExists: boolean
  }
  projectStats: {
    sourceFileCount: number
    componentFileCount: number
    cssBytes: number
    htmlStringBytes: number
    largestHtmlStringBytes: number
    dataArrayCount: number
    renderLoopCount: number
    base64DataUriCount: number
    sourceDomRegionFileCount: number
    sourceDomPageExists: boolean
    sourceDomBaselineModuleCount: number
    largestSourceDomRegionBytes: number
    oversizedSourceDomRegionCount: number
    sourceDomReplacementPlanExists: boolean
    sourceDomIterationStateExists: boolean
    semanticReplacementFileCount: number
    sourceSvgAssetGroupExists: boolean
    sourceFaqGroupExists: boolean
  }
  sourceCoverage: {
    requiredTextCount: number
    matchedTextCount: number
    textCoverageRatio: number
    matchedTextSamples: string[]
    missingTextSamples: string[]
    componentNameHits: string[]
  }
  structureCoverage: {
    sourceComponentCount: number
    repeatedStructureCount: number
    repeatedStructureRequiresDataLoops: boolean
    dataArrayDetected: boolean
    renderLoopDetected: boolean
  }
  risk: {
    defaultScaffoldDetected: boolean
    htmlReplayDetected: boolean
    manualDomMutationDetected: boolean
    denseInlineAssetDetected: boolean
    referenceImageReplayDetected: boolean
    hiddenSemanticContentDetected: boolean
    skeletonIgnored: boolean
    generatedBaselineDetected: boolean
    finalBaselineOnlyDetected: boolean
    finalSourceDomModuleResidueDetected: boolean
    mechanicalSkeletonConversionDetected: boolean
    thirdPartyCssRuntimeLoaderDetected: boolean
    sourcePackageContaminated: boolean
    oversizedGeneratedRegionDetected: boolean
  }
  findings: string[]
}

export interface WebCloneSourceSkeletonConsumptionEvidenceResult {
  referenced: boolean
  ok: boolean
  auditPath?: string
  findings: string[]
}

const SOURCE_FILE_RE = /\.(?:js|jsx|mjs|cjs|ts|tsx|vue|svelte|html|css|scss|sass|less)$/i
const DATA_SOURCE_FILE_RE = /^(?:src|app|pages|components|views|routes|lib|data)\/.*\.json$/i
const COMPONENT_FILE_RE =
  /(?:^|\/)(?:src\/)?(?:components|pages|views|routes|app)\/.*\.(?:jsx|tsx|vue|svelte|ts|js)$|(?:^|\/)src\/[A-Z][\w.-]*\.(?:jsx|tsx|vue|svelte)$/i
const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".opencorvus",
  ".tmp",
  "build",
  "coverage",
  "frontend-design-skeleton",
  "dist",
  "node_modules",
  "out",
  "source-ir",
  "source-skeleton",
  "references",
  "web-clone-source",
])

const DEFAULT_SCAFFOLD_PATTERNS = [
  /\bGet started\b/i,
  /\bEdit src\/App\.(?:jsx|tsx|vue|ts|js)\b/i,
  /\bClick on the Vite and React logos\b/i,
  /\bVite logo\b/i,
  /\bReact logo\b/i,
  /\bcount is\b/i,
  /\bvite\.svg\b/i,
  /\breact\.svg\b/i,
  /\bvite\.dev\b/i,
  /\breact\.dev\b/i,
]

const SOURCE_DOM_REGION_OVERSIZE_BYTES = 32_000

export async function auditWebCloneSourceSkeletonConsumption(
  input: WebCloneSourceSkeletonConsumptionAuditInput,
): Promise<WebCloneSourceSkeletonConsumptionAudit> {
  const projectDir = path.resolve(input.projectDir)
  const sourcePackageDir = path.resolve(input.sourcePackageDir)
  const finalAcceptanceMode = input.finalAcceptanceMode
  if (!finalAcceptanceMode) {
    throw new Error("web-clone source audit requires explicit finalAcceptanceMode")
  }
  const sourceLabel = normalizePath(path.basename(sourcePackageDir) || "web-clone-source")
  const referenceImagePath = path.join(sourcePackageDir, "reference.png")
  const sourceSkeletonPath = path.join(sourcePackageDir, "source-skeleton", "index.html")
  const criticalCssPath = path.join(sourcePackageDir, "source-skeleton", "critical.css")
  const contentModelPath = path.join(sourcePackageDir, "source-ir", "content-model.json")
  const componentTreePath = path.join(sourcePackageDir, "source-ir", "component-tree.json")
  const referenceImage = await readPngEvidence(referenceImagePath)
  const contaminatedSourceArtifacts = await listExistingWebCloneSourcePackageContamination(sourcePackageDir)
  const sourcePackageManifestPath = path.join(sourcePackageDir, "web-clone-source-manifest.json")
  const requiresSourceManifest =
    path.basename(sourcePackageDir).toLowerCase() === WEB_CLONE_SOURCE_PACKAGE_DIR ||
    (await exists(sourcePackageManifestPath))
  const manifestIntegrity = requiresSourceManifest
    ? await inspectWebCloneSourceManifest(sourcePackageDir)
    : { passed: true, findings: [] }

  const [sourceSkeleton, contentModel, componentTree] = await Promise.all([
    readOptional(sourceSkeletonPath),
    readJsonOptional(contentModelPath),
    readJsonOptional(componentTreePath),
  ])
  const sourceEvidence = {
    referenceImageExists: await exists(referenceImagePath),
    referenceImageValidPng: referenceImage.valid,
    referenceImageWidth: referenceImage.width,
    referenceImageHeight: referenceImage.height,
    referenceImageSha256: referenceImage.sha256,
    sourceSkeletonExists: sourceSkeleton.length > 0,
    contentModelExists: contentModel !== undefined,
    componentTreeExists: componentTree !== undefined,
    criticalCssExists: await exists(criticalCssPath),
  }
  const sourceFiles = await listSourceFiles(projectDir)
  const projectSources = await Promise.all(
    sourceFiles.map(async (file) => ({
      file,
      relative: normalizePath(path.relative(projectDir, file)),
      text: await fs.readFile(file, "utf8").catch(() => ""),
      bytes: (await fs.stat(file)).size,
    })),
  )
  const projectText = projectSources.map((source) => source.text).join("\n")
  const generatedBaselineDetected = detectFrontendDesignGeneratedBaseline(projectSources)
  const nonBaselineSources = generatedBaselineDetected
    ? projectSources.filter((source) => !isFrontendDesignGeneratedBaselineFile(source.relative))
    : projectSources
  const nonBaselineText = nonBaselineSources.map((source) => source.text).join("\n")
  const cssBytes = projectSources
    .filter((source) => /\.(?:css|scss|sass|less)$/i.test(source.relative))
    .reduce((sum, source) => sum + source.bytes, 0)
  const htmlStringStats = countHtmlStringStats(projectText)
  const base64DataUriCount = projectText.match(/data:[^"')\s]+;base64,/g)?.length ?? 0
  const sourceDomRegionSources = projectSources.filter((source) =>
    /^src\/components\/source-dom\/.+\.tsx$/i.test(source.relative),
  )
  const sourceDomBaselineModuleSources = projectSources.filter((source) =>
    isFinalSourceDomBaselineResidueFile(source.relative),
  )
  const sourceDomRegionBytes = sourceDomRegionSources.map((source) => source.bytes)
  const largestSourceDomRegionBytes = Math.max(0, ...sourceDomRegionBytes)
  const oversizedSourceDomRegionSources = sourceDomRegionSources.filter(
    (source) => source.bytes >= SOURCE_DOM_REGION_OVERSIZE_BYTES,
  )
  const oversizedGeneratedRegionDetected = generatedBaselineDetected && oversizedSourceDomRegionSources.length > 0
  const sourceDomReplacementPlanExists = projectSources.some(
    (source) => source.relative === "src/data/sourceDomReplacementPlan.ts",
  )
  const sourceDomIterationStateExists = projectSources.some(
    (source) => source.relative === "src/data/sourceDomIterationState.ts",
  )
  const semanticReplacementSources = projectSources.filter((source) =>
    /^src\/components\/semantic\/.+\.tsx$/i.test(source.relative),
  )
  const sourceSvgAssetGroupExists = projectSources.some(
    (source) => source.relative === "src/data/sourceSvgAssetGroups.ts",
  )
  const sourceFaqGroupExists = projectSources.some((source) => source.relative === "src/data/sourceFaqGroups.ts")
  const dataArrayCount = countDataArrays(projectSources)
  const renderLoopCount = countRenderLoops(projectText)
  const componentNames = readComponentNames(componentTree)
  const componentNameHits = componentNames.filter((name) => sourceContains(projectText, name))
  const textSignals = collectReferenceTextSignals({ sourceSkeleton, contentModel, componentTree })
  const matchedTexts = textSignals.filter((signal) => sourceContains(projectText, signal))
  const missingTexts = textSignals.filter((signal) => !sourceContains(projectText, signal))
  const sourceComponentCount = componentNames.length
  const repeatedStructureCount = readRepeatedStructureCount(contentModel)
  const repeatedStructureRequiresDataLoops = repeatedStructureCount > 0
  const defaultScaffoldDetected = DEFAULT_SCAFFOLD_PATTERNS.filter((pattern) => pattern.test(projectText)).length >= 2
  const manualDomMutationDetected =
    /\bdocument\.create(?:Element|ElementNS|TextNode|DocumentFragment)\s*\(|\.(?:innerHTML|insertAdjacentHTML)\b|\bDOMParser\s*\(/.test(
      nonBaselineText,
    )
  const htmlReplayDetected =
    countHtmlStringStats(nonBaselineText).htmlStringBytes > 40_000 ||
    /dangerouslySetInnerHTML\s*=|v-html\s*=|{@html\s+/.test(nonBaselineText)
  const denseInlineAssetDetected = detectDenseInlineAssets(
    nonBaselineSources,
    nonBaselineText.match(/data:[^"')\s]+;base64,/g)?.length ?? 0,
  )
  const referenceImageReplayDetected = detectReferenceImageReplay(nonBaselineSources, referenceImagePath)
  const hiddenSemanticContentDetected = detectHiddenSemanticContent(nonBaselineSources)
  const mechanicalSkeletonConversionDetected = detectMechanicalSkeletonConversion(nonBaselineSources)
  const thirdPartyCssRuntimeLoaderDetected = detectThirdPartyCssRuntimeLoader(nonBaselineSources)
  const sourcePackageContaminated = contaminatedSourceArtifacts.length > 0
  const textCoverageRatio = textSignals.length === 0 ? 0 : matchedTexts.length / textSignals.length
  const skeletonIgnored =
    !generatedBaselineDetected &&
    textSignals.length > 0 &&
    (matchedTexts.length < Math.min(3, textSignals.length) || textCoverageRatio < 0.25)
  const finalBaselineOnlyDetected =
    finalAcceptanceMode === "maintainable_replacement_required" && generatedBaselineDetected
  const finalSourceDomModuleResidueDetected =
    finalAcceptanceMode === "maintainable_replacement_required" && sourceDomBaselineModuleSources.length > 0

  const projectStats = {
    sourceFileCount: sourceFiles.length,
    componentFileCount: componentFileCount(projectSources),
    cssBytes,
    htmlStringBytes: htmlStringStats.htmlStringBytes,
    largestHtmlStringBytes: htmlStringStats.largestHtmlStringBytes,
    dataArrayCount,
    renderLoopCount,
    base64DataUriCount,
    sourceDomRegionFileCount: sourceDomRegionSources.length,
    sourceDomPageExists: projectSources.some((source) => source.relative === "src/components/SourceDomPage.tsx"),
    sourceDomBaselineModuleCount: sourceDomBaselineModuleSources.length,
    largestSourceDomRegionBytes,
    oversizedSourceDomRegionCount: oversizedSourceDomRegionSources.length,
    sourceDomReplacementPlanExists,
    sourceDomIterationStateExists,
    semanticReplacementFileCount: semanticReplacementSources.length,
    sourceSvgAssetGroupExists,
    sourceFaqGroupExists,
  }
  const sourceCoverage = {
    requiredTextCount: textSignals.length,
    matchedTextCount: matchedTexts.length,
    textCoverageRatio,
    matchedTextSamples: matchedTexts.slice(0, 12),
    missingTextSamples: missingTexts.slice(0, 12),
    componentNameHits: componentNameHits.slice(0, 12),
  }
  const structureCoverage = {
    sourceComponentCount,
    repeatedStructureCount,
    repeatedStructureRequiresDataLoops,
    dataArrayDetected: dataArrayCount > 0,
    renderLoopDetected: renderLoopCount > 0,
  }
  const risk = {
    defaultScaffoldDetected,
    htmlReplayDetected,
    manualDomMutationDetected,
    denseInlineAssetDetected,
    referenceImageReplayDetected,
    hiddenSemanticContentDetected,
    skeletonIgnored,
    generatedBaselineDetected,
    finalBaselineOnlyDetected,
    finalSourceDomModuleResidueDetected,
    mechanicalSkeletonConversionDetected,
    thirdPartyCssRuntimeLoaderDetected,
    sourcePackageContaminated,
    oversizedGeneratedRegionDetected,
  }
  const findings: string[] = []
  if (!sourceEvidence.referenceImageValidPng)
    findings.push(
      `Missing or invalid ${sourceLabel}/reference.png visual truth (${referenceImage.error ?? "invalid PNG"}).`,
    )
  if (!manifestIntegrity.passed)
    findings.push(`Source package manifest failed: ${manifestIntegrity.findings.join("; ")}`)
  if (!sourceEvidence.sourceSkeletonExists)
    findings.push(`Missing ${sourceLabel}/source-skeleton/index.html source skeleton.`)
  if (!sourceEvidence.contentModelExists)
    findings.push(`Missing ${sourceLabel}/source-ir/content-model.json semantic content model.`)
  if (!sourceEvidence.componentTreeExists)
    findings.push(`Missing ${sourceLabel}/source-ir/component-tree.json semantic component tree.`)
  if (!sourceEvidence.criticalCssExists)
    findings.push(`Missing ${sourceLabel}/source-skeleton/critical.css CSS handoff.`)
  if (sourceFiles.length === 0)
    findings.push("No project-owned source files were found outside generated/build/evidence directories.")
  if (defaultScaffoldDetected)
    findings.push("Default framework scaffold text/assets are still present; the project ignored the webpage skeleton.")
  if (skeletonIgnored) {
    findings.push(
      `Only ${matchedTexts.length}/${textSignals.length} source-skeleton text signals were found in project source; downstream implementation appears not to consume the skeleton/IR.`,
    )
  }
  if (finalBaselineOnlyDetected) {
    findings.push(
      "Frontend-design generated DOM/CSS baseline is still present in maintainable replacement mode; replace requested surfaces with project-owned semantic components/data modules before final acceptance.",
    )
    if (sourceDomRegionSources.length > 0) {
      const priorityList = sourceDomRegionSources
        .slice()
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 6)
        .map((source) => `${source.relative} (${source.bytes} bytes)`)
      if (priorityList.length > 0) {
        findings.push(
          `Largest remaining generated source-dom regions still need semantic replacement before final maintainable acceptance: ${priorityList.join(", ")}.`,
        )
      }
    }
  }
  if (finalSourceDomModuleResidueDetected) {
    const residue = sourceDomBaselineModuleSources
      .slice()
      .sort((a, b) => a.relative.localeCompare(b.relative))
      .slice(0, 12)
      .map((source) => source.relative)
    findings.push(
      `Target project still contains source-dom baseline modules in maintainable replacement mode: ${residue.join(", ")}. Extract their source evidence into semantic target-project components/data/styles, then remove these rawcode modules from final app source.`,
    )
  }
  if (!generatedBaselineDetected && sourceComponentCount >= 2 && componentFileCount(projectSources) < 2) {
    findings.push(
      `Source IR exposes ${sourceComponentCount} component boundary hints, but fewer than 2 project-owned component files were found.`,
    )
  }
  if (!generatedBaselineDetected && repeatedStructureRequiresDataLoops && dataArrayCount === 0) {
    findings.push(
      "Source IR contains tables/lists/cards/repeated groups, but no project-owned data array was detected.",
    )
  }
  if (!generatedBaselineDetected && repeatedStructureRequiresDataLoops && renderLoopCount === 0) {
    findings.push(
      "Source IR contains repeated structures, but no framework render loop (.map/v-for/each) was detected.",
    )
  }
  if (htmlReplayDetected) findings.push("Project-owned source contains large HTML strings or raw HTML injection.")
  if (manualDomMutationDetected)
    findings.push("Project-owned source uses manual DOM construction/mutation instead of framework components.")
  if (denseInlineAssetDetected) findings.push("Project-owned source contains dense inline assets or base64 data URIs.")
  if (referenceImageReplayDetected)
    findings.push(
      "Project-owned source renders the reference screenshot as the webpage instead of rebuilding it from framework components.",
    )
  if (hiddenSemanticContentDetected)
    findings.push("Project-owned source hides semantic skeleton content instead of rendering it visibly.")
  if (mechanicalSkeletonConversionDetected)
    findings.push(
      "Project-owned source appears to mechanically convert source-skeleton/index.html into a generated framework component.",
    )
  if (thirdPartyCssRuntimeLoaderDetected)
    findings.push(
      "Project-owned source runtime-loads third-party stylesheet bundles instead of owning the extracted CSS.",
    )
  if (sourcePackageContaminated)
    findings.push(
      `Visible source package contains output/verification artifacts and is not input-only: ${contaminatedSourceArtifacts.join(", ")}.`,
    )

  return {
    version: 1,
    purpose: "web-clone-source-skeleton-consumption-audit",
    passed: findings.length === 0,
    finalAcceptanceMode,
    projectDir,
    sourcePackageDir,
    sourceEvidence,
    projectStats,
    sourceCoverage,
    structureCoverage,
    risk,
    findings,
  }
}

export async function writeWebCloneSourceSkeletonConsumptionAudit(
  input: WebCloneSourceSkeletonConsumptionAuditInput,
): Promise<{ audit: WebCloneSourceSkeletonConsumptionAudit; auditPath: string }> {
  const audit = await auditWebCloneSourceSkeletonConsumption(input)
  const auditPath = input.outputPath
    ? path.resolve(input.outputPath)
    : path.join(path.resolve(input.projectDir), "web-clone-source-skeleton-consumption-audit.json")
  await fs.mkdir(path.dirname(auditPath), { recursive: true })
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8")
  return { audit, auditPath }
}

export async function inspectWebCloneSourceSkeletonConsumptionEvidence(input: {
  projectDir: string
  citedText: string
  originalRequest?: string
  finalAcceptanceMode?: WebCloneFinalAcceptanceMode
}): Promise<WebCloneSourceSkeletonConsumptionEvidenceResult> {
  if (!referencesWebCloneSource(input.citedText)) return { referenced: false, ok: true, findings: [] }
  const projectDir = path.resolve(input.projectDir)
  const finalAcceptanceMode =
    input.finalAcceptanceMode ?? inferWebCloneFinalAcceptanceMode(`${input.originalRequest ?? ""}\n${input.citedText}`)
  const expectedSourcePackageDir = path.join(projectDir, WEB_CLONE_SOURCE_PACKAGE_DIR)
  const canonicalAuditPath = path.join(projectDir, "web-clone-source-skeleton-consumption-audit.json")
  if (!(await exists(canonicalAuditPath))) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [
        `source-skeleton implementation is missing web-clone-source-skeleton-consumption-audit.json at canonical path ${canonicalAuditPath}`,
      ],
    }
  }

  const parsed = await readJsonOptional(canonicalAuditPath)
  if (!isConsumptionAudit(parsed)) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [`${canonicalAuditPath}: invalid source-skeleton consumption audit JSON`],
    }
  }
  if (!samePath(parsed.projectDir, projectDir)) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [
        `${canonicalAuditPath}: audit projectDir must be the current acceptance root (${projectDir}), got ${parsed.projectDir}`,
      ],
    }
  }
  if (!samePath(parsed.sourcePackageDir, expectedSourcePackageDir)) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [
        `${canonicalAuditPath}: audit sourcePackageDir must be ${expectedSourcePackageDir}, got ${parsed.sourcePackageDir}`,
      ],
    }
  }
  if (parsed.finalAcceptanceMode !== finalAcceptanceMode) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [
        `${canonicalAuditPath}: audit finalAcceptanceMode must be ${finalAcceptanceMode}, got ${parsed.finalAcceptanceMode ?? "missing"}`,
      ],
    }
  }
  if (!parsed.passed) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [`${canonicalAuditPath}: ${parsed.findings.join("; ")}`],
    }
  }

  let liveAudit: WebCloneSourceSkeletonConsumptionAudit
  try {
    liveAudit = await auditWebCloneSourceSkeletonConsumption({
      projectDir,
      sourcePackageDir: expectedSourcePackageDir,
      finalAcceptanceMode,
    })
  } catch (error) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [
        `${canonicalAuditPath}: live audit failed (${error instanceof Error ? error.message : String(error)})`,
      ],
    }
  }
  if (!liveAudit.passed) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [`${canonicalAuditPath}: live audit failed (${liveAudit.findings.join("; ")})`],
    }
  }
  if (stableJson(liveAudit) !== stableJson(parsed)) {
    return {
      referenced: true,
      ok: false,
      auditPath: canonicalAuditPath,
      findings: [`${canonicalAuditPath}: audit JSON is stale or does not match a live audit`],
    }
  }
  return { referenced: true, ok: true, auditPath: canonicalAuditPath, findings: [] }
}

function referencesWebCloneSource(citedText: string): boolean {
  const normalized = citedText.toLowerCase()
  return [
    "source-skeleton",
    "web-clone-source",
    "source-ir",
    "source ir",
    "web_clone_source_audit",
    "web-clone-source-skeleton-consumption-audit",
  ].some((needle) => normalized.includes(needle))
}

export function inferWebCloneFinalAcceptanceMode(text: string): WebCloneFinalAcceptanceMode {
  const normalized = text.toLowerCase()
  const maintainableSignals = [
    "maintainable",
    "real implementation",
    "component reuse",
    "replace generated",
    "replacement of mechanical",
    "semantic components",
    "可维护",
    "真正的实现",
    "真实实现",
    "复用现有组件",
    "成熟组件",
    "替换机械",
    "替换原始内容",
  ]
  return maintainableSignals.some((signal) => normalized.includes(signal))
    ? "maintainable_replacement_required"
    : "visual_baseline_allowed"
}

async function listSourceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string) {
    let entries: Array<import("node:fs").Dirent>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        await walk(path.join(dir, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      const full = path.join(dir, entry.name)
      const relative = normalizePath(path.relative(root, full))
      if (isDiagnosticSourceFile(relative)) continue
      if (SOURCE_FILE_RE.test(relative) || DATA_SOURCE_FILE_RE.test(relative)) files.push(full)
    }
  }
  await walk(root)
  return files
}

function isDiagnosticSourceFile(relative: string): boolean {
  return (
    relative === "src/data/sourceProjectManifest.json" ||
    relative === "web-clone-source-skeleton-consumption-audit.json"
  )
}

function detectFrontendDesignGeneratedBaseline(projectSources: Array<{ relative: string; text: string }>): boolean {
  const byPath = new Map(projectSources.map((source) => [source.relative, source.text]))
  const legacySinglefileBaseline =
    byPath.has("scripts/extract-source-html.mjs") &&
    byPath.has("src/generated/source-body.html") &&
    byPath.has("src/generated/source-head-styles.html") &&
    /source-body\.html\?raw/.test(byPath.get("src/App.jsx") ?? "") &&
    /source-head-styles\.html\?raw/.test(byPath.get("src/App.jsx") ?? "")
  const sourceDomRegionFileExists = projectSources.some((source) =>
    /^src\/components\/source-dom\/.+\.tsx$/i.test(source.relative),
  )
  const sourceSkeletonBaseline =
    byPath.has("src/components/SourceDomPage.tsx") &&
    byPath.has("src/components/SourceClonePage.tsx") &&
    byPath.has("src/data/sourceData.ts") &&
    /function SourceDomPage\b/.test(byPath.get("src/components/SourceDomPage.tsx") ?? "") &&
    (/data-source-node-id/.test(byPath.get("src/components/SourceDomPage.tsx") ?? "") || sourceDomRegionFileExists) &&
    /SourceDomPage/.test(byPath.get("src/components/SourceClonePage.tsx") ?? "")
  return legacySinglefileBaseline || sourceSkeletonBaseline
}

function isFrontendDesignGeneratedBaselineFile(relative: string): boolean {
  return (
    relative === "src/App.jsx" ||
    relative === "src/main.jsx" ||
    relative === "scripts/extract-source-html.mjs" ||
    relative.startsWith("src/generated/") ||
    relative === "src/styles.css" ||
    relative === "src/styles/source-critical.css" ||
    relative === "src/styles/source-full.css" ||
    relative === "src/components/SourceDomPage.tsx" ||
    relative === "src/components/SourceAssetPathGroup.tsx" ||
    relative === "src/components/SourceFaqList.tsx" ||
    relative === "src/components/AssetPath.tsx" ||
    relative === "src/components/ContentTable.tsx" ||
    relative === "src/data/svgPaths.ts" ||
    relative === "src/data/sourceDomRegions.ts" ||
    relative === "src/data/sourceDomReplacementPlan.ts" ||
    relative === "src/data/sourceDomIterationState.ts" ||
    relative === "src/data/sourceSvgAssetGroups.ts" ||
    relative === "src/data/sourceFaqGroups.ts" ||
    relative.startsWith("src/components/source-dom/")
  )
}

function isFinalSourceDomBaselineResidueFile(relative: string): boolean {
  return (
    relative === "src/components/SourceClonePage.tsx" ||
    relative === "src/components/SourceDomPage.tsx" ||
    /^src\/components\/source-dom\/.+\.tsx$/i.test(relative) ||
    /^src\/data\/sourceDom[A-Z].*\.(?:ts|tsx|js|jsx|json)$/i.test(relative)
  )
}

function isConsumptionAudit(value: unknown): value is WebCloneSourceSkeletonConsumptionAudit {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (
    row.version === 1 &&
    row.purpose === "web-clone-source-skeleton-consumption-audit" &&
    typeof row.passed === "boolean" &&
    typeof row.projectDir === "string" &&
    typeof row.sourcePackageDir === "string" &&
    Array.isArray(row.findings)
  )
}

function collectReferenceTextSignals(input: {
  sourceSkeleton: string
  contentModel: unknown
  componentTree: unknown
}): string[] {
  const signals: string[] = []
  collectContentStrings(input.contentModel, signals)
  collectComponentTreeStrings(input.componentTree, signals)
  if (signals.length < 8) collectSkeletonTextNodes(input.sourceSkeleton, signals)
  return rankTextSignals(Array.from(new Set(signals.map(canonicalTextSignal).filter(Boolean) as string[]))).slice(0, 80)
}

function collectContentStrings(value: unknown, signals: string[], key = ""): void {
  const visibleKeys = new Set([
    "alt",
    "fields",
    "headers",
    "items",
    "label",
    "rows",
    "sampleTexts",
    "text",
    "textPreview",
    "value",
  ])
  if (typeof value === "string") {
    if (visibleKeys.has(key)) signals.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectContentStrings(item, signals, key)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    collectContentStrings(child, signals, childKey)
  }
}

function collectComponentTreeStrings(value: unknown, signals: string[]): void {
  const components = readArrayPath(value, ["components"])
  for (const component of components) {
    const row = component && typeof component === "object" ? (component as Record<string, unknown>) : {}
    const previews = Array.isArray(row.textPreview) ? row.textPreview : []
    for (const preview of previews) if (typeof preview === "string") signals.push(preview)
  }
}

function collectSkeletonTextNodes(html: string, signals: string[]): void {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  for (const match of withoutScripts.matchAll(/>([^<>]{2,180})</g)) signals.push(decodeBasicEntities(match[1] ?? ""))
}

function rankTextSignals(signals: string[]): string[] {
  return signals
    .filter((signal) => signal.length >= 3 && signal.length <= 90)
    .filter((signal) => !/^(web-clone|source skeleton|component-tree|content-model|implementation hint)$/i.test(signal))
    .filter((signal) => !/^\.\.\/|^https?:\/\//i.test(signal))
    .map((signal) => ({ signal, score: textSignalScore(signal) }))
    .sort((a, b) => b.score - a.score || a.signal.length - b.signal.length)
    .map((item) => item.signal)
}

function textSignalScore(signal: string): number {
  let score = Math.min(signal.length, 40)
  if (/\d/.test(signal)) score += 40
  if (/[A-Za-z]\s+[A-Za-z]/.test(signal)) score += 20
  if (/[.%$€¥£]/.test(signal)) score += 12
  if (signal.length <= 24) score += 8
  return score
}

function sourceContains(projectText: string, signal: string): boolean {
  const normalizedSource = normalizeForMatch(projectText)
  const normalizedSignal = normalizeForMatch(signal)
  if (!normalizedSignal) return false
  if (normalizedSource.includes(normalizedSignal)) return true
  return normalizedSource.replace(/\s+/g, "").includes(normalizedSignal.replace(/\s+/g, ""))
}

function canonicalTextSignal(value: string): string | undefined {
  const normalized = decodeBasicEntities(value).replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  if (/^[{}[\],:;./\\|_-]+$/.test(normalized)) return undefined
  return normalized
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
}

function readComponentNames(componentTree: unknown): string[] {
  return readArrayPath(componentTree, ["components"])
    .map((component) =>
      component && typeof component === "object" ? (component as Record<string, unknown>).name : undefined,
    )
    .filter((name): name is string => typeof name === "string" && name.length > 0)
}

function readRepeatedStructureCount(contentModel: unknown): number {
  const stats =
    contentModel && typeof contentModel === "object" ? (contentModel as Record<string, unknown>).stats : undefined
  if (stats && typeof stats === "object") {
    const row = stats as Record<string, unknown>
    return ["totalTables", "totalLists", "totalCards", "totalRepeatedGroups"].reduce(
      (sum, key) => sum + (typeof row[key] === "number" ? (row[key] as number) : 0),
      0,
    )
  }
  return ["tables", "lists", "cards", "repeatedGroups"].reduce(
    (sum, key) => sum + readArrayPath(contentModel, [key]).length,
    0,
  )
}

function readArrayPath(value: unknown, parts: string[]): unknown[] {
  let current = value
  for (const part of parts) {
    if (!current || typeof current !== "object") return []
    current = (current as Record<string, unknown>)[part]
  }
  return Array.isArray(current) ? current : []
}

function componentFileCount(sources: Array<{ relative: string }>): number {
  return sources.filter((source) => COMPONENT_FILE_RE.test(source.relative)).length
}

function countDataArrays(sources: Array<{ relative: string; text: string }>): number {
  let count = 0
  for (const source of sources) {
    if (/\.json$/i.test(source.relative)) {
      count += countJsonArrays(source.text)
      continue
    }
    count +=
      source.text.match(
        /\b(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*\[[\s\S]{0,3000}[\]}][\s,]*\]/g,
      )?.length ?? 0
  }
  return count
}

function countJsonArrays(text: string): number {
  try {
    return countArraysInJson(JSON.parse(text))
  } catch {
    return 0
  }
}

function countArraysInJson(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce<number>((sum, item) => sum + countArraysInJson(item), 0)
  }
  if (!value || typeof value !== "object") return 0
  return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + countArraysInJson(item), 0)
}

function countRenderLoops(text: string): number {
  return (
    (text.match(/\.map\s*\(/g)?.length ?? 0) +
    (text.match(/\bv-for\s*=/g)?.length ?? 0) +
    (text.match(/{#each\s+/g)?.length ?? 0)
  )
}

function countHtmlStringStats(text: string): { htmlStringBytes: number; largestHtmlStringBytes: number } {
  let htmlStringBytes = 0
  let largestHtmlStringBytes = 0
  for (const match of text.matchAll(/(["'`])(?:\\.|(?!\1)[\s\S]){200,}\1/g)) {
    const value = match[0]
    if (!/[<>][a-zA-Z/!][\s\S]*[<>]/.test(value)) continue
    const bytes = Buffer.byteLength(value, "utf8")
    htmlStringBytes += bytes
    largestHtmlStringBytes = Math.max(largestHtmlStringBytes, bytes)
  }
  return { htmlStringBytes, largestHtmlStringBytes }
}

function detectDenseInlineAssets(sources: Array<{ text: string }>, base64DataUriCount: number): boolean {
  if (base64DataUriCount > 0) return true
  return sources.some((source) => hasDenseInlineSvgPayload(source.text))
}

function hasDenseInlineSvgPayload(text: string): boolean {
  for (const match of text.matchAll(/\b(?:d|points)\s*=\s*(?:\{\s*)?(["'`])([^"'`]{2000,})\1\s*\}?/g)) {
    const payload = match[2] ?? ""
    if (/[MmLlHhVvCcSsQqTtAaZz]\s*[-\d.]|[-\d.]+[, ]+[-\d.]+/.test(payload)) return true
  }

  for (const match of text.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const svg = match[0]
    if (Buffer.byteLength(svg, "utf8") < 5000) continue
    if (/\b(?:assetPath|data-asset-d)\s*=/.test(svg)) continue
    if (/<(?:path|polygon|polyline|image|use|defs|linearGradient|radialGradient)\b/i.test(svg)) return true
  }

  return false
}

function detectReferenceImageReplay(
  sources: Array<{ relative: string; text: string }>,
  referenceImagePath: string,
): boolean {
  const implementationSources = sources.filter(
    (source) =>
      !isReferenceReplayEvidenceSidecar(source.relative) &&
      (/^(?:src|app|pages|components|views|routes)\//i.test(source.relative) ||
        /\.(?:css|scss|sass|less)$/i.test(source.relative)),
  )
  const projectText = implementationSources.map((source) => source.text).join("\n")
  const referenceName = normalizeForMatch(path.basename(referenceImagePath))
  const referenceStem = normalizeForMatch(path.basename(referenceImagePath, path.extname(referenceImagePath)))
  const normalizedProject = normalizeForMatch(projectText)
  const namesReferenceImage =
    normalizedProject.includes(referenceName) ||
    /\b(reference|screenshot|snapshot)[-_]?(image|canvas|page)?\.(?:png|jpe?g|webp)\b/i.test(projectText)
  const fullPageImageDimensions = /\bwidth\s*=\s*["']?1440["']?|\bheight\s*=\s*["']?6547["']?/.test(projectText)
  const visualCanvasNames = /\b(reference|screenshot|snapshot)[-_]?(canvas|image|page)\b/i.test(projectText)
  const cssScreenshotReplay = sources.some(
    (source) =>
      /\.(?:css|scss|sass|less)$/i.test(source.relative) &&
      /\bbackground(?:-image)?\s*:\s*url\([^)]*(?:reference|screenshot|snapshot)[^)]*\)/i.test(source.text),
  )

  return (
    cssScreenshotReplay ||
    (namesReferenceImage && (fullPageImageDimensions || visualCanvasNames || normalizedProject.includes(referenceStem)))
  )
}

function isReferenceReplayEvidenceSidecar(relative: string): boolean {
  return (
    relative === "src/data/sourceProjectManifest.json" ||
    relative === "src/data/sourceDomRegions.ts" ||
    relative === "src/data/sourceDomReplacementPlan.ts" ||
    relative === "src/data/sourceDomIterationState.ts"
  )
}

function detectHiddenSemanticContent(sources: Array<{ relative: string; text: string }>): boolean {
  const sourceText = sources.map((source) => source.text).join("\n")
  const hiddenClassNames = new Set<string>()
  for (const source of sources.filter((item) => /\.(?:css|scss|sass|less)$/i.test(item.relative))) {
    for (const match of source.text.matchAll(/\.([A-Za-z_-][\w-]*)\s*\{([^}]*)\}/g)) {
      const [, className, body = ""] = match
      if (isHiddenStyleBody(body)) hiddenClassNames.add(className)
    }
  }
  for (const className of hiddenClassNames) {
    const classPattern = new RegExp(
      `className\\s*=\\s*["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["']|class\\s*=\\s*["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["']`,
    )
    if (classPattern.test(sourceText) && /semantic|source|skeleton|coverage|signals?|content/i.test(className)) {
      return true
    }
  }
  return /aria-hidden\s*=\s*["']true["'][\s\S]{0,2000}(?:sourceSignals|sourceTables|source-skeleton|skeleton)/i.test(
    sourceText,
  )
}

function detectMechanicalSkeletonConversion(
  sources: Array<{ relative: string; text: string; bytes: number }>,
): boolean {
  return sources.some((source) => {
    const relative = source.relative.toLowerCase()
    if (relative.includes("generated/") && /skeleton|source/.test(relative) && source.bytes > 80_000) return true
    if (/generate-from-skeleton|source-skeleton\/index\.html|parse5/.test(source.text) && source.bytes > 2_000)
      return true
    const sourceNodeHits = source.text.match(/data-source-node-id=/g)?.length ?? 0
    return source.bytes > 120_000 && sourceNodeHits > 100
  })
}

function detectThirdPartyCssRuntimeLoader(sources: Array<{ relative: string; text: string }>): boolean {
  return sources.some(
    (source) =>
      /static\.tradingview\.com\/static\/bundles\/.+\.css/i.test(source.text) ||
      /document\.createElement\(['"]link['"]\)[\s\S]{0,500}\.rel\s*=\s*['"]stylesheet['"]/i.test(source.text),
  )
}

function isHiddenStyleBody(body: string): boolean {
  const normalized = body.replace(/\s+/g, " ").toLowerCase()
  if (/\bdisplay\s*:\s*none\b/.test(normalized)) return true
  if (/\bvisibility\s*:\s*hidden\b/.test(normalized)) return true
  if (/\bopacity\s*:\s*0(?:\.0+)?\b/.test(normalized)) return true
  if (/\bclip-path\s*:\s*inset\(50%\)/.test(normalized)) return true
  if (/\bclip\s*:\s*rect\(0(?:px)?[, ]+0(?:px)?[, ]+0(?:px)?[, ]+0(?:px)?\)/.test(normalized)) return true
  return (
    /\bwidth\s*:\s*1px\b/.test(normalized) &&
    /\bheight\s*:\s*1px\b/.test(normalized) &&
    /\boverflow\s*:\s*hidden\b/.test(normalized)
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

async function readJsonOptional(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return undefined
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/")
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
