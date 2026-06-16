import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { collectMainWorktreeDiff, readBaselineCommitFromMetadata } from "@/engine/workspace-export"
import { clip } from "./types"
import { commandGroups, discoverPackageRoot, discoverChecks, resolveConfig, resolvedChecks } from "./discovery"
import { detectAcceptanceSurfaces } from "../surface-detector"
import type { AcceptanceSurfaceManifest } from "../surface-detector"
import { arbitrateAcceptanceGate } from "../arbiter"
import { buildContractAuditReviewEvidence, type ContractAuditCriteriaStatus } from "./contract-audit-review"
import { runBackendApiReview, runClientContractReview } from "../specialists/backend-client"
import { runSecurityDataReview } from "../specialists/security-data"
import type { AcceptanceSpec } from "@/acceptance/types"
import { ensureProjectReadyForRuntime } from "./runtime-readiness"
import type { EvaluatorCommand } from "./types"
import {
  createManifestId,
  digestCommand,
  failureSignatureForCheck,
  validateAcceptanceEvidenceManifest,
  validateAcceptanceCoverage,
  type AcceptanceCheckResult,
  type AcceptanceEvidenceManifest,
  type AcceptanceGoalCoverage,
  type AcceptanceRequirementCoverage,
  type AcceptanceManifestFunctionalAssessment,
  type AcceptanceRequiredCheck,
  type AcceptanceReviewEvidence,
} from "../manifest"
import type { AcceptanceSpecialistReview } from "../specialist-review"
import type { ReviewStreamStep } from "@/review/stream"

const COMMAND_TIMEOUT_MS = 180_000
const CHECK_WORKSPACE_EXCLUDED_NAMES = new Set([
  ".git",
  ".opencorvus",
  ".opencorvus-worktrees",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "out",
])

export async function buildAcceptanceEvidenceManifest(input: {
  taskID?: string
  runID?: string
  acceptanceID?: string
  specSnapshotID?: string
  iteration?: number
  changedFiles: string[]
  taskRequest?: string
  metadata?: Record<string, unknown>
  goals?: Array<{
    id: string
    latest_goal_run_id?: string
    title: string
    priority: "blocking" | "advisory"
    requirement_ids: string[]
    acceptance_spec_count?: number
    acceptance_scenarios?: AcceptanceSpec[]
    acceptance_specs?: AcceptanceSpec[]
    depends_on?: string[]
  }>
  criteriaResults?: Array<{
    name: string
    status: ContractAuditCriteriaStatus
    evidence?: string
    family?: string
    label?: string
    goal_id?: string
    goal_run_id?: string
  }>
  progress?: (event: { currentStep: ReviewStreamStep; summary?: string }) => void
}): Promise<AcceptanceEvidenceManifest> {
  input.progress?.({ currentStep: "manifest", summary: "Discovering project surfaces and required checks." })
  const projectRoot = await discoverPackageRoot(input.changedFiles)
  const surfaceManifest = await detectAcceptanceSurfaces({
    taskID: input.taskID,
    acceptanceID: input.acceptanceID,
    projectRoot,
    changedFiles: input.changedFiles,
    taskRequest: input.taskRequest,
    metadata: input.metadata,
    goals: input.goals,
  })
  const discovered = await discoverChecks(input.changedFiles)
  const config = await resolveConfig(input.metadata)
  const resolved = resolvedChecks(config, discovered)
  const groups = commandGroups(resolved, discovered)
  const requiredChecks = await requiredChecksFromGroups(groups)
  const coverage = buildCoverage(input.goals ?? [])
  const failedCoverageIds = validateAcceptanceCoverage(coverage)
  input.progress?.({ currentStep: "runtime", summary: "Checking project runtime readiness." })
  const runtimeReadiness = await ensureProjectReadyForRuntime({ projectRoot })
  const failedReadinessIds = runtimeReadiness.failedReadinessIds
  const preRuntimeAssessment = assessFunctionalCompletion({
    failedReadinessIds,
    failedCheckIds: [],
    failedCoverageIds,
    failedReviewIds: [],
    specialistReviews: [],
  })
  const checkResults =
    preRuntimeAssessment.status === "complete"
      ? await runRequiredChecks(input.taskID, requiredChecks)
      : requiredChecks.map((check) =>
          skipRequiredCheck(
            check,
            "Skipped because acceptance completion or runtime readiness evidence failed before auxiliary programmatic checks.",
          ),
        )
  input.progress?.({ currentStep: "specialist", summary: "Running acceptance specialist reviews." })
  const specialistReviews = await runSpecialistReviews({
    taskID: input.taskID,
    runID: input.runID,
    acceptanceID: input.acceptanceID,
    projectRoot,
    surfaceManifest,
    requiredChecks,
    checkResults,
    goals: input.goals ?? [],
    progress: input.progress,
  })
  const reviewEvidence = [
    ...buildReviewEvidence({
      taskID: input.taskID,
      specSnapshotID: input.specSnapshotID,
      goals: input.goals ?? [],
      criteriaResults: input.criteriaResults ?? [],
    }),
    await buildWorkspaceExportEvidence({
      metadata: input.metadata,
      changedFiles: input.changedFiles,
    }),
    ...specialistReviews.map(specialistReviewEvidence),
  ].filter((item): item is AcceptanceReviewEvidence => Boolean(item))
  const failedReviewIds = reviewEvidence.filter((item) => item.status === "failed").map((item) => item.id)

  const manifest: AcceptanceEvidenceManifest = {
    id: createManifestId(),
    taskId: input.taskID,
    runId: input.runID,
    acceptanceId: input.acceptanceID,
    iteration: input.iteration ?? 0,
    headRef: await currentHeadRef(Instance.directory),
    requiredChecks,
    runtimeReadiness,
    checkResults,
    goalCoverage: coverage.goalCoverage,
    requirementCoverage: coverage.requirementCoverage,
    reviewEvidence,
    surfaceManifest,
    specialistReviews,
    changedFiles: input.changedFiles,
    finalGate: {
      status: "failed",
      summary: "Acceptance evidence gate not evaluated.",
      failedReadinessIds: [],
      failedCheckIds: [],
      failedCoverageIds: [],
      failedReviewIds: [],
    },
    timeCreated: Date.now(),
  }
  const checks = validateAcceptanceEvidenceManifest(manifest, {
    skippedChecksPass: preRuntimeAssessment.status === "incomplete",
  })
  const functionalAssessment = assessFunctionalCompletion({
    failedReadinessIds,
    failedCheckIds: checks.failedCheckIds,
    failedCoverageIds,
    failedReviewIds,
    specialistReviews,
  })
  manifest.functionalAssessment = functionalAssessment
  manifest.finalGate = arbitrateAcceptanceGate({
    checks,
    failedReadinessIds,
    failedCoverageIds,
    failedReviewIds,
    functionalAssessment,
  })
  return manifest
}

