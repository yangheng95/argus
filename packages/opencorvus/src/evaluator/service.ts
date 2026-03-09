import { Instance } from "@/project/instance"
import { findSpecSnapshot, findSpecItems } from "@/orchestrator/store"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { Shell } from "@/shell/shell"
import { Shell as ShellUtil } from "@/shell/shell"
import { Snapshot } from "@/snapshot"
import { Filesystem } from "@/util/filesystem"
import { spawn } from "child_process"
import fs from "fs/promises"
import { generateObject, generateText } from "ai"
import path from "path"
import puppeteer from "puppeteer-core"
import z from "zod"
import { CheckConfig, EvaluationCheck, NamedCheckConfig, NamedCheckFamily } from "@/orchestrator/model"
import { EvaluatorAgent, type EvaluatorAnalysisType, type GoalInfo, type CheckResult, type DeliveryInfo } from "./agent"
import { Log } from "@/util/log"
import { which } from "@/util/which"

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT = 12000

const JudgeResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  strengths: z.array(z.string()).optional(),
  concerns: z.array(z.string()).optional(),
})

const SpecCheckResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  criteria: z.array(z.object({
    criterion: z.string(),
    status: z.enum(["passed", "failed", "inconclusive"]),
    evidence: z.string(),
  })),
})

const ReviewResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
})

type EvaluatorCommand = {
  command: string
  cwd?: string
}

type CommandGroup = {
  name: string
  label?: string
  family?: z.infer<typeof NamedCheckFamily>
  commands: EvaluatorCommand[]
}

type EvaluationTask = {
  taskID?: string
  activeSpecVersionID?: string
  request?: string
  metadata?: Record<string, unknown>
}

type EvaluationDelivery = {
  summary: string
  diffs?: Snapshot.FileDiff[]
  changedFiles?: string[]
}

type EvaluationArtifact = {
  kind: "log" | "report" | "image"
  label: string
  payload: Record<string, unknown>
}

type EvaluationOutcome = {
  outcome: "passed" | "failed" | "skipped"
  summary: string
  checks: z.infer<typeof EvaluationCheck>[]
  artifacts: EvaluationArtifact[]
}

type EvaluationOutput = {
  status: "passed" | "failed" | "inconclusive"
  verdict: "accepted" | "rejected" | "inconclusive"
  summary: string
  checks: z.infer<typeof EvaluationCheck>[]
  artifacts: EvaluationArtifact[]
}

type PluginCheck = {
  name: string
  mode: "soft" | "strict"
  run: (ctx: {
    request?: string
    delivery: EvaluationDelivery
  }) => Promise<{
    status: "passed" | "failed" | "skipped"
    evidence: string
    artifacts?: Array<{ kind: string; label: string; payload: Record<string, unknown> }>
  }>
}

type CheckDef = {
  name: string
  label: string
  family?: string
}

type OptionalCheckDef = CheckDef & {
  run: (config: z.infer<typeof CheckConfig>, task: EvaluationTask, delivery: EvaluationDelivery) => Promise<EvaluationOutcome>
}

const CORE_CHECK_DEFS = [
  { name: "build", label: "Build", family: "build" },
  { name: "test", label: "Unit Tests", family: "test" },
  { name: "lint", label: "Lint", family: "lint" },
  { name: "verify_cmd", label: "Verify Command", family: "verify_cmd" },
] as const satisfies CheckDef[]

const OPTIONAL_CHECK_DEFS = [
  { name: "startup", label: "Startup", family: "runtime", run: (config) => startupResult(config.startup) },
  { name: "artifact", label: "Artifacts", family: "artifact", run: (config, _task, delivery) => artifactResult(config.artifact, delivery) },
  { name: "visual", label: "Visual Check", family: "runtime", run: (config) => visualResult(config.visual) },
  { name: "puppeteer", label: "Puppeteer", family: "runtime", run: (config) => puppeteerResult(config.puppeteer) },
  { name: "ui_review", label: "UI Review", family: "review", run: (config, task, delivery) => uiReviewResult(config.ui_review, task.request, delivery) },
  { name: "code_quality", label: "Code Quality", family: "review", run: (config, task, delivery) => codeQualityResult(config.code_quality, task.request, delivery) },
  { name: "code_review", label: "Code Review", family: "review", run: (config, task, delivery) => codeReviewResult(config.code_review, task.request, delivery) },
  { name: "dead_code_review", label: "Dead Code Review", family: "review", run: (config, task, delivery) => deadCodeReviewResult(config.dead_code_review, task.request, delivery) },
  { name: "judge", label: "LLM Judge", family: "acceptance", run: (config, task, delivery) => judgeResult(config.judge, task.request, delivery) },
  { name: "spec_check", label: "Spec Check", family: "acceptance", run: (config, task, delivery) => specCheckResult(config.spec_check, task.request, task.activeSpecVersionID, delivery) },
] as const satisfies OptionalCheckDef[]

const BUILTIN_CHECK_DEFS = [...CORE_CHECK_DEFS, ...OPTIONAL_CHECK_DEFS]

