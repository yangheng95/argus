import fs from "node:fs/promises"
import path from "node:path"

import {
  ensureLiveWebpageEvidence,
  hasCompletePrimaryEvidence,
  hasCompleteSourcePackage,
  type LiveWebpageEvidencePipeline,
  type LiveWebpageEvidenceResult,
  primaryWebpageEvidenceArtifacts,
  primaryWebpageSourcePackageArtifacts,
} from "@/orchestrator/webpage-evidence"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

const EXCERPT_MAX_CHARS = 2_400
const RAW_WEBPAGE_EVIDENCE_LINE_PATTERNS = [
  /\bsinglefile\.html\b/i,
  /\bcapture\.html\b/i,
  /\bextracted-page\.json\b/i,
  /\bsource-skeleton\/index\.html\b/i,
] as const

const PROMPT_ARTIFACTS = [
  {
    label: "PRD evidence summary",
    relative: ["webpage-evidence", "prd-evidence-summary.md"],
  },
  {
    label: "Source package context",
    relative: ["web-clone-source", "web-clone-context.md"],
  },
  {
    label: "Implementation blueprint",
    relative: ["web-clone-source", "implementation-blueprint.md"],
  },
  {
    label: "Component tree",
    relative: ["web-clone-source", "source-ir", "component-tree.json"],
  },
  {
    label: "Content model",
    relative: ["web-clone-source", "source-ir", "content-model.json"],
  },
  {
    label: "Layout map",
    relative: ["web-clone-source", "source-ir", "layout-map.json"],
  },
  {
    label: "Style tokens",
    relative: ["web-clone-source", "source-ir", "style-tokens.json"],
  },
  {
    label: "Interaction hints",
    relative: ["web-clone-source", "source-ir", "interaction-hints.json"],
  },
  {
    label: "Runtime interaction state snapshots",
    relative: ["web-clone-source", "source-ir", "interaction-state-snapshots.json"],
  },
] as const

export interface WebpagePrdEvidenceExcerpt {
  label: string
  relativePath: string
  excerpt: string
  originalChars: number
  clipped: boolean
}

export interface WebpagePrdEvidence {
  url: string
  status: LiveWebpageEvidenceResult["status"]
  webpageEvidenceRelative: string
  sourcePackageRelative: string
  referenceImageRelative: string
  artifacts: string[]
  excerpts: WebpagePrdEvidenceExcerpt[]
}

export async function prepareWebpagePrdEvidence(input: {
  projectDir: string
  worktreeDir: string
  taskID: string
  sourceUrls: readonly string[]
  signal?: AbortSignal
  pipeline?: LiveWebpageEvidencePipeline
}): Promise<WebpagePrdEvidence | undefined> {
  const url = input.sourceUrls.find((item) => /^https?:\/\//i.test(item))
  if (!url) return undefined

  const evidence = await ensureLiveWebpageEvidence({
    projectDir: input.projectDir,
    worktreeDir: input.worktreeDir,
    taskID: input.taskID,
    urls: input.sourceUrls,
    signal: input.signal,
    pipeline: input.pipeline,
  })
  if (!evidence.url) throw new Error("webpage PRD evidence preparation did not resolve a source URL")

  return readPreparedWebpagePrdEvidence({
    projectDir: input.projectDir,
    taskID: input.taskID,
    url: evidence.url,
    status: evidence.status,
    artifacts: evidence.artifacts,
  })
}

export async function readPreparedWebpagePrdEvidence(input: {
  projectDir: string
  taskID: string
  url: string
  status?: LiveWebpageEvidenceResult["status"]
  artifacts?: string[]
}): Promise<WebpagePrdEvidence> {
  const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectDir, input.taskID)
  const [hasWebpageEvidence, hasSourcePackage] = await Promise.all([
    hasCompletePrimaryEvidence(paths.webpageEvidenceAbsolute, input.url),
    hasCompleteSourcePackage(paths.sourcePackageAbsolute),
  ])
  if (!hasWebpageEvidence || !hasSourcePackage) {
    throw new Error(
      "prepared webpage PRD evidence requires a complete runtime webpage evidence package",
    )
  }
  const excerpts = await Promise.all(PROMPT_ARTIFACTS.map((artifact) => readPromptArtifact(paths.relativeDir, paths, artifact)))
  return {
    url: input.url,
    status: input.status ?? "reused",
    webpageEvidenceRelative: paths.webpageEvidenceRelative,
    sourcePackageRelative: paths.sourcePackageRelative,
    referenceImageRelative: path.posix.join(paths.sourcePackageRelative, "reference.png"),
    artifacts: input.artifacts ?? [
      ...primaryWebpageEvidenceArtifacts(input.taskID),
      ...primaryWebpageSourcePackageArtifacts(input.taskID),
    ],
    excerpts,
  }
}

