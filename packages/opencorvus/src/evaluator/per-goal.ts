/**
 * Per-goal deterministic evaluator — runs build/test commands and checks exit codes.
 *
 * No LLM. No autonomous inference. No false positives from new projects.
 *
 * Strategy:
 * 1. Discover build/test commands from package.json, pyproject.toml, etc.
 * 2. Run each discovered command via Shell.run()
 * 3. pass  — all commands exit 0, OR no commands found (bare/new project)
 * 4. fail  — any command exits non-zero
 *
 * Rationale: an LLM-based judge on a brand-new project with no tests will
 * fabricate its own quality criteria and produce false positives/negatives.
 * Deterministic exit codes are objective and repeatable.
 */
import path from "path"
import { Shell } from "@/shell/shell"
import { Log } from "@/util/log"
import { which } from "@/util/which"
import type { TextHooks } from "@/llm/api"
import type { GoalContract, PipelineDelivery, EvalVerdict } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"

const log = Log.create({ service: "pipeline-evaluator" })

/**
 * Evaluate a goal's delivery deterministically.
 *
 * Signature preserved for backward compatibility with GoalPool.evalGoal().
 * The `stream`, `decisionLog`, and `sessionID` params are accepted but unused —
 * the evaluator is now a pure shell runner with no LLM.
 */
export async function evaluateGoal(input: {
  contract: GoalContract
  delivery: PipelineDelivery
  decisionLog?: DecisionLog
  workDir?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
}): Promise<EvalVerdict> {
  const { contract, signal } = input
  const { goal } = contract

  if (signal?.aborted) throw new Error("eval aborted")

  const workDir = input.workDir ?? (await import("@/project/instance")).Instance.directory

  const commands = await discoverCommands(workDir)

  if (commands.length === 0) {
    log.info("no build/test commands found, passing by default", { goalID: goal.id })
    return {
      pass: true,
      verdict: "accepted",
      evidence: ["No discoverable build/test commands — pass by default"],
      evidenceStatus: [undefined],
      reasoning: "No build or test scripts found in project.",
    }
  }

  const results: CheckResult[] = []

  for (const { name, command } of commands) {
    if (signal?.aborted) throw new Error("eval aborted")

    const run = await Shell.run(command, {
      cwd: workDir,
      env: process.env,
      timeoutMs: 120_000,
      abort: signal,
    })

    const passed = run.exitCode === 0 && !run.timedOut
    const outputParts = [
      run.stdout.trim().slice(0, 3000),
      run.stderr.trim().slice(0, 1000),
    ].filter(Boolean)
    const output = outputParts.join("\n")

    results.push({ name, command, passed, output })

    log.info("deterministic eval check", {
      goalID: goal.id,
      name,
      command,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      passed,
    })
  }

  const allPassed = results.every((r) => r.passed)
  const failed = results.filter((r) => !r.passed)

  return {
    pass: allPassed,
    verdict: allPassed ? "accepted" : "rejected",
    evidence: results.map((r) => `${r.name}: ${r.command}`),
    evidenceStatus: results.map((r) => (r.passed ? "passed" : "failed")),
    reasoning: allPassed
      ? `All ${results.length} check(s) passed with exit code 0.`
      : `${failed.length} of ${results.length} check(s) failed:\n${failed
          .map((r) => `- ${r.name}: ${r.output.slice(0, 500)}`)
          .join("\n")}`,
    failureClass: allPassed ? undefined : "bug",
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string
  command: string
  passed: boolean
  output: string
}

interface DiscoveredCommand {
  name: string
  command: string
}

// ---------------------------------------------------------------------------
// Command discovery — reads project config files, no LLM
// ---------------------------------------------------------------------------

async function discoverCommands(workDir: string): Promise<DiscoveredCommand[]> {
  // Node / Bun: package.json scripts take priority
  const pkg = await readJson<{ scripts?: Record<string, string> }>(
    path.join(workDir, "package.json"),
  )
  if (pkg?.scripts) {
    const commands: DiscoveredCommand[] = []
    const s = pkg.scripts
    if (s.build) commands.push({ name: "build", command: "bun run build" })
    if (s.typecheck) commands.push({ name: "typecheck", command: "bun run typecheck" })
    if (s.test) commands.push({ name: "test", command: "bun run test" })
    if (s.lint) commands.push({ name: "lint", command: "bun run lint" })
    if (commands.length > 0) return commands
  }

  // Python: detect markers, run compile + pytest
  return discoverPythonCommands(workDir)
}

async function discoverPythonCommands(workDir: string): Promise<DiscoveredCommand[]> {
  const markers = await Promise.all([
    fileExists(path.join(workDir, "pyproject.toml")),
    fileExists(path.join(workDir, "setup.py")),
    fileExists(path.join(workDir, "setup.cfg")),
    fileExists(path.join(workDir, "requirements.txt")),
    fileExists(path.join(workDir, "pytest.ini")),
    fileExists(path.join(workDir, "tests")),
  ])

  if (!markers.some(Boolean)) return []

  const commands: DiscoveredCommand[] = []
  const python = findPython()
  if (python) {
    commands.push({ name: "py_compile", command: `${python} -m compileall .` })
  }

  const pytest = findPyTool("pytest")
  if (pytest && (markers[4] || markers[5])) {
    commands.push({ name: "pytest", command: `${pytest} -q` })
  }

  return commands
}

function findPython(): string | undefined {
  return ["python3", "python", "py"].find((c) => which(c))
}

function findPyTool(name: string): string | undefined {
  if (which(name)) return name
  const python = findPython()
  if (python) return `${python} -m ${name}`
  return undefined
}

async function fileExists(filepath: string): Promise<boolean> {
  return Bun.file(filepath).exists()
}

async function readJson<T>(filepath: string): Promise<T | undefined> {
  return Bun.file(filepath).json().catch(() => undefined) as Promise<T | undefined>
}
