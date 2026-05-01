import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "@/project/instance"
import { clip } from "./types"
import { computeRuntimeEvidence } from "./runtime-evidence"
import {
  commandGroups,
  discoverChecks,
  resolveConfig,
  resolvedChecks,
} from "./discovery"
import type { EvaluatorCommand } from "./types"
import {
  createManifestId,
  digestCommand,
  failureSignatureForCheck,
  mergeGateVerdicts,
  validateDeliveryEvidenceManifest,
  validateDeliveryCoverage,
  type DeliveryCheckResult,
  type DeliveryEvidenceManifest,
  type DeliveryGoalCoverage,
  type DeliveryRequirementCoverage,
  type DeliveryRequiredCheck,
  type DeliveryRuntimeFlowResult,
} from "../manifest"

const COMMAND_TIMEOUT_MS = 180_000

export async function buildDeliveryEvidenceManifest(input: {
  taskID?: string
  runID?: string
  deliveryID?: string
  iteration?: number
  changedFiles: string[]
  metadata?: Record<string, unknown>
  goals?: Array<{
    id: string
    title: string
    priority: "blocking" | "advisory"
    requirement_ids: string[]
    acceptance_spec_count?: number
  }>
}): Promise<DeliveryEvidenceManifest> {
  const discovered = await discoverChecks(input.changedFiles)
  const config = await resolveConfig(input.metadata)
  const resolved = resolvedChecks(config, discovered)
  const groups = commandGroups(resolved, discovered)
  const requiredChecks = await requiredChecksFromGroups(groups)
  const checkResults: DeliveryCheckResult[] = []

  for (const check of requiredChecks) {
    checkResults.push(await runRequiredCheck(check))
  }
  const coverage = buildCoverage(input.goals ?? [])
  const runtimeFlows = await runRuntimeFlows({
    taskID: input.taskID,
    iteration: input.iteration ?? 0,
    requiredChecks,
    checkResults,
  })

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
    changedFiles: input.changedFiles,
    finalGate: {
      status: "failed",
      summary: "Delivery evidence gate not evaluated.",
      failedCheckIds: [],
      failedCoverageIds: [],
      failedRuntimeFlowIds: [],
    },
    timeCreated: Date.now(),
  }
  const checks = validateDeliveryEvidenceManifest(manifest)
  const failedCoverageIds = validateDeliveryCoverage(coverage)
  const failedRuntimeFlowIds = runtimeFlows
    .filter((item) => item.status === "failed")
    .map((item) => item.id)
  manifest.finalGate = mergeGateVerdicts({ checks, failedCoverageIds, failedRuntimeFlowIds })
  return manifest
}

async function runRuntimeFlows(input: {
  taskID?: string
  iteration: number
  requiredChecks: DeliveryRequiredCheck[]
  checkResults: DeliveryCheckResult[]
}): Promise<DeliveryRuntimeFlowResult[]> {
  const roots = [...new Set(input.requiredChecks.map((item) => item.cwd ?? Instance.directory))]
  const flows: DeliveryRuntimeFlowResult[] = []
  for (const root of roots.length > 0 ? roots : [Instance.directory]) {
    const frontend = await isFrontendPackage(root)
    if (!frontend) continue
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
      continue
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
    })
    flows.push({
      id,
      name: "Web Runtime Render",
      status: report.passed ? "passed" : "failed",
      evidence: report.passed
        ? [
            `rendered ${report.evidence.buildArtifactPath ?? "app"} text=${report.evidence.dom?.textLength ?? "n/a"} nodes=${report.evidence.dom?.nodeCount ?? "n/a"}`,
          ]
        : report.violations.map((item) => `${item.kind}: ${item.detail}`),
      screenshotPath: report.evidence.renderedPngPath,
      dom: report.evidence.dom,
    })
  }
  return flows
}

async function isFrontendPackage(root: string) {
  const raw = await fs.readFile(path.join(root, "package.json"), "utf8").catch(() => undefined)
  if (!raw) return false
  const pkg = JSON.parse(raw) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const deps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
  const frontendDeps = [
    "react",
    "next",
    "vue",
    "svelte",
    "solid-js",
    "vite",
    "@vitejs/plugin-react",
    "@sveltejs/kit",
    "astro",
    "@solidjs/start",
  ]
  if (frontendDeps.some((dep) => deps.has(dep))) return true
  const scriptText = Object.values(pkg.scripts ?? {}).join("\n")
  return /\b(vite|next|astro|svelte-kit|solid-start)\b/.test(scriptText)
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

  const result = await runShellCommand({
    command: check.command,
    cwd: check.cwd ?? Instance.directory,
    timeoutMs: COMMAND_TIMEOUT_MS,
  })
  const status = result.exitCode === 0 ? "passed" : "failed"
  const outputExcerpt = clip([result.stdout, result.stderr].filter(Boolean).join("\n"), 4000)
  return {
    ...check,
    status,
    exitCode: result.exitCode,
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