async function runRequiredChecks(taskID: string | undefined, requiredChecks: AcceptanceRequiredCheck[]) {
  const checkResults: AcceptanceCheckResult[] = []
  for (const check of requiredChecks) {
    checkResults.push(await runRequiredCheck(taskID, check))
  }
  return checkResults
}

/**
 * Blocking criteria — these failures mean acceptance completion is not proven:
 *   - failedReadinessIds: merged trunk cannot prove its declared runtime.
 *   - failedCoverageIds: blocking goals without acceptance specs.
 *   - review:contract_audit: declared cross-goal contracts are broken.
 *
 * Advisory criteria — integrity acceptance review weighs these in context and
 * decides whether they materially block acceptance:
 *   - failedCheckIds: build / typecheck / lint / unit-test commands.
 *   - non-contract review-shaped evidence (review:workspace_export,
 *     specialist:*): the acceptance reviewer reads the full evidence and decides.
 */
function assessFunctionalCompletion(input: {
  failedReadinessIds: string[]
  failedCheckIds: string[]
  failedCoverageIds: string[]
  failedReviewIds: string[]
  specialistReviews: AcceptanceSpecialistReview[]
}): AcceptanceManifestFunctionalAssessment {
  const blockingReviewIds = input.failedReviewIds.filter((id) => id === "review:contract_audit")
  const blockingReviewIdSet = new Set<string>(blockingReviewIds)
  const primaryFailureIds = [...input.failedReadinessIds, ...input.failedCoverageIds, ...blockingReviewIds]
  const auxiliaryFailureIds = [
    ...input.failedCheckIds,
    ...input.failedReviewIds.filter((id) => !blockingReviewIdSet.has(id)),
  ]
  const status = primaryFailureIds.length === 0 ? "complete" : "incomplete"
  const advisoryNote =
    auxiliaryFailureIds.length > 0
      ? ` ${auxiliaryFailureIds.length} advisory issue(s) recorded for acceptance review.`
      : ""
  const summary =
    status === "complete"
      ? `Functional completion passed (acceptance-spec coverage satisfied).${advisoryNote}`
      : `Functional completion failed with ${primaryFailureIds.length} blocker(s).${advisoryNote}`
  return {
    status,
    primaryFailureIds: [...new Set(primaryFailureIds)].sort(),
    auxiliaryFailureIds: [...new Set(auxiliaryFailureIds)].sort(),
    summary,
  }
}

