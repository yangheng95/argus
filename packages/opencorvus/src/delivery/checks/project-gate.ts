import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Instance } from "@/project/instance"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { clip } from "./types"
import { computeRuntimeEvidence } from "./runtime-evidence"
import {
  commandGroups,
  discoverPackageRoot,
  discoverChecks,
  resolveConfig,
  resolvedChecks,
} from "./discovery"
import { detectDeliverySurfaces } from "../surface-detector"
import type { DeliverySurfaceManifest } from "../surface-detector"
import { arbitrateDeliveryGate } from "../arbiter"
import { runBackendApiReview, runClientContractReview } from "../specialists/backend-client"
import { runSecurityDataReview } from "../specialists/security-data"
import type { EvaluatorCommand } from "./types"
import {
  createManifestId,
  digestCommand,
  failureSignatureForCheck,
  validateDeliveryEvidenceManifest,
  validateDeliveryCoverage,
  type DeliveryCheckResult,
  type DeliveryEvidenceManifest,
  type DeliveryGoalCoverage,
  type DeliveryRequirementCoverage,
  type DeliveryManifestFunctionalAssessment,
  type DeliveryRequiredCheck,
  type DeliveryReviewEvidence,
  type DeliveryRuntimeFlowResult,
} from "../manifest"
import type { DeliverySpecialistReview } from "../specialist-review"

const COMMAND_TIMEOUT_MS = 180_000
const CHECK_WORKSPACE_EXCLUDED_NAMES = new Set([
  ".git",
  ".opencorvus",
  ".opencorvus-worktrees",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "node_modules",
  "out",
])