const BUILTIN_CHECK_INDEX = new Map<string, { label: string; family?: string; order: number }>(
  BUILTIN_CHECK_DEFS.map((item, index) => [
    item.name,
    {
      label: item.label,
      family: item.family,
      order: index,
    },
  ]),
)

export namespace EvaluatorService {
  export async function resolveChecks(metadata?: Record<string, unknown>, changedFiles?: unknown) {
    const config = await resolveConfig(metadata)
    const discovered = await discoverChecks(changedFiles)
    return resolvedChecks(config, discovered)
  }

  export async function evaluate(
    task: EvaluationTask,
    delivery: EvaluationDelivery,
  ) {
    const rawConfig = await resolveConfig(task.metadata)
    const config = { ...rawConfig, ...(!rawConfig.spec_check ? autoSpecCheck(task) : {}) } as typeof rawConfig
    const discovered = await discoverChecks(task.metadata?.delivery_changed_files)
    const commands = commandGroups(config, discovered)
    const core = await commandChecks(commands, config.timeout_ms ?? DEFAULT_TIMEOUT_MS, delivery)
    if (core.checks.some((item) => item.status === "failed")) {
      return publishResult(task, finalizeEvaluation(commands, core.checks, core.artifacts, []))
    }
    const optional = await optionalChecks(config, task, delivery)
    const checks = [...core.checks, ...optional.flatMap((item) => Array.isArray(item.checks) ? item.checks : [])]
    const artifacts = [...core.artifacts, ...optional.flatMap((item) => Array.isArray(item.artifacts) ? item.artifacts : [])]
    return publishResult(task, finalizeEvaluation(commands, checks, artifacts, optional))
  }

