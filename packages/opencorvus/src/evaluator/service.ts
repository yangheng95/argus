import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { Shell as ShellUtil } from "@/shell/shell"
import { spawn } from "child_process"
import path from "path"
import z from "zod"
import { CheckConfig, EvaluationCheck } from "@/orchestrator/model"

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT = 12000

export const EvaluationResult = z.object({
  status: z.enum(["passed", "failed", "inconclusive"]),
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  summary: z.string(),
  checks: EvaluationCheck.array(),
  artifacts: z.array(
    z.object({
      kind: z.enum(["log"]),
      label: z.string(),
      payload: z.record(z.string(), z.any()),
    }),
  ),
})

export namespace EvaluatorService {
  export async function evaluate(task: { metadata?: Record<string, unknown> }, delivery: { summary: string }) {
    const config = await resolveConfig(task.metadata)
    const checks = [
      { name: "build", commands: config.build ?? [] },
      { name: "test", commands: config.test ?? [] },
      { name: "lint", commands: config.lint ?? [] },
      { name: "verify_cmd", commands: config.verify_cmd ?? [] },
    ].filter((item) => item.commands.length > 0)

    if (checks.length === 0) {
      return {
        status: "inconclusive" as const,
        verdict: "inconclusive" as const,
        summary: "No evaluator commands were configured or discovered.",
        checks: [
          {
            name: "evaluation_config",
            status: "skipped" as const,
            evidence: delivery.summary,
          },
        ],
        artifacts: [],
      }
    }

    const results: z.infer<typeof EvaluationCheck>[] = []
    const artifacts: Array<{ kind: "log"; label: string; payload: Record<string, unknown> }> = []

    for (const group of checks) {
      for (const [index, command] of group.commands.entries()) {
        const label = group.commands.length === 1 ? group.name : `${group.name}#${index + 1}`
        const result = await commandResult(command, config.timeout_ms ?? DEFAULT_TIMEOUT_MS)
        artifacts.push({
          kind: "log",
          label: `evaluation:${label}`,
          payload: {
            command,
            code: result.code,
            output: clip(result.output),
          },
        })
        if (result.code === 0) {
          results.push({
            name: label,
            status: "passed",
            evidence: clip(result.output) || `${command} passed`,
          })
          continue
        }
        results.push({
          name: label,
          status: "failed",
          evidence: clip(result.output) || `${command} failed`,
        })
        return {
          status: "failed" as const,
          verdict: "rejected" as const,
          summary: `Evaluation failed at ${label}.`,
          checks: results,
          artifacts,
        }
      }
    }

    return {
      status: "passed" as const,
      verdict: "accepted" as const,
      summary: "All evaluator commands passed.",
      checks: results,
      artifacts,
    }
  }
}

async function resolveConfig(metadata?: Record<string, unknown>) {
  const configured = CheckConfig.safeParse(metadata?.checks)
  if (configured.success) {
    return fillDiscovered(configured.data)
  }
  return fillDiscovered({})
}

async function fillDiscovered(input: z.input<typeof CheckConfig>) {
  const discovered = await discoverScripts()
  const config = CheckConfig.parse(input)
  return {
    build: config.build ?? discovered.build,
    test: config.test ?? discovered.test,
    lint: config.lint ?? discovered.lint,
    verify_cmd: config.verify_cmd ?? [],
    timeout_ms: config.timeout_ms,
  }
}

async function discoverScripts() {
  const file = Bun.file(path.join(Instance.directory, "package.json"))
  const json = await file.json().catch(() => undefined) as { scripts?: Record<string, string> } | undefined
  const scripts = json?.scripts ?? {}
  const run = (name: string) => [`bun run ${name}`]
  return {
    build: scripts.build ? run("build") : [],
    test: scripts.test ? run("test") : [],
    lint: scripts.lint ? run("lint") : [],
  }
}

async function commandResult(command: string, timeout: number) {
  const shell = Shell.acceptable()
  const proc = spawn(command, {
    shell,
    cwd: Instance.directory,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })

  let output = ""
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
  })

  const timer = setTimeout(() => {
    void ShellUtil.killTree(proc, { exited: () => proc.exitCode !== null || proc.signalCode !== null })
  }, timeout)
  timer.unref()

  const code = await new Promise<number>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("exit", (value, signal) => {
      if (signal) {
        resolve(1)
        return
      }
      resolve(value ?? 1)
    })
  }).finally(() => {
    clearTimeout(timer)
  })

  return {
    code,
    output,
  }
}

function clip(input: string) {
  const value = input.trim()
  if (value.length <= MAX_OUTPUT) return value
  return value.slice(0, MAX_OUTPUT) + "\n...[truncated]"
}
