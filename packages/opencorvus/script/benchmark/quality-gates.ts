import fs from "node:fs/promises"
import path from "node:path"
import type * as z from "zod"
import { ArtifactAudit, RunMetrics } from "../../src/orchestrator/model"

type ArtifactAuditType = z.infer<typeof ArtifactAudit>
type RunMetricsType = z.infer<typeof RunMetrics>

type EventEntry = Record<string, unknown>
type ModuleBlock = { id: string; owned_paths?: string[] }

type QualityFailure = {
  category: "liveness" | "scope_drift" | "artifact_quality" | "verification_gap" | "delivery_gap"
  message: string
  evidence: string
}

type QualityVerdict = {
  verdict: "accepted" | "rejected" | "blocked"
  primary_failure: QualityFailure["category"] | null
  failures: QualityFailure[]
  manual_review_summary: string
}

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt"])
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java"])
const CONFIG_BASENAMES = new Set([
  "package.json",
  "tsconfig.json",
  "app.json",
  "babel.config.js",
  "metro.config.js",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".prettierrc",
  ".prettierignore",
  "package-lock.json",
  "bun.lock",
])
// Case-sensitive: only uppercase TODO/FIXME count as action markers (avoids "todo item" in product JSDoc)
const PLACEHOLDER_MARKER_RE = /\b(TODO|FIXME)\b/
// Case-insensitive: implementation quality signals that indicate incomplete code
const PLACEHOLDER_IMPL_RE = /\b(stub|placeholder|mock-only|not implemented)\b/i
const VERIFY_RE = /\b(verify|verification|check|test|assert|readme|structure|scaffold|ls\s|find\s)\b/i

export async function auditWorkspace(input: {
  rootDir: string
  changedFiles?: string[]
  request?: string
  moduleBlocks?: ModuleBlock[]
}): Promise<ArtifactAuditType> {
  const files = dedupeFiles(input.changedFiles && input.changedFiles.length > 0 ? input.changedFiles : await listFiles(input.rootDir))
  const requestText = String(input.request || "")
  const docFiles = files.filter((file) => DOC_EXTENSIONS.has(path.extname(file).toLowerCase()))
  const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))
  const configFiles = files.filter((file) => CONFIG_BASENAMES.has(path.basename(file)))
  const readmes = docFiles.filter((file) => path.basename(file).toLowerCase() === "readme.md")
  const duplicateDocs = readmes.filter((file) => path.dirname(file) !== ".")
  const scaffoldFlags = files.filter((file) =>
    /(^|\/)(app\.json|babel\.config\.js|metro\.config\.js|package-lock\.json|src\/[^/]+\/README\.md)$/i.test(file.replace(/\\/g, "/")),
  )

  const placeholderHits = (await Promise.all(files.map(async (file) => {
    const abs = path.join(input.rootDir, file)
    const content = await fs.readFile(abs, "utf8").catch(() => "")
    return (PLACEHOLDER_MARKER_RE.test(content) || PLACEHOLDER_IMPL_RE.test(content)) ? [file] : []
  }))).flat()

  const nonSourceCount = Math.max(0, files.length - sourceFiles.length)
  const allowedDocs = /\b(add|create|write|update|document)\b[\s\S]{0,40}\b(readme|documentation|docs?)\b/i.test(requestText)
  const scopeRelevantFiles = input.changedFiles && input.changedFiles.length > 0 ? dedupeFiles(input.changedFiles) : []
  const nonConfigScopeFiles = scopeRelevantFiles.filter((f) => !CONFIG_BASENAMES.has(path.basename(f.replace(/\\/g, "/"))))
  const unmappedFiles = input.moduleBlocks && input.moduleBlocks.length > 0 && nonConfigScopeFiles.length > 0
    ? nonConfigScopeFiles.filter((file) => !belongsToAnyBlock(file, input.moduleBlocks!))
    : []

  return ArtifactAudit.parse({
    source_files_added: sourceFiles.length,
    config_files_added: configFiles.length,
    doc_files_added: docFiles.length,
    source_file_count: sourceFiles.length,
    doc_file_count: docFiles.length,
    non_source_churn_ratio: files.length === 0 ? 0 : nonSourceCount / files.length,
    readme_proliferation_count: allowedDocs ? 0 : duplicateDocs.length,
    out_of_scope_file_count: unmappedFiles.length,
    scaffold_noise_count: scaffoldFlags.length,
    placeholder_count: placeholderHits.length,
    out_of_scope_files: unmappedFiles,
    unmapped_files: unmappedFiles,
    placeholder_hits: placeholderHits,
    duplicate_docs: duplicateDocs,
    scaffold_expansion_flags: scaffoldFlags,
  })
}

