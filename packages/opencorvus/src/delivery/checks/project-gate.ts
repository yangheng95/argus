import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "@/project/instance"
import { clip } from "./types"
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
  validateDeliveryEvidenceManifest,
  type DeliveryCheckResult,
  type DeliveryEvidenceManifest,
  type DeliveryRequiredCheck,
} from "../manifest"

const COMMAND_TIMEOUT_MS = 180_000

export async function buildDeliveryEvidenceManifest(input: {
  taskID?: string
  runID?: string
  deliveryID?: string
  iteration?: number
  changedFiles: string[]
  metadata?: Record<string, unknown>
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

  const manifest: DeliveryEvidenceManifest = {
    id: createManifestId(),
    taskId: input.taskID,
    runId: input.runID,
    deliveryId: input.deliveryID,
    iteration: input.iteration ?? 0,
    headRef: await currentHeadRef(Instance.directory),
    requiredChecks,
    checkResults,
    changedFiles: input.changedFiles,
    finalGate: {
      status: "failed",
      summary: "Delivery evidence gate not evaluated.",
      failedCheckIds: [],
    },
    timeCreated: Date.now(),
  }
  manifest.finalGate = validateDeliveryEvidenceManifest(manifest)
  return manifest
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
    }
  }

  const result = await runShellCommand({
    command: check.command,
    cwd: check.cwd ?? Instance.directory,
    timeoutMs: COMMAND_TIMEOUT_MS,
  })
  return {
    ...check,
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    outputExcerpt: clip([result.stdout, result.stderr].filter(Boolean).join("\n"), 4000),
    startedAt,
    completedAt: Date.now(),
    failureReason: result.exitCode === 0 ? undefined : `exit_code=${result.exitCode}`,
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