  /**
   * analyzeDelivery — calls the independent-context EvaluatorAgent to deeply
   * analyze check results, investigate failures, assess each goal individually,
   * and produce structured failure classification + replan guidance.
   *
   * This is separate from evaluate() so automated checks remain fast and
   * the agent analysis is an optional enrichment step.
   */
  export async function analyzeDelivery(input: {
    task: { title: string; request: string; sessionID?: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
  }): Promise<EvaluatorAnalysisType> {
    return EvaluatorAgent.analyze(input)
  }
}

const evaluatorLog = Log.create({ service: "evaluator" })

function taskRefs(task: EvaluationTask) {
  return {
    taskID: task.metadata?.taskID as string | undefined,
    runID: task.metadata?.runID as string | undefined,
    request: task.request,
  }
}

async function publishResult(task: EvaluationTask, output: EvaluationOutput) {
  await Plugin.trigger("evaluation.result", taskRefs(task), output).catch(() => undefined)
  return output
}

async function commandChecks(
  commands: CommandGroup[],
  timeout: number,
  delivery: EvaluationDelivery,
) {
  const checks: z.infer<typeof EvaluationCheck>[] = []
  const artifacts: EvaluationArtifact[] = []

  for (const group of commands) {
    for (const [index, command] of group.commands.entries()) {
      const name = group.commands.length === 1 ? group.name : `${group.name}#${index + 1}`
      const result = await commandResult(command, timeout)
      artifacts.push({
        kind: "log",
        label: `evaluation:${name}`,
        payload: {
          command: result.command,
          cwd: result.cwd,
          code: result.code,
          output: clip(result.output),
        },
      })
      checks.push({
        ...checkResult({
          name,
          label: group.label,
          family: group.family,
          status: result.code === 0 ? "passed" : "failed",
          evidence: clip(result.output) || `${command} ${result.code === 0 ? "passed" : "failed"}`,
        }),
      })
    }
  }

  if (commands.length === 0) {
    checks.push(checkResult({
      name: "evaluation_config",
      status: "skipped",
      evidence: delivery.summary,
    }))
  }

  return { checks, artifacts }
}

async function optionalChecks(
  config: z.infer<typeof CheckConfig>,
  task: EvaluationTask,
  delivery: EvaluationDelivery,
) {
  const builtin = await Promise.all(OPTIONAL_CHECK_DEFS.map((item) => item.run(config, task, delivery)))
  const plugins = await pluginChecks(config, task, delivery)
  return [...builtin, ...plugins].map((item) => ({
    ...item,
    checks: item.checks.map(checkResult),
  }))
}

async function pluginChecks(
  config: z.infer<typeof CheckConfig>,
  task: EvaluationTask,
  delivery: EvaluationDelivery,
) {
  const output = { checks: [] as PluginCheck[] }
  await Plugin.trigger("evaluation.checks", {
    ...taskRefs(task),
    config: (config.custom as Record<string, unknown>) ?? {},
  }, output).catch(() => undefined)
  return Promise.all(output.checks.map((item) => pluginCheck(item, task, delivery)))
}

async function pluginCheck(
  input: PluginCheck,
  task: EvaluationTask,
  delivery: EvaluationDelivery,
): Promise<EvaluationOutcome> {
  const result = await input.run({ request: task.request, delivery }).catch(() => pluginFallback(input.name))
  const artifacts = [
    {
      kind: "report" as const,
      label: `evaluation:${input.name}`,
      payload: { mode: input.mode, status: result.status },
    },
    ...normalizeArtifacts(result.artifacts),
  ]

  if (result.status === "passed") {
    return {
      outcome: "passed",
      summary: `${input.name} passed.`,
      checks: [checkResult({
        name: input.name,
        status: "passed",
        evidence: result.evidence,
      })],
      artifacts,
    }
  }

  const output = softOrStrict({
    mode: input.mode,
    name: input.name,
    summary: `${input.name} ${result.status}.`,
    evidence: result.evidence,
    payload: { mode: input.mode, status: result.status },
  })

  return {
    ...output,
    artifacts,
  }
}

function normalizeArtifacts(input?: Array<{ kind: string; label: string; payload: Record<string, unknown> }>) {
  return (input ?? []).map((item) => ({
    kind: item.kind as EvaluationArtifact["kind"],
    label: item.label,
    payload: item.payload,
  }))
}

function checkBase(name: string) {
  return name.replace(/#\d+$/, "")
}

function checkResult(input: z.infer<typeof EvaluationCheck>) {
  const meta = BUILTIN_CHECK_INDEX.get(checkBase(input.name))
  return {
    ...input,
    label: input.label ?? meta?.label,
    family: input.family ?? meta?.family,
  }
}

function orderChecks(input: z.infer<typeof EvaluationCheck>[]) {
  const rank = (name: string) => BUILTIN_CHECK_INDEX.get(checkBase(name))?.order ?? BUILTIN_CHECK_INDEX.size + 100
  const suffix = (name: string) => Number(name.match(/#(\d+)$/)?.[1] ?? 0)
  return [...input].sort((a, b) =>
    rank(a.name) - rank(b.name) ||
    suffix(a.name) - suffix(b.name) ||
    a.name.localeCompare(b.name),
  )
}

function finalizeEvaluation(
  commands: CommandGroup[],
  checks: z.infer<typeof EvaluationCheck>[],
  artifacts: EvaluationArtifact[],
  optional: EvaluationOutcome[],
): EvaluationOutput {
  const ordered = orderChecks(checks)
  const failed = ordered.filter((item) => item.status === "failed")
  if (failed.length > 0 || optional.some((item) => item.outcome === "failed")) {
    const summary = [
      failed.length > 0 ? `Failed: ${failed.map((item) => `${item.name} (${item.status})`).join(", ")}` : "",
      ordered.some((item) => item.status === "passed")
        ? `Passed: ${ordered.filter((item) => item.status === "passed").map((item) => item.name).join(", ")}`
        : "",
    ].filter(Boolean).join(". ")
    return {
      status: "failed",
      verdict: "rejected",
      summary: summary ? `${summary}.` : "Evaluator checks failed.",
      checks: ordered,
      artifacts,
    }
  }

  const optionalChecks = ordered.filter((item) => item.name !== "evaluation_config")
  if (commands.length === 0 && optionalChecks.length === 0 && ordered.every((item) => item.status === "skipped")) {
    return {
      status: "inconclusive",
      verdict: "inconclusive",
      summary: "No blocking evaluator checks ran.",
      checks: ordered,
      artifacts,
    }
  }

  return {
    status: "passed",
    verdict: "accepted",
    summary: optional.some((item) => item.outcome === "skipped")
      ? commands.length === 0
        ? "Optional evaluator checks ran in soft mode without blocking the flow."
        : "Core evaluator checks passed; optional checks were skipped."
      : "All evaluator checks passed.",
    checks: ordered,
    artifacts,
  }
}

function pluginFallback(name: string) {
  return {
    status: "skipped" as const,
    evidence: `Plugin check ${name} threw an error.`,
    artifacts: undefined as Array<{ kind: string; label: string; payload: Record<string, unknown> }> | undefined,
  }
}

async function resolveConfig(metadata?: Record<string, unknown>) {
  const configured = CheckConfig.safeParse(metadata?.checks)
  return CheckConfig.parse(configured.success ? configured.data : {})
}

function autoSpecCheck(task?: EvaluationTask): Record<string, unknown> {
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

function commandSpecs(configured?: string[] | false, discovered: EvaluatorCommand[] = []) {
  if (configured === false) return []
  if (configured && configured.length > 0) {
    return configured.map((command) => ({ command }))
  }
  return discovered
}

function commandGroups(
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
    if (current) {
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

function resolvedChecks(
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

async function discoverChecks(changedFiles?: unknown) {
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

function checkLabel(key: string) {
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

function inferFamily(key: string): z.infer<typeof NamedCheckFamily> {
  const lower = key.toLowerCase()
  if (lower.includes("test") || lower.includes("pytest")) return "test"
  if (lower.includes("lint") || lower.includes("type") || lower.includes("ruff") || lower.includes("mypy")) return "lint"
  if (lower.includes("verify")) return "verify_cmd"
  return "build"
}

async function startupResult(config: z.infer<typeof CheckConfig>["startup"]) {
  if (!config) return emptyOptional()
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
    return {
      outcome: "passed" as const,
      summary: "Startup acceptance passed.",
      checks: [
        {
          name: "startup",
          status: "passed" as const,
          evidence: readiness.evidence,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:startup",
          payload: {
            command: config.command,
            ready_url: config.ready_url,
            ready_text: config.ready_text,
            code,
            started_ms: Date.now() - started,
            output: clip(output),
          },
        },
      ],
    }
  }

  return softOrStrict({
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

async function commandResult(input: string | EvaluatorCommand, timeout: number) {
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

function clip(input: string, maxLength?: number) {
  const value = input.trim()
  const limit = maxLength ?? MAX_OUTPUT
  if (value.length <= limit) return value
  return value.slice(0, limit) + "\n...[truncated]"
}

function quote(input: string) {
  return `"${input.replaceAll('"', '\\"')}"`
}

async function artifactResult(
  config: z.infer<typeof CheckConfig>["artifact"],
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config) return emptyOptional()
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

async function visualResult(config: z.infer<typeof CheckConfig>["visual"]) {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const page = await webPage(config.url, config.timeout_ms ?? 10_000)
  if (!page) {
    if (mode === "strict") {
      return {
        outcome: "failed" as const,
        summary: `Web visual check failed to load ${config.url}.`,
        checks: [
          {
            name: "visual",
            status: "failed" as const,
            evidence: `Could not load ${config.url}`,
          },
        ],
        artifacts: [
          {
            kind: "report" as const,
            label: "evaluation:visual",
            payload: {
              target: config.url,
              mode,
              loaded: false,
            },
          },
        ],
      }
    }
    return {
      outcome: "skipped" as const,
      summary: "Web visual check skipped because the page could not be loaded.",
      checks: [
        {
          name: "visual",
          status: "skipped" as const,
          evidence: `Could not load ${config.url}`,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            mode,
            loaded: false,
          },
        },
      ],
    }
  }

  const unmet = [
    config.require_title && !page.title.toLowerCase().includes(config.require_title.toLowerCase())
      ? `missing title: ${config.require_title}`
      : undefined,
    ...(config.require_text ?? []).map((item) =>
      page.content.toLowerCase().includes(item.toLowerCase()) ? undefined : `missing text: ${item}`,
    ),
  ].filter((item): item is string => Boolean(item))

  if (unmet.length === 0) {
    return {
      outcome: "passed" as const,
      summary: "Web visual checks passed.",
      checks: [
        {
          name: "visual",
          status: "passed" as const,
          evidence: page.title || config.url,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            title: page.title,
          },
        },
      ],
    }
  }

  if (mode === "strict") {
    return {
      outcome: "failed" as const,
      summary: `Web visual checks failed: ${unmet.join(", ")}.`,
      checks: [
        {
          name: "visual",
          status: "failed" as const,
          evidence: unmet.join(", "),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:visual",
          payload: {
            target: config.url,
            title: page.title,
            unmet,
          },
        },
      ],
    }
  }

  return {
    outcome: "skipped" as const,
    summary: "Web visual checks skipped in soft mode.",
    checks: [
      {
        name: "visual",
        status: "skipped" as const,
        evidence: unmet.join(", "),
      },
    ],
    artifacts: [
      {
        kind: "report" as const,
        label: "evaluation:visual",
        payload: {
          target: config.url,
          title: page.title,
          unmet,
          mode,
        },
      },
    ],
  }
}

async function puppeteerResult(config: z.infer<typeof CheckConfig>["puppeteer"]) {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const executable = await resolvePuppeteerExecutable(config)
  if (!executable) {
    return softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer acceptance could not find a browser executable.",
      evidence: "No Chrome/Chromium/Edge executable was detected.",
      payload: {
        target: config.url,
        browser: config.browser,
        available: false,
        mode,
      },
    })
  }

  const browser = await puppeteer.launch({
    executablePath: executable,
    headless: true,
    defaultViewport: {
      width: config.viewport?.width ?? 1440,
      height: config.viewport?.height ?? 900,
    },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  }).catch(() => undefined)

  if (!browser) {
    return softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer acceptance failed to launch the browser.",
      evidence: `Failed to launch ${executable}.`,
      payload: {
        target: config.url,
        executable,
        available: false,
        mode,
      },
    })
  }

  try {
    const page = await browser.newPage()
    await page.goto(config.url, {
      waitUntil: "domcontentloaded",
      timeout: config.timeout_ms ?? 20_000,
    })
    if (config.wait_for_selector) {
      await page.waitForSelector(config.wait_for_selector, { timeout: config.timeout_ms ?? 20_000 })
    }
    if (config.wait_for_text) {
      await page.waitForFunction(
        (text) => document.body?.innerText?.includes(text),
        { timeout: config.timeout_ms ?? 20_000 },
        config.wait_for_text,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500))

    const title = await page.title().catch(() => "")
    const content = await page.content().catch(() => "")
    const screenshot = await page.screenshot({
      type: "png",
      encoding: "base64",
      fullPage: config.full_page ?? true,
    })

    const unmet = [
      config.require_title && !title.toLowerCase().includes(config.require_title.toLowerCase())
        ? `missing title: ${config.require_title}`
        : undefined,
      ...(config.require_text ?? []).map((item) =>
        content.toLowerCase().includes(item.toLowerCase()) ? undefined : `missing text: ${item}`,
      ),
    ].filter((item): item is string => Boolean(item))

    const artifacts = [
      {
        kind: "image" as const,
        label: "evaluation:puppeteer:screenshot",
        payload: {
          target: config.url,
          title,
          browser: config.browser ?? "auto",
          executable,
          data_url: `data:image/png;base64,${screenshot}`,
        },
      },
      {
        kind: "report" as const,
        label: "evaluation:puppeteer",
        payload: {
          target: config.url,
          title,
          browser: config.browser ?? "auto",
          executable,
          wait_for_selector: config.wait_for_selector,
          wait_for_text: config.wait_for_text,
          unmet,
          mode,
        },
      },
    ]

    if (unmet.length === 0) {
      return {
        outcome: "passed" as const,
        summary: "Puppeteer browser acceptance passed.",
        checks: [
          {
            name: "puppeteer",
            status: "passed" as const,
            evidence: title || config.url,
          },
        ],
        artifacts,
      }
    }

    if (mode === "strict") {
      return {
        outcome: "failed" as const,
        summary: `Puppeteer browser acceptance failed: ${unmet.join(", ")}.`,
        checks: [
          {
            name: "puppeteer",
            status: "failed" as const,
            evidence: unmet.join(", "),
          },
        ],
        artifacts,
      }
    }

    return {
      outcome: "skipped" as const,
      summary: "Puppeteer browser acceptance skipped in soft mode.",
      checks: [
        {
          name: "puppeteer",
          status: "skipped" as const,
          evidence: unmet.join(", "),
        },
      ],
      artifacts,
    }
  } catch (error) {
    return softOrStrict({
      mode,
      name: "puppeteer",
      summary: "Puppeteer browser acceptance failed to capture the page.",
      evidence: error instanceof Error ? error.message : String(error),
      payload: {
        target: config.url,
        executable,
        browser: config.browser ?? "auto",
        mode,
      },
    })
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function uiReviewResult(
  config: z.infer<typeof CheckConfig>["ui_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config) return emptyOptional()
  const mode = config.mode ?? "soft"
  const page = config.url ? await webPage(config.url, config.timeout_ms ?? 10_000) : undefined
  if (config.url && !page) {
    return softOrStrict({
      mode,
      name: "ui_review",
      summary: "UI/UX review could not load the target page.",
      evidence: `Could not load ${config.url}.`,
      payload: {
        target: config.url,
        available: false,
        mode,
      },
    })
  }

  const result = await reviewResult({
    name: "ui_review",
    mode,
    prompt: [
      "You are reviewing a web UI/UX delivery.",
      "Focus on information hierarchy, clarity, layout, interaction affordances, feedback, and accessibility.",
      "Be specific and concise. Reject only when there is a meaningful usability or clarity problem.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      config.focus?.length ? `Focus areas: ${config.focus.join(", ")}` : "",
      page ? `Page title: ${page.title || "(none)"}` : "",
      page ? `Page excerpt:\n${clip(stripHtml(page.content))}` : "",
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  })

  return reviewOutcome("ui_review", mode, result, {
    target: config.url,
    focus: config.focus,
  })
}

async function codeQualityResult(
  config: z.infer<typeof CheckConfig>["code_quality"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const result = await reviewResult({
    name: "code_quality",
    mode,
    prompt: [
      "You are reviewing code quality for a software change.",
      "Focus on correctness risk, maintainability, scope discipline, test coverage, and avoidable complexity.",
      "Be specific and concise. Reject only when there is a material code quality risk.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
      `Diff review:\n${diffDigest(delivery.diffs ?? [], config.max_diffs ?? 4)}`,
    ].join("\n\n"),
  })

  return reviewOutcome("code_quality", mode, result, {
    max_diffs: config.max_diffs ?? 4,
  })
}

async function codeReviewResult(
  config: z.infer<typeof CheckConfig>["code_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const result = await reviewResult({
    name: "code_review",
    mode,
    prompt: [
      "You are reviewing a code change like a professional code reviewer.",
      "Focus on bugs, regressions, unsafe assumptions, missing validation, and missing tests.",
      "Treat maintainability as secondary to correctness. Reject only when there is a real review finding.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
      `Review diff:\n${diffDigest(delivery.diffs ?? [], config.max_diffs ?? 4)}`,
    ].join("\n\n"),
  })

  return reviewOutcome("code_review", mode, result, {
    max_diffs: config.max_diffs ?? 4,
  })
}

async function deadCodeReviewResult(
  config: z.infer<typeof CheckConfig>["dead_code_review"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const result = await reviewResult({
    name: "dead_code_review",
    mode,
    prompt: [
      "You are reviewing the change for dead code and obsolete implementation leftovers.",
      "Focus on unused exports, unreachable branches, stale helpers, duplicate compatibility code, dead flags, and code paths that should have been removed.",
      "Reject only when dead or obsolete code meaningfully remains after the change.",
      config.prompt ? `Additional instruction: ${config.prompt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    request,
    delivery,
    context: [
      `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
      `Dead code review diff:\n${diffDigest(delivery.diffs ?? [], config.max_diffs ?? 4)}`,
    ].join("\n\n"),
  })

  return reviewOutcome("dead_code_review", mode, result, {
    max_diffs: config.max_diffs ?? 4,
  })
}

async function reviewResult(input: {
  name: string
  mode: "soft" | "strict"
  prompt: string
  request: string | undefined
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] }
  context: string
}) {
  const model = await reviewModel()
  if (!model) {
    return {
      ok: false as const,
      summary: `${input.name} unavailable because no review model is configured.`,
      evidence: "No review model available.",
      payload: {
        available: false,
        mode: input.mode,
      },
    }
  }

  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) {
    return {
      ok: false as const,
      summary: `${input.name} unavailable because the review model could not be loaded.`,
      evidence: "Could not load review model.",
      payload: {
        available: false,
        mode: input.mode,
      },
    }
  }

  const result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    messages: [
      {
        role: "system",
        content: input.prompt,
      },
      {
        role: "user",
        content: [
          input.request ? `Task request:\n${input.request}` : "",
          `Delivery summary:\n${input.delivery.summary}`,
          input.context,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: ReviewResult,
  }).catch(() => undefined)

  if (!result) {
    return {
      ok: false as const,
      summary: `${input.name} failed to execute.`,
      evidence: "Review model call failed.",
      payload: {
        available: true,
        mode: input.mode,
      },
    }
  }

  return {
    ok: true as const,
    object: result.object,
  }
}

function reviewOutcome(
  name: "ui_review" | "code_quality" | "code_review" | "dead_code_review",
  mode: "soft" | "strict",
  result:
    | { ok: false; summary: string; evidence: string; payload: Record<string, unknown> }
    | { ok: true; object: z.infer<typeof ReviewResult> },
  extra: Record<string, unknown>,
) {
  if (!result.ok) {
    return {
      outcome: "failed" as const,
      summary: result.summary,
      checks: [
        {
          name,
          status: "failed" as const,
          evidence: result.evidence,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: `evaluation:${name}`,
          payload: {
            ...extra,
            ...result.payload,
          },
        },
      ],
    }
  }

  return result.object.verdict === "accepted"
    ? {
        outcome: "passed" as const,
        summary: `${name} accepted the delivery.`,
        checks: [
          {
            name,
            status: "passed" as const,
            evidence: clip(result.object.rationale),
          },
        ],
        artifacts: [
          {
            kind: "report" as const,
            label: `evaluation:${name}`,
            payload: {
              ...extra,
              ...result.object,
            },
          },
        ],
      }
    : softOrStrict({
        mode,
        name,
        summary: result.object.verdict === "rejected" ? `${name} rejected the delivery.` : `${name} was inconclusive.`,
        evidence: clip(result.object.rationale),
        payload: {
          ...extra,
          ...result.object,
        },
      })
}

async function judgeResult(
  config: z.infer<typeof CheckConfig>["judge"],
  request: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "soft"
  const model = await judgeModel()
  if (!model) {
    return {
      outcome: "failed" as const,
      summary: "Judge check unavailable because no model is configured.",
      checks: [
        {
          name: "judge",
          status: "failed" as const,
          evidence: "No evaluator judge model available.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: {
            mode,
            available: false,
          },
        },
      ],
    }
  }

  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) {
    return {
      outcome: "failed" as const,
      summary: "Judge check unavailable because the language model could not be loaded.",
      checks: [
        {
          name: "judge",
          status: "failed" as const,
          evidence: "Could not load evaluator judge model.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: {
            mode,
            available: false,
          },
        },
      ],
    }
  }

  const result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    messages: [
      {
        role: "system",
        content:
          "Judge whether the implementation appears complete based on the request and concrete delivery summary. Be pragmatic. If evidence is weak, return inconclusive.",
      },
      {
        role: "user",
        content: [
          config.prompt ? `Judge instruction: ${config.prompt}` : "",
          request ? `Task request:\n${request}` : "",
          `Delivery summary:\n${delivery.summary}`,
          `Changed files: ${(delivery.changedFiles ?? delivery.diffs?.map((item) => item.file) ?? []).join(", ") || "(none)"}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: JudgeResult,
  }).catch((err) => {
    evaluatorLog.warn("judge model call failed", { error: String(err), model: `${model.providerID}/${model.id}` })
    return undefined
  })

  if (!result) {
    return {
      outcome: "failed" as const,
      summary: "Judge check failed to execute.",
      checks: [
        {
          name: "judge",
          status: "failed" as const,
          evidence: "Judge model call failed.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: {
            mode,
            available: true,
          },
        },
      ],
    }
  }

  if (result.object.verdict === "accepted") {
    return {
      outcome: "passed" as const,
      summary: "Judge check accepted the delivery.",
      checks: [
        {
          name: "judge",
          status: "passed" as const,
          evidence: clip(result.object.rationale),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:judge",
          payload: result.object,
        },
      ],
    }
  }

  return softOrStrict({
    mode,
    name: "judge",
    summary:
      result.object.verdict === "rejected"
        ? "Judge check rejected the delivery."
        : "Judge check was inconclusive.",
    evidence: clip(result.object.rationale),
    payload: result.object,
  })
}

async function specCheckResult(
  config: z.infer<typeof CheckConfig>["spec_check"],
  request: string | undefined,
  activeSpecVersionID: string | undefined,
  delivery: { summary: string; diffs?: Snapshot.FileDiff[]; changedFiles?: string[] },
) {
  if (!config?.enabled) return emptyOptional()
  const mode = config.mode ?? "strict"

  // Read spec content and required spec items from DB (source of truth)
  let specContent = ""
  let specItemsSection = ""
  if (activeSpecVersionID) {
    try {
      const snapshot = findSpecSnapshot(activeSpecVersionID)
      if (snapshot?.content) specContent = snapshot.content
    } catch {}
    try {
      const items = findSpecItems(activeSpecVersionID)
      if (items.length > 0) {
        specItemsSection = "\n\n## Required Spec Items (each MUST be verified)\n\n" +
          items.map((item, i) =>
            `${i + 1}. [${item.priority}] ${item.title}\n   ${item.description}`,
          ).join("\n")
      }
    } catch {}
  }
  if (!specContent.trim()) {
    return softOrStrict({
      mode,
      name: "spec_check",
      summary: "No spec found in database.",
      evidence: "Cannot verify delivery against spec: no spec exists.",
      payload: { available: false },
    })
  }

  const model = await judgeModel()
  if (!model) {
    return {
      outcome: "failed" as const,
      summary: "Spec check unavailable because no model is configured.",
      checks: [
        {
          name: "spec_check",
          status: "failed" as const,
          evidence: "No evaluator model available for spec check.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: { mode, available: false },
        },
      ],
    }
  }

  const language = await Provider.getLanguage(model).catch(() => undefined)
  if (!language) {
    return {
      outcome: "failed" as const,
      summary: "Spec check unavailable because the language model could not be loaded.",
      checks: [
        {
          name: "spec_check",
          status: "failed" as const,
          evidence: "Could not load evaluator model for spec check.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: { mode, available: false, specID: activeSpecVersionID },
        },
      ],
    }
  }

  // Build file diffs section for LLM verification.
  // Use a generous per-file limit so single-file projects (like a game in index.html)
  // don't get falsely marked as truncated.
  const fileCount = delivery.diffs?.length ?? 0
  const perFileLimit = fileCount <= 1 ? 60000 : fileCount <= 3 ? 20000 : 8000
  const diffsSection = delivery.diffs?.length
    ? delivery.diffs.map((d) => {
        const content = d.status === "deleted"
          ? `[DELETED] ${d.file}`
          : `--- ${d.file} ---\n${clip(d.after, perFileLimit)}`
        return content
      }).join("\n\n")
    : "(no diffs available)"

  const specCheckMessages = [
    {
      role: "system" as const,
      content:
        "Evaluate whether the delivery satisfies ALL acceptance criteria in the specification. " +
        "You are provided with the actual file contents after changes. Use them to verify each criterion. " +
        "For each criterion in the spec, determine pass/fail with evidence from the code. " +
        "Pay special attention to the 'Required Spec Items' section — each item marked [blocking] " +
        "MUST be individually verified as passed for acceptance. " +
        "ALL criteria must pass for acceptance. Be thorough and precise. " +
        "Respond with a JSON object: {\"verdict\":\"accepted\"|\"rejected\"|\"inconclusive\",\"rationale\":\"...\",\"criteria\":[{\"criterion\":\"...\",\"status\":\"passed\"|\"failed\"|\"inconclusive\",\"evidence\":\"...\"}]}",
    },
    {
      role: "user" as const,
      content: [
        config.prompt ? `Additional instruction: ${config.prompt}` : "",
        `Specification (source of truth):\n${specContent}${specItemsSection}`,
        request ? `Task request:\n${request}` : "",
        `Delivery summary:\n${delivery.summary}`,
        `File contents after changes:\n${diffsSection}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ]

  // Try generateObject first, fallback to generateText + JSON parse
  let result: { object: z.infer<typeof SpecCheckResult> } | undefined
  result = await generateObject({
    model: language,
    temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
    messages: specCheckMessages,
    schema: SpecCheckResult,
  }).catch(() => undefined)

  if (!result) {
    // Fallback: use generateText and parse JSON from response
    const textResult = await generateText({
      model: language,
      temperature: model.providerID.startsWith("moonshotai") ? 1 : 0,
      messages: specCheckMessages,
    }).catch((err) => {
      evaluatorLog.warn("spec_check text fallback failed", { error: String(err), model: `${model.providerID}/${model.id}` })
      return undefined
    })
    if (textResult?.text) {
      try {
        const jsonMatch = textResult.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = SpecCheckResult.parse(JSON.parse(jsonMatch[0]))
          result = { object: parsed }
        }
      } catch {
        evaluatorLog.warn("spec_check JSON parse failed", { text: textResult.text.substring(0, 200) })
      }
    }
  }

  if (!result) {
    return {
      outcome: "failed" as const,
      summary: "Spec check failed to execute.",
      checks: [
        {
          name: "spec_check",
          status: "failed" as const,
          evidence: "Spec check model call failed.",
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: { mode, available: true, specID: activeSpecVersionID },
        },
      ],
    }
  }

  const allPassed = result.object.criteria.every((c) => c.status === "passed")
  if (allPassed && result.object.verdict === "accepted") {
    return {
      outcome: "passed" as const,
      summary: "Spec check: all criteria passed.",
      checks: [
        {
          name: "spec_check",
          status: "passed" as const,
          evidence: clip(result.object.rationale),
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: "evaluation:spec_check",
          payload: {
            specID: activeSpecVersionID,
            ...result.object,
          },
        },
      ],
    }
  }

  const failedCriteria = result.object.criteria.filter((c) => c.status !== "passed")
  return softOrStrict({
    mode,
    name: "spec_check",
    summary: `Spec check: ${failedCriteria.length} criteria not passed.`,
    evidence: clip(
      failedCriteria.map((c) => `[${c.status}] ${c.criterion}: ${c.evidence}`).join("\n"),
    ),
    payload: {
      specID: activeSpecVersionID,
      ...result.object,
    },
  })
}

async function webPage(url: string, timeoutMs: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const response = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "user-agent": "OpenCorvus evaluator",
    },
  }).catch(() => undefined)
  clearTimeout(timer)
  if (!response?.ok) return
  const content = await response.text().catch(() => "")
  return {
    content,
    title: titleOf(content),
  }
}

function titleOf(html: string) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is)
  if (!match?.[1]) return ""
  return match[1].replace(/\s+/g, " ").trim()
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function resolvePuppeteerExecutable(config: z.infer<typeof CheckConfig>["puppeteer"]) {
  const explicit = [config?.executable_path, process.env.OPENCORVUS_PUPPETEER_EXECUTABLE_PATH]
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => item.trim())
  for (const item of explicit) {
    if (await Filesystem.exists(item)) return item
  }

  const names =
    process.platform === "win32"
      ? []
      : config?.browser === "edge"
        ? ["microsoft-edge", "msedge"]
        : config?.browser === "chromium"
          ? ["chromium", "chromium-browser"]
          : ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "microsoft-edge", "msedge"]

  for (const name of names) {
    const found = which(name)
    if (found) return found
  }

  const absolute =
    process.platform === "win32"
      ? windowsBrowserCandidates(config?.browser)
      : process.platform === "darwin"
        ? macBrowserCandidates(config?.browser)
        : []
  for (const item of absolute) {
    if (await Filesystem.exists(item)) return item
  }

  return undefined
}

function windowsBrowserCandidates(browser?: "chrome" | "edge" | "chromium") {
  const chrome = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ]
  const edge = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ]
  const chromium = [
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe",
  ]
  if (browser === "chrome") return chrome
  if (browser === "edge") return edge
  if (browser === "chromium") return chromium
  return [...chrome, ...edge, ...chromium]
}