export function moduleBlocksFromRequest(request: string): ModuleBlock[] {
  const allowed = allowedArtifactsFromRequest(request)
  if (allowed.length === 0) return []
  return [{
    id: "request-scope",
    owned_paths: allowed,
  }]
}

export async function deriveRunMetrics(input: {
  rootDir: string
  events: EventEntry[]
  changedFiles?: string[]
  evaluationChecks?: Array<{ status?: string; name?: string }>
  completedAt: number
  moduleBlocks?: ModuleBlock[]
}): Promise<RunMetricsType> {
  const files = dedupeFiles(input.changedFiles && input.changedFiles.length > 0 ? input.changedFiles : await listFiles(input.rootDir))
  const changedFiles = dedupeFiles(input.changedFiles ?? [])
  const latestChangeAt = await latestMtime(input.rootDir, files)
  const commandSummaries = input.events
    .map((event) => String(event.summary || event.text || event.toolName || ""))
    .map(normalizeText)
    .filter(Boolean)
  const verificationEvents = commandSummaries.filter((value) => VERIFY_RE.test(value))
  const repeatedCommands = repeatedCount(commandSummaries)
  const checkStatuses = input.evaluationChecks ?? []
  const passedChecks = checkStatuses.filter((item) => item.status === "passed").length
  const totalChecks = checkStatuses.length
  const noopCycles = longestVerificationStreak(commandSummaries)
  const repeatedReasoning = repeatedSimilarity(commandSummaries)
  // Exclude config infrastructure files from scope drift — modifying tsconfig.json,
  // package.json, etc. is often necessary for the project to function (e.g., adding
  // @types/bun to make `bunx tsc --noEmit` pass) and should not count as scope drift.
  const scopeFiles = changedFiles.filter((f) => !CONFIG_BASENAMES.has(path.basename(f.replace(/\\/g, "/"))))
  const mappedChangedCount = scopeFiles.length > 0 && input.moduleBlocks && input.moduleBlocks.length > 0
    ? scopeFiles.filter((file) => belongsToAnyBlock(file, input.moduleBlocks!)).length
    : 0
  const scopeDriftScore = scopeFiles.length > 0 && input.moduleBlocks && input.moduleBlocks.length > 0
    ? Math.max(0, 1 - mappedChangedCount / scopeFiles.length)
    : 0
  const traceability = scopeFiles.length > 0 && input.moduleBlocks && input.moduleBlocks.length > 0
    ? mappedChangedCount / scopeFiles.length
    : files.length > 0 ? 1 : 0
  return RunMetrics.parse({
    meaningful_change_gap_ms: latestChangeAt > 0 ? Math.max(0, input.completedAt - latestChangeAt) : input.completedAt,
    noop_cycle_count: noopCycles,
    repeat_command_ratio: commandSummaries.length === 0 ? 0 : repeatedCommands / commandSummaries.length,
    repeat_reasoning_similarity: repeatedReasoning,
    required_check_pass_rate: totalChecks === 0 ? 0 : passedChecks / totalChecks,
    critical_check_pass_rate: totalChecks === 0 ? 0 : passedChecks / totalChecks,
    check_relevance_score: totalChecks === 0 ? 0 : Math.min(1, passedChecks / totalChecks + 0.25),
    verification_edit_ratio: files.length === 0 ? verificationEvents.length : verificationEvents.length / files.length,
    feature_coverage_p0: totalChecks > 0 && passedChecks === totalChecks ? 1 : 0,
    scope_drift_score: scopeDriftScore,
    plan_to_change_traceability: traceability,
    delivery_focus_score: files.length === 0 ? 0 : Math.max(0, 1 - verificationEvents.length / Math.max(1, commandSummaries.length)),
  })
}