export async function buildDeliveryEvidenceManifest(input: {
  taskID?: string
  runID?: string
  deliveryID?: string
  specSnapshotID?: string
  iteration?: number
  changedFiles: string[]
  taskRequest?: string
  metadata?: Record<string, unknown>
  goals?: Array<{
    id: string
    title: string
    priority: "blocking" | "advisory"
    requirement_ids: string[]
    acceptance_spec_count?: number
    runtime_scenario_count?: number
    depends_on?: string[]
    imports?: string[]
    exports?: string[]
  }>
}): Promise<DeliveryEvidenceManifest> {
  const projectRoot = await discoverPackageRoot(input.changedFiles)
  const surfaceManifest = await detectDeliverySurfaces({
    taskID: input.taskID,
    deliveryID: input.deliveryID,
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
  const failedCoverageIds = validateDeliveryCoverage(coverage)
  const runtimeFlows = await runRuntimeFlows({
    taskID: input.taskID,
    iteration: input.iteration ?? 0,
    surfaceManifest,
    requiredChecks,
    checkResults: [],
    goals: input.goals,
  })
  const failedRuntimeFlowIds = runtimeFlows
    .filter((item) => item.status === "failed")
    .map((item) => item.id)
  const specialistReviews = await runSpecialistReviews({
    taskID: input.taskID,
    runID: input.runID,
    deliveryID: input.deliveryID,
    projectRoot,
    surfaceManifest,
    requiredChecks,
    checkResults: [],
    runtimeFlows,
    goals: input.goals ?? [],
  })
  const reviewEvidence = [
    ...buildReviewEvidence({
      taskID: input.taskID,
      specSnapshotID: input.specSnapshotID,
      goals: input.goals ?? [],
    }),
    ...specialistReviews.map(specialistReviewEvidence),
  ]
  const failedReviewIds = reviewEvidence
    .filter((item) => item.status === "failed")
    .map((item) => item.id)
  const completionAssessment = assessFunctionalCompletion({
    failedCheckIds: [],
    failedCoverageIds,
    failedRuntimeFlowIds,
    failedReviewIds,
    specialistReviews,
  })
  const checkResults = completionAssessment.status === "complete"
    ? await runRequiredChecks(requiredChecks)
    : requiredChecks.map((check) => skipRequiredCheck(
        check,
        "Skipped because delivery completion evidence failed before auxiliary programmatic checks.",
      ))

  const manifest: DeliveryEvidenceManifest = {
    id: createManifestId(),
    taskId: input.taskID,
    runId: input.runID,
    deliveryId: input.deliveryID,
    iteration: input.iteration ?? 0,
    headRef: await currentHeadRef(Instance.directory),
    requiredChecks,
    checkResults,
    goalCoverage: coverage.goalCoverage,
    requirementCoverage: coverage.requirementCoverage,
    runtimeFlows,
    reviewEvidence,
    surfaceManifest,
    specialistReviews,
    changedFiles: input.changedFiles,
    finalGate: {
      status: "failed",
      summary: "Delivery evidence gate not evaluated.",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
      failedReviewIds: [],
    },
    timeCreated: Date.now(),
  }
  const checks = validateDeliveryEvidenceManifest(manifest, {
    skippedChecksPass: completionAssessment.status === "incomplete",
  })
  const functionalAssessment = assessFunctionalCompletion({
    failedCheckIds: checks.failedCheckIds,
    failedCoverageIds,
    failedRuntimeFlowIds,
    failedReviewIds,
    specialistReviews,
  })
  manifest.functionalAssessment = functionalAssessment
  manifest.finalGate = arbitrateDeliveryGate({
    checks,
    failedCoverageIds,
    failedRuntimeFlowIds,
    failedReviewIds,
    functionalAssessment,
  })
  return manifest
}

async function runRequiredChecks(requiredChecks: DeliveryRequiredCheck[]) {
  const checkResults: DeliveryCheckResult[] = []
  for (const check of requiredChecks) {
    checkResults.push(await runRequiredCheck(check))
  }
  return checkResults
}

/**
 * Per the project rule "只看功能完成度和e2e测试结果，其余全部作为警告":
 * primary blockers are required-check failures (build/typecheck/test/e2e)
 * and goal-coverage failures (acceptance specs missing). Runtime probes
 * (puppeteer renders, server-launch checks) and specialist reviews are
 * advisory — they get reported as auxiliary so the agent can see and
 * address them, but they do not block delivery acceptance on their own.
 */
function assessFunctionalCompletion(input: {
  failedCheckIds: string[]
  failedCoverageIds: string[]
  failedRuntimeFlowIds: string[]
  failedReviewIds: string[]
  specialistReviews: DeliverySpecialistReview[]
}): DeliveryManifestFunctionalAssessment {
  const primaryFailureIds = [
    ...input.failedCheckIds,
    ...input.failedCoverageIds,
  ]
  const auxiliaryFailureIds = [
    ...input.failedRuntimeFlowIds,
    ...input.failedReviewIds,
  ]
  const status = primaryFailureIds.length === 0 ? "complete" : "incomplete"
  const summary = status === "complete"
    ? auxiliaryFailureIds.length === 0
      ? "Functional completion passed and auxiliary quality gates passed."
      : `Functional completion passed, but ${auxiliaryFailureIds.length} auxiliary advisory gate(s) reported issues.`
    : `Functional completion failed with ${primaryFailureIds.length} primary blocker(s) and ${auxiliaryFailureIds.length} auxiliary advisory issue(s).`
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
  deliveryID?: string
  projectRoot: string
  surfaceManifest: DeliverySurfaceManifest
  requiredChecks: DeliveryRequiredCheck[]
  checkResults: DeliveryCheckResult[]
  runtimeFlows: DeliveryRuntimeFlowResult[]
  goals: Array<{
    id: string
    requirement_ids: string[]
    acceptance_spec_count?: number
  }>
}): Promise<DeliverySpecialistReview[]> {
  const reviews: DeliverySpecialistReview[] = []
  const backendReview = await runBackendApiReview(input)
  if (backendReview) reviews.push(backendReview)
  const clientReview = await runClientContractReview(input)
  if (clientReview) reviews.push(clientReview)
  // Frontend and visual runtime are covered by the concrete runtime flow above.
  // Keeping parallel specialist rows made delivery slower and duplicated failures.
  const securityReview = await runSecurityDataReview(input)
  if (securityReview) reviews.push(securityReview)
  // Test command failures already appear under required checks. The deeper
  // test_integration reviewer remains available as a direct specialist helper,
  // but the default delivery gate no longer runs it on every delivery.
  return reviews
}

function specialistReviewEvidence(review: DeliverySpecialistReview): DeliveryReviewEvidence {
  const blocking = review.findings.filter((finding) => finding.proposedSeverity === "blocking")
  return {
    id: `specialist:${review.reviewer}`,
    name: `Specialist Review: ${review.reviewer}`,
    status: review.executionStatus === "completed" && blocking.length === 0 ? "passed" : "failed",
    artifactId: review.id,
    evidence: [
      review.summary,
      ...review.findings.map((finding) =>
        `${finding.proposedSeverity}:${finding.category}: ${finding.claim}`,
      ),
    ],
  }
}

function buildReviewEvidence(input: {
  taskID?: string
  specSnapshotID?: string
  goals: Array<{
    depends_on?: string[]
    imports?: string[]
    exports?: string[]
  }>
}): DeliveryReviewEvidence[] {
  const required = requiresIntegrityReview(input.goals)
  const id = "review:integrity"
  if (!required) {
    return [{
      id,
      name: "Integrity Review",
      status: "skipped",
      evidence: ["goal graph does not require integrity review"],
      specSnapshotId: input.specSnapshotID,
    }]
  }
  if (!input.taskID || !input.specSnapshotID) {
    return [{
      id,
      name: "Integrity Review",
      status: "failed",
      evidence: ["non-trivial goal graph requires integrity review, but task or spec snapshot identity is missing"],
      specSnapshotId: input.specSnapshotID,
    }]
  }
  const row = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, input.taskID!),
        eq(EngineArtifactTable.kind, "integrity_attempt"),
        sql`json_extract(${EngineArtifactTable.payload}, '$.spec_snapshot_id') = ${input.specSnapshotID}`,
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  if (!row) {
    return [{
      id,
      name: "Integrity Review",
      status: "failed",
      evidence: [`non-trivial goal graph requires integrity review for spec snapshot ${input.specSnapshotID}`],
      specSnapshotId: input.specSnapshotID,
    }]
  }
  const payload = (row.payload ?? {}) as {
    verdict?: string
    issues_count?: number
    corrections_count?: number
    missing_count?: number
    reason?: string | null
  }
  const unresolved = payload.verdict === "needs_correction"
    || (payload.corrections_count ?? 0) > 0
    || (payload.missing_count ?? 0) > 0
  return [{
    id,
    name: "Integrity Review",
    status: unresolved ? "failed" : "passed",
    artifactId: row.id,
    specSnapshotId: input.specSnapshotID,
    verdict: payload.verdict,
    evidence: [
      `verdict=${payload.verdict ?? "unknown"}`,
      `issues_count=${payload.issues_count ?? 0}`,
      `corrections_count=${payload.corrections_count ?? 0}`,
      `missing_count=${payload.missing_count ?? 0}`,
      payload.reason ? `reason=${payload.reason}` : undefined,
    ].filter((item): item is string => Boolean(item)),
  }]
}