async function runSpecialistReviews(input: {
  taskID?: string
  runID?: string
  acceptanceID?: string
  projectRoot: string
  surfaceManifest: AcceptanceSurfaceManifest
  requiredChecks: AcceptanceRequiredCheck[]
  checkResults: AcceptanceCheckResult[]
  goals: Array<{
    id: string
    requirement_ids: string[]
    acceptance_spec_count?: number
  }>
  progress?: (event: { currentStep: ReviewStreamStep; summary?: string }) => void
}): Promise<AcceptanceSpecialistReview[]> {
  const reviews: AcceptanceSpecialistReview[] = []
  input.progress?.({ currentStep: "specialist", summary: "Reviewing backend API surface." })
  const backendReview = await runBackendApiReview(input)
  if (backendReview) reviews.push(backendReview)
  input.progress?.({ currentStep: "specialist", summary: "Reviewing client contract surface." })
  const clientReview = await runClientContractReview(input)
  if (clientReview) reviews.push(clientReview)
  input.progress?.({ currentStep: "specialist", summary: "Reviewing security and data surface." })
  const securityReview = await runSecurityDataReview(input)
  if (securityReview) reviews.push(securityReview)
  return reviews
}

function specialistReviewEvidence(review: AcceptanceSpecialistReview): AcceptanceReviewEvidence {
  const blocking = review.findings.filter((finding) => finding.proposedSeverity === "blocking")
  return {
    id: `specialist:${review.reviewer}`,
    name: `Specialist Review: ${review.reviewer}`,
    status: review.executionStatus === "completed" && blocking.length === 0 ? "passed" : "failed",
    artifactId: review.id,
    evidence: [
      review.summary,
      ...review.findings.map((finding) => `${finding.proposedSeverity}:${finding.category}: ${finding.claim}`),
    ],
  }
}

function buildReviewEvidence(input: {
  taskID?: string
  specSnapshotID?: string
  goals: Array<{
    priority?: "blocking" | "advisory"
    id?: string
    latest_goal_run_id?: string
    depends_on?: string[]
    acceptance_specs?: AcceptanceSpec[]
  }>
  criteriaResults?: Array<{
    name: string
    status: ContractAuditCriteriaStatus
    evidence?: string
    family?: string
    label?: string
    goal_id?: string
    goal_run_id?: string
  }>
}): AcceptanceReviewEvidence[] {
  return buildContractAuditReviewEvidence({
    goals: input.goals,
    criteriaResults: input.criteriaResults ?? [],
  })
}

async function buildWorkspaceExportEvidence(input: {
  metadata?: Record<string, unknown>
  changedFiles: string[]
}): Promise<AcceptanceReviewEvidence | undefined> {
  const declaredChangedFiles = input.changedFiles
    .filter((item) => item.length > 0)
    .filter(ProjectRuntimePaths.isSourceEnumerationAllowed)
  if (declaredChangedFiles.length === 0) return undefined
  const baseRef = readBaselineCommitFromMetadata(input.metadata)
  if (!baseRef) return undefined
  const id = "review:workspace_export"
  const { changedFiles: exportedChangedFiles, patch } = await collectMainWorktreeDiff(Instance.directory, baseRef)
  const exportedSet = new Set(exportedChangedFiles)
  const missingDeclaredFiles = declaredChangedFiles.filter((item) => !exportedSet.has(item))
  const failed = exportedChangedFiles.length === 0 || patch.trim().length === 0 || missingDeclaredFiles.length > 0
  return {
    id,
    name: "Workspace Export Coverage",
    status: failed ? "failed" : "passed",
    evidence: failed
      ? [
          `declared_changed_files=${declaredChangedFiles.length}`,
          `exported_changed_files=${exportedChangedFiles.length}`,
          `missing_declared_files=${missingDeclaredFiles.join(", ") || "(none)"}`,
          `baseline=${baseRef}`,
        ]
      : [
          `declared_changed_files=${declaredChangedFiles.length}`,
          `exported_changed_files=${exportedChangedFiles.length}`,
          `baseline=${baseRef}`,
        ],
  }
}

