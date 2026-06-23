import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument } from "htmlparser2"

interface DomNode {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: DomNode[]
}

interface SourceSectionSignal {
  id: string
  title: string
  sampleText: string
  secondaryTerms: string[]
}

interface SkeletonContentBlock {
  index: number
  tag: string
  descriptor: string
  text: string
}

export interface VisualHtmlSkeletonStructureCoverage {
  checked: boolean
  passed: boolean
  contentModelPath?: string
  skeletonPath?: string
  requiredSectionCount: number
  matchedSectionCount: number
  missingSections: Array<{ title: string; requiredTerms: string[] }>
  orderIssues: string[]
  diagnostics: string[]
}

export async function inspectVisualHtmlSkeletonStructureCoverage(input: {
  artifactRoot: string
  visualProjectRoot: string
  sourcePackage?: string
}): Promise<VisualHtmlSkeletonStructureCoverage> {
  const artifactRoot = path.resolve(input.artifactRoot)
  const visualRoot =
    resolveInside(artifactRoot, input.visualProjectRoot) ?? path.join(artifactRoot, "visual-html-skeleton")
  const sourcePackage = resolveInside(artifactRoot, input.sourcePackage || "web-clone-source")
  const sourceRoot = sourcePackage ?? path.join(artifactRoot, "web-clone-source")
  const contentModelPath = path.join(sourceRoot, "source-ir", "content-model.json")
  const skeletonPath = path.join(visualRoot, "index.html")

  if (!(await exists(contentModelPath))) {
    return emptyCoverage({ checked: false, passed: true, contentModelPath, skeletonPath })
  }

  let contentModel: unknown
  try {
    contentModel = JSON.parse(await fs.readFile(contentModelPath, "utf8"))
  } catch (error) {
    return emptyCoverage({
      checked: true,
      passed: false,
      contentModelPath,
      skeletonPath,
      diagnostics: [
        `Invalid source content model ${contentModelPath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    })
  }

  const signals = collectSourceSectionSignals(contentModel)
  if (signals.length === 0) {
    return emptyCoverage({ checked: true, passed: true, contentModelPath, skeletonPath })
  }

  let skeletonHtml: string
  try {
    skeletonHtml = await fs.readFile(skeletonPath, "utf8")
  } catch (error) {
    return {
      checked: true,
      passed: false,
      contentModelPath,
      skeletonPath,
      requiredSectionCount: signals.length,
      matchedSectionCount: 0,
      missingSections: signals.map((signal) => ({ title: signal.title, requiredTerms: signal.secondaryTerms })),
      orderIssues: [],
      diagnostics: [
        `Missing visual skeleton HTML ${skeletonPath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }

  const blocks = collectSkeletonContentBlocks(skeletonHtml)
  const matched = new Map<string, SkeletonContentBlock>()
  const usedBlockIndexes = new Set<number>()
  for (const signal of signals) {
    const block = blocks.find(
      (candidate) => !usedBlockIndexes.has(candidate.index) && blockMatchesSignal(candidate, signal),
    )
    if (!block) continue
    matched.set(signal.id, block)
    usedBlockIndexes.add(block.index)
  }

  const missingSections = signals
    .filter((signal) => !matched.has(signal.id))
    .map((signal) => ({ title: signal.title, requiredTerms: signal.secondaryTerms }))
  const orderIssues = sectionOrderIssues(signals, matched)
  const diagnostics = [
    `source structure sections=${signals.length}; skeleton content blocks=${blocks.length}; matched=${matched.size}`,
    ...missingSections.map(
      (section) =>
        `missing source section "${section.title}" with content terms ${section.requiredTerms.slice(0, 4).join(", ")}`,
    ),
    ...orderIssues,
  ]
  return {
    checked: true,
    passed: missingSections.length === 0 && orderIssues.length === 0,
    contentModelPath,
    skeletonPath,
    requiredSectionCount: signals.length,
    matchedSectionCount: matched.size,
    missingSections,
    orderIssues,
    diagnostics,
  }
}

function emptyCoverage(input: {
  checked: boolean
  passed: boolean
  contentModelPath?: string
  skeletonPath?: string
  diagnostics?: string[]
}): VisualHtmlSkeletonStructureCoverage {
  return {
    checked: input.checked,
    passed: input.passed,
    contentModelPath: input.contentModelPath,
    skeletonPath: input.skeletonPath,
    requiredSectionCount: 0,
    matchedSectionCount: 0,
    missingSections: [],
    orderIssues: [],
    diagnostics: input.diagnostics ?? [],
  }
}

function collectSourceSectionSignals(contentModel: unknown): SourceSectionSignal[] {
  const byTitle = new Map<string, SourceSectionSignal>()
  for (const group of readArrayPath(contentModel, ["repeatedGroups"])) {
    const row = asRecord(group)
    const itemTag = typeof row.itemTag === "string" ? row.itemTag.toLowerCase() : ""
    if (["script", "meta", "link", "style"].includes(itemTag)) continue
    const samples = readStringArray(row.sampleTexts).map(canonicalText).filter(isMajorSectionSample)
    if (samples.length < 3) continue
    for (const sampleText of samples) {
      const title = inferSectionTitle(sampleText)
      if (!title) continue
      const titleTerms = new Set(extractTerms(title))
      const secondaryTerms = extractTerms(sampleText)
        .filter((term) => !titleTerms.has(term))
        .slice(0, 8)
      if (secondaryTerms.length < 2) continue
      const id = normalizeForMatch(title)
      const signal: SourceSectionSignal = { id, title, sampleText, secondaryTerms }
      const existing = byTitle.get(id)
      if (!existing || existing.secondaryTerms.length < secondaryTerms.length) byTitle.set(id, signal)
    }
  }
  return [...byTitle.values()].slice(0, 24)
}

function collectSkeletonContentBlocks(html: string): SkeletonContentBlock[] {
  const document = parseDocument(html, {
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  }) as DomNode
  const blocks: SkeletonContentBlock[] = []
  walkSkeleton(document, false, blocks)
  return blocks
}

function walkSkeleton(node: DomNode, blocked: boolean, blocks: SkeletonContentBlock[]): void {
  if (node.type === "text" || node.type === "script" || node.type === "style") return
  const tag = (node.name ?? "").toLowerCase()
  const descriptor = elementDescriptor(node)
  const nextBlocked = blocked || isNonContentElement(tag, descriptor)
  if (!nextBlocked && isContentCandidate(tag, descriptor)) {
    const text = canonicalText(textContent(node))
    if (text.length >= 12 && text.length <= 6000) {
      blocks.push({ index: blocks.length, tag, descriptor, text })
    }
  }
  for (const child of node.children ?? []) walkSkeleton(child, nextBlocked, blocks)
}

function blockMatchesSignal(block: SkeletonContentBlock, signal: SourceSectionSignal): boolean {
  if (!containsText(block.text, signal.title)) return false
  const hits = signal.secondaryTerms.filter((term) => containsText(block.text, term))
  return hits.length >= Math.min(2, signal.secondaryTerms.length)
}

function sectionOrderIssues(signals: SourceSectionSignal[], matched: Map<string, SkeletonContentBlock>): string[] {
  const issues: string[] = []
  let lastIndex = -1
  let lastTitle = ""
  for (const signal of signals) {
    const block = matched.get(signal.id)
    if (!block) continue
    if (block.index < lastIndex) {
      issues.push(
        `source section "${signal.title}" appears before "${lastTitle}" in the visual skeleton, but source IR requires the opposite order`,
      )
    }
    lastIndex = Math.max(lastIndex, block.index)
    lastTitle = signal.title
  }
  return issues
}

function inferSectionTitle(sampleText: string): string | undefined {
  const words = sampleText
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => /\p{L}/u.test(word))
  if (words.length === 0) return undefined
  const out = [words[0]!]
  for (let i = 1; i < words.length && out.length < 4; i++) {
    const word = words[i]!
    if (!/^\p{Ll}/u.test(word)) break
    out.push(word)
  }
  return canonicalText(out.join(" "))
}

function extractTerms(text: string): string[] {
  const stop = new Set([
    "actual",
    "forecast",
    "prior",
    "release",
    "today",
    "country",
    "countries",
    "more",
    "with",
    "from",
    "that",
    "this",
    "than",
    "what",
  ])
  const out: string[] = []
  for (const raw of text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 4) continue
    if (/^\d+$/.test(raw)) continue
    if (stop.has(raw)) continue
    if (!out.includes(raw)) out.push(raw)
  }
  return out
}

function isMajorSectionSample(text: string): boolean {
  return (
    text.length >= 24 &&
    text.length <= 1200 &&
    /\p{L}/u.test(text) &&
    !/__WEB_CLONE_/i.test(text) &&
    extractTerms(text).length >= 4
  )
}

function isContentCandidate(tag: string, descriptor: string): boolean {
  if (["section", "article"].includes(tag)) return true
  if (/\bdata-(?:oc-region|testid|source-section)\b/i.test(descriptor)) return true
  return /\b(?:section|region|module|panel|card|chart|map|table|list|grid|carousel|calendar|news|indicator|faq|content)\b/i.test(
    descriptor,
  )
}

function isNonContentElement(tag: string, descriptor: string): boolean {
  if (["nav", "header", "footer", "script", "style", "template"].includes(tag)) return true
  return /\b(?:nav|navigation|navbar|tabs?|tablist|breadcrumb|menu|header|footer|sidebar|skip-link)\b/i.test(descriptor)
}

function elementDescriptor(node: DomNode): string {
  const attrs = node.attribs ?? {}
  return [node.name ?? "", attrs.id ?? "", attrs.class ?? "", ...Object.keys(attrs)].filter(Boolean).join(" ")
}

function textContent(node: DomNode): string {
  if (node.type === "text") return node.data ?? ""
  const tag = (node.name ?? "").toLowerCase()
  if (["script", "style", "template"].includes(tag)) return ""
  return (node.children ?? []).map(textContent).join(" ")
}

function containsText(source: string, needle: string): boolean {
  const normalizedSource = normalizeForMatch(source)
  const normalizedNeedle = normalizeForMatch(needle)
  if (!normalizedNeedle) return false
  return (
    normalizedSource.includes(normalizedNeedle) ||
    normalizedSource.replace(/\s+/g, "").includes(normalizedNeedle.replace(/\s+/g, ""))
  )
}

function canonicalText(value: string): string {
  return decodeBasicEntities(value).normalize("NFKC").replace(/\s+/g, " ").trim()
}

function normalizeForMatch(value: string): string {
  return canonicalText(value).toLowerCase()
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function readArrayPath(value: unknown, parts: string[]): unknown[] {
  let current = value
  for (const part of parts) {
    if (!current || typeof current !== "object") return []
    current = (current as Record<string, unknown>)[part]
  }
  return Array.isArray(current) ? current : []
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function resolveInside(root: string, relativePath: string): string | undefined {
  const normalized = normalizeReportPath(relativePath)
  if (!normalized) return undefined
  const resolved = path.resolve(root, ...normalized.split("/"))
  const rel = path.relative(root, resolved)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined
  return resolved
}

function normalizeReportPath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/").trim())
  if (normalized === ".") return ""
  return normalized.replace(/^\.\/+/, "").replace(/\/+$/, "")
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