export function evaluateQualityGates(input: {
  artifactAudit: ArtifactAuditType
  runMetrics: RunMetricsType
  taskStatus: string
  evaluationVerdict?: string
  localVerifyExitCode?: number
}): QualityVerdict {
  const failures: QualityFailure[] = []
  if (input.runMetrics.noop_cycle_count >= 8 || (input.runMetrics.meaningful_change_gap_ms >= 15 * 60 * 1000 && input.runMetrics.repeat_command_ratio >= 0.45)) {
    failures.push({
      category: "liveness",
      message: "Long verification-only loop without meaningful progress",
      evidence: `noop_cycle_count=${input.runMetrics.noop_cycle_count}, meaningful_change_gap_ms=${input.runMetrics.meaningful_change_gap_ms}, repeat_command_ratio=${input.runMetrics.repeat_command_ratio.toFixed(2)}`,
    })
  }
  if (input.artifactAudit.readme_proliferation_count > 0 || input.artifactAudit.scaffold_noise_count > 0) {
    failures.push({
      category: "artifact_quality",
      message: "Documentation or scaffold noise exceeded quality gate",
      evidence: `readme_proliferation_count=${input.artifactAudit.readme_proliferation_count}, scaffold_noise_count=${input.artifactAudit.scaffold_noise_count}`,
    })
  }
  if (input.artifactAudit.placeholder_count > 0) {
    failures.push({
      category: "delivery_gap",
      message: "Placeholder implementation detected",
      evidence: input.artifactAudit.placeholder_hits.join(", "),
    })
  }
  if (input.taskStatus !== "completed" || input.evaluationVerdict !== "accepted" || input.localVerifyExitCode !== 0) {
    failures.push({
      category: "verification_gap",
      message: "Core delivery acceptance checks did not all pass",
      evidence: `taskStatus=${input.taskStatus}, evaluationVerdict=${input.evaluationVerdict || ""}, localVerifyExitCode=${input.localVerifyExitCode ?? -1}`,
    })
  }
  if (
    input.artifactAudit.out_of_scope_file_count > 0 ||
    input.runMetrics.scope_drift_score >= 0.25 ||
    (input.runMetrics.plan_to_change_traceability > 0 && input.runMetrics.plan_to_change_traceability < 0.7)
  ) {
    failures.push({
      category: "scope_drift",
      message: "Changed files are not cleanly traceable to approved module blocks",
      evidence: `out_of_scope_file_count=${input.artifactAudit.out_of_scope_file_count}, scope_drift_score=${input.runMetrics.scope_drift_score.toFixed(2)}, plan_to_change_traceability=${input.runMetrics.plan_to_change_traceability.toFixed(2)}`,
    })
  }

  const verdict = failures.some((item) => item.category === "liveness")
    ? "blocked"
    : failures.length > 0
      ? "rejected"
      : "accepted"
  return {
    verdict,
    primary_failure: failures[0]?.category ?? null,
    failures,
    manual_review_summary: failures.length === 0
      ? "No quality-gate failures detected."
      : failures.map((item) => `${item.category}: ${item.message}`).join(" | "),
  }
}

async function listFiles(rootDir: string) {
  const output: string[] = []
  await walk(rootDir, "", output)
  return output
}

async function walk(rootDir: string, current: string, output: string[]) {
  const abs = current ? path.join(rootDir, current) : rootDir
  const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".opencorvus") continue
    const rel = current ? path.join(current, entry.name) : entry.name
    if (entry.isDirectory()) {
      await walk(rootDir, rel, output)
      continue
    }
    output.push(rel.replace(/\\/g, "/"))
  }
}

async function latestMtime(rootDir: string, files: string[]) {
  let latest = 0
  for (const file of files) {
    const stat = await fs.stat(path.join(rootDir, file)).catch(() => null)
    latest = Math.max(latest, stat?.mtimeMs ?? 0)
  }
  return Math.floor(latest)
}

function dedupeFiles(files: string[]) {
  return [...new Set(files.map((file) => file.replace(/\\/g, "/")).filter(Boolean))]
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function repeatedCount(values: string[]) {
  const seen = new Set<string>()
  let repeated = 0
  for (const value of values) {
    if (seen.has(value)) repeated += 1
    seen.add(value)
  }
  return repeated
}

function longestVerificationStreak(values: string[]) {
  let longest = 0
  let current = 0
  for (const value of values) {
    if (VERIFY_RE.test(value)) {
      current += 1
      longest = Math.max(longest, current)
      continue
    }
    current = 0
  }
  return longest
}

function repeatedSimilarity(values: string[]) {
  if (values.length === 0) return 0
  return repeatedCount(values) / values.length
}

function belongsToAnyBlock(file: string, moduleBlocks: ModuleBlock[]) {
  return moduleBlocks.some((block) =>
    (block.owned_paths ?? []).some((ownedPath) => file === ownedPath || file.startsWith(`${ownedPath}/`) || file.startsWith(`${ownedPath}\\`)),
  )
}

function allowedArtifactsFromRequest(request: string) {
  const lines = request.split(/\r?\n/)
  const allowed: string[] = []
  let active = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!active && /^only\s+(create|modify|create or modify|modify or create).*(files|paths?)\s*:?\s*$/i.test(trimmed)) {
      active = true
      continue
    }
    if (!active) continue
    if (!trimmed) break
    const bullet = trimmed.match(/^[-*]\s+`?([^`]+?)`?\s*$/)
    const numbered = trimmed.match(/^\d+\.\s+`?([^`]+?)`?\s*$/)
    const value = bullet?.[1] || numbered?.[1]
    if (!value) break
    allowed.push(value.replace(/\\/g, "/"))
  }
  return dedupeFiles(allowed)
}