function buildCoverage(
  goals: Array<{
    id: string
    title: string
    priority: "blocking" | "advisory"
    requirement_ids: string[]
    acceptance_spec_count?: number
  }>,
): {
  goalCoverage: AcceptanceGoalCoverage[]
  requirementCoverage: AcceptanceRequirementCoverage[]
} {
  const goalCoverage = goals.map((goal) => {
    const acceptanceSpecCount = goal.acceptance_spec_count ?? 0
    const covered = goal.priority === "advisory" || acceptanceSpecCount > 0
    return {
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
      status: covered ? ("covered" as const) : ("uncovered" as const),
      acceptanceSpecCount,
      evidence: covered
        ? [`acceptance_spec_count=${acceptanceSpecCount}`]
        : ["blocking goal has no structured acceptance_specs"],
    }
  })
  const requirementToGoals = new Map<string, string[]>()
  for (const goal of goals) {
    for (const requirementId of goal.requirement_ids) {
      const list = requirementToGoals.get(requirementId) ?? []
      list.push(goal.id)
      requirementToGoals.set(requirementId, list)
    }
  }
  const coveredGoals = new Set(goalCoverage.filter((item) => item.status === "covered").map((item) => item.goalId))
  const requirementCoverage: AcceptanceRequirementCoverage[] = [...requirementToGoals.entries()].map(
    ([requirementId, goalIds]) => {
      const covered = goalIds.some((goalId) => coveredGoals.has(goalId))
      return {
        requirementId,
        status: covered ? ("covered" as const) : ("uncovered" as const),
        goalIds,
        evidence: covered
          ? [`covered_by=${goalIds.filter((goalId) => coveredGoals.has(goalId)).join(",")}`]
          : ["linked goals have no structured acceptance_specs"],
      }
    },
  )
  return { goalCoverage, requirementCoverage }
}

async function requiredChecksFromGroups(groups: ReturnType<typeof commandGroups>): Promise<AcceptanceRequiredCheck[]> {
  const checks: AcceptanceRequiredCheck[] = []
  for (const group of groups) {
    for (const [index, rawCommand] of group.commands.entries()) {
      const command = rawCommand as EvaluatorCommand
      const cwd = command.cwd ?? Instance.directory
      const script = await scriptBodyForCommand(cwd, command.command)
      const id = `${group.name}#${index + 1}`
      checks.push({
        id,
        name: group.name,
        label: group.label,
        family: group.family,
        command: command.command,
        cwd,
        commandDigest: digestCommand({ command: command.command, cwd, script }),
      })
    }
  }
  return checks
}

async function runRequiredCheck(
  taskID: string | undefined,
  check: AcceptanceRequiredCheck,
): Promise<AcceptanceCheckResult> {
  const startedAt = Date.now()
  const script = await scriptBodyForCommand(check.cwd ?? Instance.directory, check.command)
  const forbidden = forbiddenShellSuccess(check.command, script)
  if (forbidden) {
    return {
      ...check,
      status: "failed",
      exitCode: undefined,
      outputExcerpt: forbidden,
      startedAt,
      completedAt: Date.now(),
      failureReason: forbidden,
      failureSignature: failureSignatureForCheck({
        check,
        output: forbidden,
        affectedFiles: [],
      }),
    }
  }

  let executionCwd: string | undefined
  const result = await withIsolatedCheckWorkspace(taskID, check.cwd ?? Instance.directory, async (workspace) => {
    executionCwd = workspace
    return runShellCommand({
      command: check.command,
      cwd: workspace,
      timeoutMs: COMMAND_TIMEOUT_MS,
      taskID,
    })
  })
  const status = result.exitCode === 0 ? "passed" : "failed"
  const outputExcerpt = clip([result.stdout, result.stderr].filter(Boolean).join("\n"), 4000)
  return {
    ...check,
    status,
    exitCode: result.exitCode,
    executionCwd,
    outputExcerpt,
    startedAt,
    completedAt: Date.now(),
    failureReason: result.exitCode === 0 ? undefined : `exit_code=${result.exitCode}`,
    failureSignature:
      status === "failed"
        ? failureSignatureForCheck({
            check,
            output: outputExcerpt,
            affectedFiles: [],
          })
        : undefined,
  }
}

function skipRequiredCheck(check: AcceptanceRequiredCheck, reason: string): AcceptanceCheckResult {
  const now = Date.now()
  return {
    ...check,
    status: "skipped",
    outputExcerpt: reason,
    startedAt: now,
    completedAt: now,
  }
}