function requiresIntegrityReview(goals: Array<{
  depends_on?: string[]
  imports?: string[]
  exports?: string[]
}>) {
  return goals.length >= 3
    || goals.some((goal) =>
      (goal.depends_on?.length ?? 0) > 0
      || (goal.imports?.length ?? 0) > 0
      || (goal.exports?.length ?? 0) > 0
    )
}

async function runRuntimeFlows(input: {
  taskID?: string
  iteration: number
  surfaceManifest: DeliverySurfaceManifest
  requiredChecks: DeliveryRequiredCheck[]
  checkResults: DeliveryCheckResult[]
  goals?: Array<{ runtime_scenario_count?: number }>
}): Promise<DeliveryRuntimeFlowResult[]> {
  const flows: DeliveryRuntimeFlowResult[] = []
  if (!input.surfaceManifest.surfaces.includes("frontend")) {
    return flows
  }
  const root = input.surfaceManifest.projectRoot
  const requireInteraction = (input.goals ?? [])
    .some((goal) => (goal.runtime_scenario_count ?? 0) > 0)
  const failedBuild = input.checkResults.some(
    (item) => (item.cwd ?? Instance.directory) === root && item.name === "build" && item.status !== "passed",
  )
  const id = `runtime:web:${path.relative(Instance.directory, root).replaceAll("\\", "/") || "."}`
  if (failedBuild) {
    flows.push({
      id,
      name: "Web Runtime Render",
      status: "failed",
      evidence: ["build check failed; runtime render cannot be trusted until build passes"],
    })
    return flows
  }
  const report = await computeRuntimeEvidence({
    projectDir: root,
    outDir: path.join(
      root,
      ".opencorvus",
      "delivery-runtime-flow",
      input.taskID ?? "no-task",
      String(input.iteration),
    ),
    viewport: { width: 1440, height: 900 },
    requireInteraction,
  })
  flows.push({
    id,
    name: requireInteraction ? "Web Runtime Render and Interaction" : "Web Runtime Render",
    status: report.passed ? "passed" : "failed",
    evidence: report.passed
      ? [
          [
            `rendered ${report.evidence.buildArtifactPath ?? "app"}`,
            `text=${report.evidence.dom?.textLength ?? "n/a"}`,
            `nodes=${report.evidence.dom?.nodeCount ?? "n/a"}`,
            report.evidence.interaction
              ? `interactions=${report.evidence.interaction.attemptedInteractionCount}/${report.evidence.interaction.visibleControlCount}`
              : undefined,
          ].filter(Boolean).join(" "),
        ]
      : report.violations.map((item) => `${item.kind}: ${item.detail}`),
    screenshotPath: report.evidence.renderedPngPath,
    dom: report.evidence.dom,
    interaction: report.evidence.interaction,
  })
  return flows
}

