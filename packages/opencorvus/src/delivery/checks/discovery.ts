import { inferFamily } from "@/check/policy"
import { Instance } from "@/project/instance"
import { CheckConfig, NamedCheckConfig, NamedCheckFamily } from "@/engine"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import type { EvaluatorCommand, CommandGroup, EvaluationTask } from "./types"

export async function resolveConfig(metadata?: Record<string, unknown>) {
  const configured = CheckConfig.safeParse(metadata?.checks)
  return CheckConfig.parse(configured.success ? configured.data : {})
}

export function autoSpecCheck(task?: EvaluationTask): Record<string, unknown> {
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

/** Auto-enable judge check — always active at standard+ tier. */
export function autoJudge(): Record<string, unknown> {
  return { judge: { enabled: true, mode: "strict" } }
}

/** Auto-enable code review — always active at standard+ tier. */
export function autoCodeReview(): Record<string, unknown> {
  return { code_review: { enabled: true, mode: "strict" } }
}

/** Auto-enable artifact check — always active at standard+ tier. */
export function autoArtifact(): Record<string, unknown> {
  return { artifact: { require_changed_files: true, require_diff: true, mode: "strict" } }
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
    ...(config.artifact ? { artifact: config.artifact } : autoArtifact()),
    ...(config.visual ? { visual: config.visual } : {}),
    ...(config.puppeteer ? { puppeteer: config.puppeteer } : {}),
    ...(config.ui_review ? { ui_review: config.ui_review } : {}),
    ...(config.code_quality ? { code_quality: config.code_quality } : {}),
    ...(config.code_review ? { code_review: config.code_review } : {}),
    ...(config.dead_code_review ? { dead_code_review: config.dead_code_review } : {}),
    ...(config.judge ? { judge: config.judge } : autoJudge()),
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

export function commandGroups(
  config: z.infer<typeof CheckConfig>,
  discovered: Awaited<ReturnType<typeof discoverChecks>>,
) {
  return [
    ...([
      { name: "build", label: "Build", family: "build" },
      { name: "test", label: "Unit Tests", family: "test" },
      { name: "lint", label: "Lint", family: "lint" },
      { name: "verify_cmd", label: "Verify Command", family: "verify_cmd" },
    ] as const).map((item) =>
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

function commandSpecs(configured?: string[] | false, discovered: EvaluatorCommand[] = []) {
  if (configured === false) return []
  if (configured && configured.length > 0) {
    return configured.map((command) => ({ command }))
  }
  return discovered
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

function quote(input: string) {
  return `"${input.replaceAll('"', '\\"')}"`
}