export function renderWebpagePrdEvidencePromptSection(evidence: WebpagePrdEvidence | undefined): string | undefined {
  if (!evidence) return undefined
  const artifactList = evidence.artifacts
    .filter((artifact) =>
      artifact.endsWith("prd-evidence-summary.md") ||
      artifact.includes("/source-ir/") ||
      artifact.endsWith("web-clone-context.md") ||
      artifact.endsWith("implementation-blueprint.md") ||
      artifact.endsWith("reference.png"),
    )
    .map((artifact) => `- ${artifact}`)
    .join("\n")
  const excerpts = evidence.excerpts
    .map((item) =>
      [
        `## ${item.label}`,
        `Path: ${item.relativePath}`,
        item.clipped ? `Excerpt: clipped to ${EXCERPT_MAX_CHARS} of ${item.originalChars} chars.` : "Excerpt: complete.",
        "",
        "```",
        item.excerpt,
        "```",
      ].join("\n"),
    )
    .join("\n\n")

  return [
    "# Prepared Webpage PRD Evidence",
    "",
    `Source URL: ${evidence.url}`,
    `Evidence status: ${evidence.status}`,
    `Webpage evidence root: ${evidence.webpageEvidenceRelative}`,
    `Source package root: ${evidence.sourcePackageRelative}`,
    `Visual reference image: ${evidence.referenceImageRelative}`,
    "",
    "Use this rendered webpage evidence as the primary source for page layout, visible content, responsive behavior, style tokens, interactions, maps, charts, cards, tables, and footer/header inventory.",
    "`source-ir/interaction-state-snapshots.json` is factual runtime evidence captured from browser scroll/click states. Use it for sticky/floating bars, active tabs, viewport-persistent elements, expanded/selected states, and interaction-state PRD contracts; do not treat it as prewritten PRD prose.",
    "Do not call `webfetch` against this same URL to replace prepared visual layout or content extraction. In frontend-research, use read-only retrieval only for narrow metadata, source text, or linked-source confirmation when these artifacts identify a missing fact.",
    "Return `document_outline` as the PRD major module list for downstream agent splitting. Order modules by visible page flow and include evidence ids for each module.",
    "Also submit `webpage_contract`. It must be faithful to the rendered page and must cover functional_surfaces, visual_layout, style_requirements, interaction_states, data_content_inventory, fidelity_acceptance, and fidelity_risks. Do not substitute a raw artifact/material list for this contract.",
    "The submitted `bundle.full_markdown` for this webpage contract must contain 1000+ substantive non-empty lines; do not pad, and make each line carry region, component, style, interaction, data/content, acceptance, risk, or evidence detail.",
    "If the evidence is insufficient to describe an original-page function, layout, or style faithfully, preserve that uncertainty in fidelity_risks and open_questions instead of inventing a design.",
    "",
    "## Canonical Artifact Paths",
    artifactList || "- none",
    "",
    excerpts,
  ].join("\n")
}

async function readPromptArtifact(
  taskRelativeRoot: string,
  paths: ReturnType<typeof ProjectRuntimePaths.frontendDesignPaths>,
  artifact: typeof PROMPT_ARTIFACTS[number],
): Promise<WebpagePrdEvidenceExcerpt> {
  const [root, ...rest] = artifact.relative
  const absoluteRoot = root === "webpage-evidence" ? paths.webpageEvidenceAbsolute : paths.sourcePackageAbsolute
  const relativeRoot = root === "webpage-evidence" ? paths.webpageEvidenceRelative : paths.sourcePackageRelative
  const absolutePath = path.join(absoluteRoot, ...rest)
  const relativePath = path.posix.join(relativeRoot, ...rest)
  if (!relativePath.startsWith(taskRelativeRoot.replaceAll("\\", "/"))) {
    throw new Error(`webpage PRD artifact path escaped task frontend-design runtime root: ${relativePath}`)
  }
  const rawText = await fs.readFile(absolutePath, "utf8")
  const text = sanitizeResearchPromptArtifactText(rawText)
  const excerpt = text.length > EXCERPT_MAX_CHARS
    ? `${text.slice(0, EXCERPT_MAX_CHARS).trimEnd()}\n[artifact excerpt clipped: ${text.length - EXCERPT_MAX_CHARS} chars omitted]`
    : text.trim()
  return {
    label: artifact.label,
    relativePath,
    excerpt,
    originalChars: text.length,
    clipped: text.length > EXCERPT_MAX_CHARS,
  }
}

function sanitizeResearchPromptArtifactText(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !RAW_WEBPAGE_EVIDENCE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim()
}
