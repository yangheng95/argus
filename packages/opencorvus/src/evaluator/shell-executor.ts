/**
 * Shell command execution, process discovery, startup checks, and test classification.
 */

import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { Shell as ShellUtil } from "@/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { CheckConfig, NamedCheckConfig, NamedCheckFamily } from "@/orchestrator/model"
import { CORE_CHECK_DEFS } from "./check-defs"
import * as Outcome from "./outcome"
import { webPage } from "./browser-checker"
import type { EvaluatorCommand, CommandGroup, EvaluationDelivery } from "./types"
import { clip, quote } from "./types"

export { clip, quote }

async function exists(filepath: string) {
  return Bun.file(filepath).exists()
}

async function hasPythonTopLevel(cwd: string) {
  const entries = await fs.readdir(cwd).catch(() => [])
  return entries.some((item) => item.endsWith(".py"))
}

function pythonLauncher() {
  return ["python", "python3", "py"].find((item) => which(item))
}

function pythonToolCommand(module: string, fallback: string) {
  const python = pythonLauncher()
  if (python) return `${python} -m ${module}`
  if (which(fallback)) return fallback
}

export function checkLabel(key: string) {
  const known = {
    build: "Build",
    test: "Unit Tests",
    lint: "Lint",
    verify_cmd: "Verify Command",
    py_compile: "Python Compile",
    pytest: "Pytest",
    typecheck: "Type Check",
  } as Record<string, string>
  if (known[key]) return known[key]
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((item) => item[0]?.toUpperCase() + item.slice(1))
    .join(" ")
}