function buildCoverage(goals: Array<{
  id: string
  title: string
  priority: "blocking" | "advisory"
  requirement_ids: string[]
  acceptance_spec_count?: number
}>): {
  goalCoverage: DeliveryGoalCoverage[]
  requirementCoverage: DeliveryRequirementCoverage[]
} {
  const goalCoverage = goals.map((goal) => {
    const acceptanceSpecCount = goal.acceptance_spec_count ?? 0
    const covered = goal.priority === "advisory" || acceptanceSpecCount > 0
    return {
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
      status: covered ? "covered" as const : "uncovered" as const,
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
  const coveredGoals = new Set(
    goalCoverage
      .filter((item) => item.status === "covered")
      .map((item) => item.goalId),
  )
  const requirementCoverage: DeliveryRequirementCoverage[] = [...requirementToGoals.entries()]
    .map(([requirementId, goalIds]) => {
      const covered = goalIds.some((goalId) => coveredGoals.has(goalId))
      return {
        requirementId,
        status: covered ? "covered" as const : "uncovered" as const,
        goalIds,
        evidence: covered
          ? [`covered_by=${goalIds.filter((goalId) => coveredGoals.has(goalId)).join(",")}`]
          : ["linked goals have no structured acceptance_specs"],
      }
    })
  return { goalCoverage, requirementCoverage }
}

async function requiredChecksFromGroups(
  groups: ReturnType<typeof commandGroups>,
): Promise<DeliveryRequiredCheck[]> {
  const checks: DeliveryRequiredCheck[] = []
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

async function runRequiredCheck(check: DeliveryRequiredCheck): Promise<DeliveryCheckResult> {
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
  const result = await withIsolatedCheckWorkspace(check.cwd ?? Instance.directory, async (workspace) => {
    executionCwd = workspace
    return runShellCommand({
      command: check.command,
      cwd: workspace,
      timeoutMs: COMMAND_TIMEOUT_MS,
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
    failureSignature: status === "failed"
      ? failureSignatureForCheck({
          check,
          output: outputExcerpt,
          affectedFiles: [],
        })
      : undefined,
  }
}

function skipRequiredCheck(check: DeliveryRequiredCheck, reason: string): DeliveryCheckResult {
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
  sourceCwd: string,
  fn: (workspace: string) => Promise<T>,
): Promise<T> {
  const scratchParent = path.join(sourceCwd, ".opencorvus", "delivery-check-workspaces")
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
      await copyTreeIntoCheckWorkspace(
        path.join(source, entry),
        path.join(destination, entry),
        sourceRoot,
      )
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
}): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }> {
  const isWindows = process.platform === "win32"
  const proc = Bun.spawn(
    isWindows
      ? ["cmd.exe", "/d", "/s", "/c", input.command]
      : ["sh", "-lc", input.command],
    {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), input.timeoutMs),
  )
  const exited = proc.exited.then(() => "exited" as const)
  const state = await Promise.race([exited, timeout])
  if (state === "timeout") {
    proc.kill()
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = state === "timeout" ? undefined : await proc.exited
  return {
    exitCode,
    stdout,
    stderr: state === "timeout"
      ? `${stderr}\nCommand timed out after ${input.timeoutMs}ms.`
      : stderr,
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
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const value = stdout.trim()
  return value.length > 0 ? value : undefined
}