async function withIsolatedCheckWorkspace<T>(
  taskID: string | undefined,
  sourceCwd: string,
  fn: (workspace: string) => Promise<T>,
): Promise<T> {
  const scratchParent = taskID
    ? ProjectRuntimePaths.acceptancePaths(Instance.directory, taskID).checkWorkspaces
    : ProjectRuntimePaths.tasklessAcceptancePaths(sourceCwd).checkWorkspaces
  await fs.mkdir(scratchParent, { recursive: true })
  const scratchRoot = await fs.mkdtemp(path.join(scratchParent, `${randomUUID()}-`))
  const workspace = path.join(scratchRoot, "workspace")
  try {
    await copyTreeIntoCheckWorkspace(sourceCwd, workspace, sourceCwd)
    return await fn(workspace)
  } finally {
    await fs.rm(scratchRoot, { recursive: true, force: true })
  }
}

async function copyTreeIntoCheckWorkspace(source: string, destination: string, sourceRoot: string): Promise<void> {
  if (!shouldCopyIntoCheckWorkspace(sourceRoot, source)) return
  const stat = await fs.lstat(source)
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true })
    const entries = await fs.readdir(source)
    for (const entry of entries) {
      await copyTreeIntoCheckWorkspace(path.join(source, entry), path.join(destination, entry), sourceRoot)
    }
    return
  }
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(source)
    await fs.symlink(target, destination)
    return
  }
  if (stat.isFile()) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.copyFile(source, destination)
  }
}

function shouldCopyIntoCheckWorkspace(sourceCwd: string, candidate: string) {
  const relative = path.relative(sourceCwd, candidate)
  if (!relative) return true
  return relative.split(path.sep).every((part) => !CHECK_WORKSPACE_EXCLUDED_NAMES.has(part))
}

async function runShellCommand(input: {
  command: string
  cwd: string
  timeoutMs: number
  taskID?: string
}): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }> {
  const isWindows = process.platform === "win32"
  const [command, ...args] = isWindows ? ["cmd.exe", "/d", "/s", "/c", input.command] : ["sh", "-lc", input.command]
  const proc = spawn(command, args, {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...(input.taskID ? { OPENCORVUS_TASK_ID: input.taskID } : {}),
      OPENCORVUS_PROJECT_DIR: Instance.directory,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  proc.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)))
  proc.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)))
  let timedOut = false
  const exitCode = await new Promise<number | undefined>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
      resolve(undefined)
    }, input.timeoutMs)
    proc.once("error", () => {
      clearTimeout(timer)
      resolve(undefined)
    })
    proc.once("exit", (code) => {
      clearTimeout(timer)
      resolve(code ?? undefined)
    })
  })
  const stdout = Buffer.concat(stdoutChunks).toString("utf8")
  const stderr = Buffer.concat(stderrChunks).toString("utf8")
  return {
    exitCode,
    stdout,
    stderr: timedOut ? `${stderr}\nCommand timed out after ${input.timeoutMs}ms.` : stderr,
  }
}

async function scriptBodyForCommand(cwd: string, command: string) {
  const scriptName = parsePackageScriptName(command)
  if (!scriptName) return undefined
  const pkgPath = path.join(cwd, "package.json")
  const raw = await fs.readFile(pkgPath, "utf8").catch(() => undefined)
  if (!raw) return undefined
  const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
  return pkg.scripts?.[scriptName]
}

function parsePackageScriptName(command: string) {
  const parts = command.trim().split(/\s+/)
  const runIndex = parts.findIndex((part) => part === "run")
  if (runIndex < 0) return undefined
  return parts[runIndex + 1]
}

function forbiddenShellSuccess(command: string, script?: string) {
  const text = [command, script].filter(Boolean).join("\n")
  if (/(^|[\s;])\|\|\s*(true|exit\s+0)(\s|$)/.test(text)) {
    return "Forbidden shell success coercion: command uses `|| true` or `|| exit 0`."
  }
  if (/(^|[\s;])&&\s*exit\s+0(\s|$)/.test(text)) {
    return "Forbidden shell success coercion: command uses `&& exit 0`."
  }
  return undefined
}

async function currentHeadRef(cwd: string) {
  const proc = spawn("git", ["rev-parse", "HEAD"], {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdoutChunks: Buffer[] = []
  proc.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)))
  await new Promise<void>((resolve) => {
    proc.once("error", () => resolve())
    proc.once("exit", () => resolve())
  })
  const stdout = Buffer.concat(stdoutChunks).toString("utf8")
  const value = stdout.trim()
  return value.length > 0 ? value : undefined
}