export function inferFamily(key: string): z.infer<typeof NamedCheckFamily> {
  const lower = key.toLowerCase()
  if (lower.includes("test") || lower.includes("pytest")) return "test"
  if (lower.includes("lint") || lower.includes("type") || lower.includes("ruff") || lower.includes("mypy")) return "lint"
  if (lower.includes("verify")) return "verify_cmd"
  return "build"
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export async function resolveConfig(metadata?: Record<string, unknown>) {
  const configured = CheckConfig.safeParse(metadata?.checks)
  return CheckConfig.parse(configured.success ? configured.data : {})
}

export function autoSpecCheck(task?: { activeSpecVersionID?: string }): Record<string, unknown> {
  // Per design doc: spec_check defaults to enabled whenever a spec exists.
  // Priority: DB spec snapshot > legacy filesystem spec files.
  if (task?.activeSpecVersionID) {
    return { spec_check: { enabled: true, mode: "strict" } }
  }
  try {
    const specsDir = path.join(Instance.worktree, ".opencorvus", "specs")
    const specFiles = require("fs").readdirSync(specsDir) as string[]
    if (specFiles.some((f: string) => f.endsWith(".md"))) {
      return { spec_check: { enabled: true, mode: "strict" } }
    }
  } catch {}
  return {}
}

// ---------------------------------------------------------------------------
// Command group building
// ---------------------------------------------------------------------------

function commandSpecs(configured?: string[] | false, discovered: EvaluatorCommand[] = []) {
  if (configured === false) return []
  if (configured && configured.length > 0) {
    return configured.map((command) => ({ command }))
  }
  return discovered
}

export function commandGroups(
  config: z.infer<typeof CheckConfig>,
  discovered: Awaited<ReturnType<typeof discoverChecks>>,
) {
  return [
    ...CORE_CHECK_DEFS.map((item) =>
      group(
        item.name,
        config[item.name],
        item.name === "build"
          ? discovered.build
          : item.name === "test"
            ? discovered.test
            : item.name === "lint"
              ? discovered.lint
              : [],
        item.label,
        item.family,
      ),
    ),
    ...namedGroups(config.named, discovered.named),
  ].flatMap((item) => item ?? [])
}

function group(
  name: "build" | "test" | "lint" | "verify_cmd",
  configured: string[] | false | undefined,
  discovered: EvaluatorCommand[],
  label: string,
  family: z.infer<typeof NamedCheckFamily>,
) {
  const commands = commandSpecs(configured, discovered)
  if (commands.length === 0) return
  return {
    name,
    label,
    family,
    commands,
  } satisfies CommandGroup
}

function namedGroups(
  configured: Record<string, z.infer<typeof NamedCheckConfig>> | undefined,
  discovered: Record<string, CommandGroup>,
) {
  const keys = new Set([
    ...Object.keys(discovered),
    ...Object.keys(configured ?? {}),
  ])
  return [...keys].flatMap((key) => {
    const current = configured?.[key]
    if (current?.enabled === false) return []
    if (current && current.commands.length > 0) {
      return [{
        name: key,
        label: current.label ?? discovered[key]?.label ?? checkLabel(key),
        family: current.family ?? discovered[key]?.family ?? inferFamily(key),
        commands: current.commands.map((command) => ({
          command,
          cwd: current.cwd,
        })),
      } satisfies CommandGroup]
    }
    const fallback = discovered[key]
    if (!fallback) return []
    return [fallback]
  })
}

export function resolvedChecks(
  config: z.infer<typeof CheckConfig>,
  discovered: Awaited<ReturnType<typeof discoverChecks>>,
) {
  const next = {
    ...(config.build !== undefined ? { build: config.build } : discovered.build.length > 0 ? { build: discovered.build.map((item) => item.command) } : {}),
    ...(config.test !== undefined ? { test: config.test } : discovered.test.length > 0 ? { test: discovered.test.map((item) => item.command) } : {}),
    ...(config.lint !== undefined ? { lint: config.lint } : discovered.lint.length > 0 ? { lint: discovered.lint.map((item) => item.command) } : {}),
    ...(config.verify_cmd !== undefined ? { verify_cmd: config.verify_cmd } : {}),
    ...(config.startup ? { startup: config.startup } : {}),
    ...(config.artifact ? { artifact: config.artifact } : {}),
    ...(config.visual ? { visual: config.visual } : {}),
    ...(config.puppeteer ? { puppeteer: config.puppeteer } : {}),
    ...(config.ui_review ? { ui_review: config.ui_review } : {}),
    ...(config.code_quality ? { code_quality: config.code_quality } : {}),
    ...(config.code_review ? { code_review: config.code_review } : {}),
    ...(config.dead_code_review ? { dead_code_review: config.dead_code_review } : {}),
    ...(config.judge ? { judge: config.judge } : {}),
    ...(config.spec_check ? { spec_check: config.spec_check } : autoSpecCheck()),
    ...(config.custom ? { custom: config.custom } : {}),
    ...(config.timeout_ms ? { timeout_ms: config.timeout_ms } : {}),
  } as Record<string, unknown>
  const named = {
    ...Object.fromEntries(
      Object.entries(discovered.named).map(([key, value]) => [
        key,
        {
          label: value.label ?? checkLabel(key),
          family: value.family,
          commands: value.commands.map((item) => item.command),
          enabled: true,
        },
      ]),
    ),
    ...(config.named ?? {}),
  }
  if (Object.keys(named).length > 0) next.named = named
  return CheckConfig.parse(next)
}

// ---------------------------------------------------------------------------
// Check discovery
// ---------------------------------------------------------------------------

export async function discoverChecks(changedFiles?: unknown) {
  const cwd = await discoverPackageRoot(changedFiles)
  const file = Bun.file(path.join(cwd, "package.json"))
  const json = await file.json().catch(() => undefined) as { scripts?: Record<string, string> } | undefined
  const scripts = json?.scripts ?? {}
  const run = (name: string): EvaluatorCommand[] => [{ command: `bun run ${name}`, cwd }]
  const files = Array.isArray(changedFiles)
    ? changedFiles
        .filter((item): item is string => typeof item === "string" && /\.(spec|test)\.[cm]?[jt]sx?$/.test(item))
        .map((item) => path.resolve(Instance.directory, item))
        .filter((item) => Filesystem.contains(cwd, item))
        .map((item) => path.relative(cwd, item).replaceAll("\\", "/"))
    : []
  const tests = await classifyTests(files, cwd)
  const named = {
    ...(scripts.typecheck ? {
      typecheck: {
        name: "typecheck",
        label: "Type Check",
        family: "lint" as const,
        commands: run("typecheck"),
      },
    } : {}),
    ...(scripts.pycompile ? {
      py_compile: {
        name: "py_compile",
        label: "Python Compile",
        family: "build" as const,
        commands: run("pycompile"),
      },
    } : {}),
    ...(scripts.pytest ? {
      pytest: {
        name: "pytest",
        label: "Pytest",
        family: "test" as const,
        commands: run("pytest"),
      },
    } : {}),
    ...(await discoverPythonChecks(cwd, files)),
  }
  return {
    build: scripts.build ? run("build") : [],
    test: tests.bun.length > 0
      ? [{ command: `bun test ${tests.bun.map(quote).join(" ")}`, cwd }]
      : scripts.test ? run("test") : [],
    lint: scripts.lint ? run("lint") : [],
    named,
  }
}

async function discoverPythonChecks(cwd: string, files: string[]) {
  const markers = await Promise.all([
    exists(path.join(cwd, "pyproject.toml")),
    exists(path.join(cwd, "setup.py")),
    exists(path.join(cwd, "setup.cfg")),
    exists(path.join(cwd, "requirements.txt")),
    exists(path.join(cwd, "tests")),
    exists(path.join(cwd, "pytest.ini")),
    exists(path.join(cwd, "mypy.ini")),
    exists(path.join(cwd, ".mypy.ini")),
    exists(path.join(cwd, "ruff.toml")),
    exists(path.join(cwd, ".ruff.toml")),
  ])
  const pyproject = await Bun.file(path.join(cwd, "pyproject.toml")).text().catch(() => "")
  const hasPythonFiles = files.some((item) => item.endsWith(".py")) || (await hasPythonTopLevel(cwd))
  const isPythonProject = hasPythonFiles || markers.some(Boolean)
  if (!isPythonProject) return {}

  const python = pythonLauncher()
  const pytest = pythonToolCommand("pytest", "pytest")
  const mypy = pythonToolCommand("mypy", "mypy")
  const ruff = pythonToolCommand("ruff", "ruff")
  const checks = {} as Record<string, CommandGroup>

  if (python) {
    checks.py_compile = {
      name: "py_compile",
      label: "Python Compile",
      family: "build",
      commands: [{ command: `${python} -m compileall .`, cwd }],
    }
  }
  if (pytest && (markers[4] || markers[5] || files.some((item) => /(^|\/)test_.*\.py$|(^|\/).+_test\.py$/.test(item)))) {
    checks.pytest = {
      name: "pytest",
      label: "Pytest",
      family: "test",
      commands: [{ command: `${pytest} -q`, cwd }],
    }
  }
  if (mypy && (markers[6] || markers[7] || pyproject.includes("[tool.mypy]"))) {
    checks.typecheck = {
      name: "typecheck",
      label: "Type Check",
      family: "lint",
      commands: [{ command: `${mypy} .`, cwd }],
    }
  }
  if (ruff && (markers[8] || markers[9] || pyproject.includes("[tool.ruff]"))) {
    checks.ruff = {
      name: "ruff",
      label: "Ruff",
      family: "lint",
      commands: [{ command: `${ruff} check .`, cwd }],
    }
  }
  return checks
}

async function classifyTests(files: string[], cwd: string) {
  const items = await Promise.all(
    files.map(async (file) => ({
      file,
      text: await Bun.file(path.join(cwd, file)).text().catch(() => ""),
    })),
  )
  return {
    bun: items
      .filter((item) => /["']bun:test["']/.test(item.text))
      .map((item) => item.file),
  }
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

export async function commandResult(input: string | EvaluatorCommand, timeout: number) {
  const command = typeof input === "string" ? input : input.command
  const cwd = typeof input === "string" ? Instance.directory : input.cwd ?? Instance.directory
  const shell = Shell.acceptable()
  const proc = spawn(command, {
    shell,
    cwd,
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
    command,
    cwd,
  }
}

async function discoverPackageRoot(changedFiles?: unknown) {
  const root = Instance.directory
  const candidates = new Map<string, number>()
  const items = Array.isArray(changedFiles)
    ? changedFiles.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []

  for (const file of items) {
    let current = path.dirname(path.resolve(root, file))
    while (Filesystem.contains(root, current)) {
      if (await Filesystem.exists(path.join(current, "package.json"))) {
        candidates.set(current, (candidates.get(current) ?? 0) + 1)
        break
      }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  if (candidates.size === 0) return root
  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0]
}

// ---------------------------------------------------------------------------
// Startup check
// ---------------------------------------------------------------------------

export async function startupResult(config: z.infer<typeof CheckConfig>["startup"]) {
  if (!config) return Outcome.empty()
  const mode = config.mode ?? "soft"
  const timeout = config.timeout_ms ?? 20_000
  const warmup = config.warmup_ms ?? 1_500
  const shell = Shell.acceptable()
  const proc = spawn(config.command, {
    shell,
    cwd: Instance.directory,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })

  let output = ""
  let code: number | undefined
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.once("exit", (value, signal) => {
    code = signal ? 1 : value ?? 1
  })

  const started = Date.now()
  const readiness = await waitForStartup({
    proc,
    readyURL: config.ready_url,
    readyText: config.ready_text,
    timeout,
    warmup,
    output: () => output,
    requireExitZero: config.require_exit_zero ?? false,
  })

  if (proc.exitCode === null && proc.signalCode === null) {
    await ShellUtil.killTree(proc, { exited: () => proc.exitCode !== null || proc.signalCode !== null })
  }

  if (readiness.ok) {
    return Outcome.passed("startup", "Startup acceptance passed.", readiness.evidence, {
      command: config.command,
      ready_url: config.ready_url,
      ready_text: config.ready_text,
      code,
      started_ms: Date.now() - started,
      output: clip(output),
    })
  }

  return Outcome.softOrStrict({
    mode,
    name: "startup",
    summary: "Startup acceptance failed.",
    evidence: readiness.evidence,
    payload: {
      command: config.command,
      ready_url: config.ready_url,
      ready_text: config.ready_text,
      code,
      started_ms: Date.now() - started,
      output: clip(output),
    },
  })
}

async function waitForStartup(input: {
  proc: ReturnType<typeof spawn>
  readyURL?: string
  readyText?: string
  timeout: number
  warmup: number
  output: () => string
  requireExitZero: boolean
}) {
  const started = Date.now()
  while (Date.now() - started < input.timeout) {
    if (typeof input.proc.exitCode === "number" || input.proc.signalCode !== null) {
      const code = input.proc.exitCode ?? 1
      if (!input.readyURL && !input.readyText && code === 0) {
        return { ok: true, evidence: "Process exited successfully." }
      }
      if (input.requireExitZero && code === 0 && input.readyText && input.output().includes(input.readyText)) {
        return { ok: true, evidence: `Process output matched "${input.readyText}".` }
      }
      return { ok: false, evidence: `Process exited before becoming ready (code ${code}).` }
    }

    if (input.readyURL) {
      const page = await webPage(input.readyURL, 1_500)
      if (page) {
        if (!input.readyText || page.content.includes(input.readyText)) {
          return {
            ok: true,
            evidence: input.readyText
              ? `${input.readyURL} responded and matched "${input.readyText}".`
              : `${input.readyURL} responded successfully.`,
          }
        }
      }
    } else if (input.readyText && input.output().includes(input.readyText)) {
      return { ok: true, evidence: `Process output matched "${input.readyText}".` }
    } else if (!input.readyText && Date.now() - started >= input.warmup) {
      return { ok: true, evidence: `Process stayed alive for ${input.warmup} ms.` }
    }

    await Bun.sleep(300)
  }

  return { ok: false, evidence: `Timed out after ${input.timeout} ms.` }
}

// ---------------------------------------------------------------------------
// Artifact check
// ---------------------------------------------------------------------------

export async function artifactResult(
  config: z.infer<typeof CheckConfig>["artifact"],
  delivery: { summary: string; diffs?: import("@/snapshot").Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config) return Outcome.empty()
  const changedFiles = delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []
  const diffs = delivery.diffs ?? []
  const mode = config.mode ?? "soft"
  const unmet = [
    config.require_summary && !delivery.summary.trim() ? "missing summary" : undefined,
    config.require_changed_files && changedFiles.length === 0 ? "no changed files" : undefined,
    config.require_diff && diffs.length === 0 ? "no diff output" : undefined,
    typeof config.min_changed_files === "number" && changedFiles.length < config.min_changed_files
      ? `changed files ${changedFiles.length}/${config.min_changed_files}`
      : undefined,
  ].filter((item): item is string => Boolean(item))

  if (unmet.length === 0) {
    return {
      outcome: "passed" as const,
      summary: "Artifact checks passed.",
      checks: [
        {
          name: "artifact",
          status: "passed" as const,
          evidence: `changed_files=${changedFiles.length}, diffs=${diffs.length}`,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:artifact",
          payload: {
            changed_files: changedFiles,
            diff_count: diffs.length,
          },
        },
      ],
    }
  }

  if (mode === "strict") {
    return {
      outcome: "failed" as const,
      summary: `Artifact checks failed: ${unmet.join(", ")}.`,
      checks: [
        {
          name: "artifact",
          status: "failed" as const,
          evidence: unmet.join(", "),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:artifact",
          payload: {
            unmet,
            changed_files: changedFiles,
            diff_count: diffs.length,
          },
        },
      ],
    }
  }

  return {
    outcome: "skipped" as const,
    summary: "Artifact checks skipped in soft mode.",
    checks: [
      {
        name: "artifact",
        status: "skipped" as const,
        evidence: unmet.join(", "),
      },
    ],
    artifacts: [
      {
        kind: "report" as const,
        label: "evaluation:artifact",
        payload: {
          unmet,
          changed_files: changedFiles,
          diff_count: diffs.length,
          mode,
        },
      },
    ],
  }
}