function macBrowserCandidates(browser?: "chrome" | "edge" | "chromium") {
  const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  const edge = ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
  const chromium = ["/Applications/Chromium.app/Contents/MacOS/Chromium"]
  if (browser === "chrome") return chrome
  if (browser === "edge") return edge
  if (browser === "chromium") return chromium
  return [...chrome, ...edge, ...chromium]
}

function diffDigest(diffs: Snapshot.FileDiff[], limit: number) {
  if (diffs.length === 0) return "(no diffs)"
  return diffs
    .slice(0, limit)
    .map((item) =>
      [
        `File: ${item.file}`,
        `Status: ${item.status ?? "modified"} (+${item.additions}/-${item.deletions})`,
        `After excerpt:\n${clip(item.after)}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n")
}

async function reviewModel() {
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) return
  return (
    (await Provider.getSmallModel(def.providerID).catch(() => undefined)) ??
    (await Provider.getModel(def.providerID, def.modelID).catch(() => undefined))
  )
}

async function judgeModel() {
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) return
  return Provider.getModel(def.providerID, def.modelID).catch(() => undefined)
}

function emptyOptional() {
  return {
    outcome: "passed" as const,
    summary: "",
    checks: [],
    artifacts: [] as Array<{ kind: "log" | "report" | "image"; label: string; payload: Record<string, unknown> }>,
  }
}

function softOrStrict(input: {
  mode: "soft" | "strict"
  name: string
  summary: string
  evidence: string
  payload: Record<string, unknown>
}) {
  if (input.mode === "strict") {
    return {
      outcome: "failed" as const,
      summary: input.summary,
      checks: [
        {
          name: input.name,
          status: "failed" as const,
          evidence: input.evidence,
        },
      ],
      artifacts: [
        {
          kind: "report" as const,
          label: `evaluation:${input.name}`,
          payload: input.payload,
        },
      ],
    }
  }
  return {
    outcome: "skipped" as const,
    summary: input.summary,
    checks: [
      {
        name: input.name,
        status: "skipped" as const,
        evidence: input.evidence,
      },
    ],
    artifacts: [
      {
        kind: "report" as const,
        label: `evaluation:${input.name}`,
        payload: input.payload,
      },
    ],
  }
}
