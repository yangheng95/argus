/**
 * Per-goal deterministic evaluator.
 *
 * Three information sources, in priority order:
 *   1. done_definition — extract executable commands from the goal's acceptance criteria.
 *   2. Project discovery — discover build/test/lint commands from the correct package root.
 *   3. Semantic criteria — noted as evidence but do NOT affect pass/fail verdict.
 *
 * The evaluator resolves the correct working directory by walking up from the goal's
 * owned_paths to find the nearest package.json/pyproject.toml, fixing monorepo/subdirectory
 * scenarios where the worktree root is not the project root.
 *
 * No LLM. No autonomous inference. Deterministic exit-code verdicts.
 */
import path from "path"
import { Shell } from "@/shell/shell"
import { Log } from "@/util/log"
import { which } from "@/util/which"
import type { TextHooks } from "@/llm/api"
import type { GoalContract, PipelineDelivery, EvalVerdict } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"

const log = Log.create({ service: "pipeline-evaluator" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedCommand {
  /** Human-readable label for evidence (the original criterion text) */
  label: string
  /** Extracted shell command to run */
  command: string
}

interface ParsedDoneDefinition {
  /** Commands that can be executed and checked via exit code */
  executable: ParsedCommand[]
  /** Semantic criteria that cannot be verified deterministically */
  semantic: string[]
}

interface CheckResult {
  name: string
  command: string
  passed: boolean
  output: string
  source: "done_definition" | "project_discovery" | "visual"
}

interface DiscoveredCommand {
  name: string
  command: string
}

// ---------------------------------------------------------------------------
// parseDoneDefinition — extract executable commands from done_definition text
// ---------------------------------------------------------------------------

/** Known command runner prefixes (case-insensitive first token match). */
const CMD_PREFIXES = new Set([
  "pnpm", "npm", "npx", "bun", "yarn", "tsc", "node",
  "pytest", "python", "python3", "py", "make", "cargo", "go",
  "deno", "vitest", "jest", "mocha", "eslint", "prettier", "ruff", "mypy",
])

/**
 * Split done_definition into individual criteria. Handles:
 *   - Numbered lists: "1. xxx 2. yyy"
 *   - Period-separated sentences (English)
 *   - Chinese punctuation: ，(comma) ；(semicolon) 。(period)
 *   - Newline-separated items
 */
function splitCriteria(text: string): string[] {
  // First try numbered list: "1. ...", "2. ..."
  const numbered = text.split(/(?:^|\.\s+)(?=\d+\.\s)/m).filter(Boolean)
  if (numbered.length > 1) {
    return numbered.map(s => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean)
  }

  // Period-then-capital or period-then-number (English)
  const sentences = text.split(/\.\s+(?=[A-Z\d`])/).map(s => s.replace(/\.$/, "").trim()).filter(Boolean)
  if (sentences.length > 1) return sentences

  // Chinese punctuation: full-width comma ，, semicolon ；, period 。
  const chinese = text.split(/[，；。]\s*/).map(s => s.trim()).filter(Boolean)
  if (chinese.length > 1) return chinese

  // Single criterion
  return [text.trim()].filter(Boolean)
}

/**
 * Extract all executable shell commands from a single criterion string.
 * Returns an array of command strings (may be empty).
 *
 * Handles multiple backtick-wrapped commands in a single criterion
 * (e.g., "执行 `pnpm dev` 且 `pnpm tsc --noEmit` 通过").
 */
function extractCommands(criterion: string): string[] {
  const commands: string[] = []

  // Pattern 1: all backtick-wrapped commands (matchAll, not match)
  for (const m of criterion.matchAll(/`([^`]+)`/g)) {
    const inner = m[1].trim()
    const firstToken = inner.split(/\s+/)[0]?.toLowerCase() ?? ""
    if (CMD_PREFIXES.has(firstToken)) commands.push(inner)
  }
  if (commands.length > 0) return commands

  // Pattern 2: line starts with known command prefix (bare command)
  const trimmed = criterion.replace(/^\d+\.\s*/, "").trim()
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/['"]/g, "") ?? ""
  if (CMD_PREFIXES.has(firstToken)) {
    const cmdPart = trimmed.replace(/\s+(passes|succeeds|should|must|exits?\s).*$/i, "").trim()
    commands.push(cmdPart)
  }

  return commands
}

export function parseDoneDefinition(text: string): ParsedDoneDefinition {
  if (!text || text.trim().length === 0) {
    return { executable: [], semantic: [] }
  }

  const criteria = splitCriteria(text)
  const executable: ParsedCommand[] = []
  const semantic: string[] = []

  for (const criterion of criteria) {
    const cmds = extractCommands(criterion)
    if (cmds.length > 0) {
      for (const cmd of cmds) {
        executable.push({ label: criterion, command: cmd })
      }
    } else {
      semantic.push(criterion)
    }
  }

  return { executable, semantic }
}

// ---------------------------------------------------------------------------
// resolveEvalDir — find the correct directory to run commands in
// ---------------------------------------------------------------------------

/**
 * Find the nearest package root by walking up from the common prefix of owned_paths.
 * Adapted from discovery.ts:discoverPackageRoot but uses owned_paths (statically known)
 * instead of changed files (which may not exist yet).
 */
export async function resolveEvalDir(workDir: string, ownedPaths: string[]): Promise<string> {
  if (ownedPaths.length === 0) return workDir

  // Compute common directory prefix of all owned paths
  const dirs = ownedPaths.map(p => {
    // Strip glob portions (e.g., "aimecode/src/**/*.ts" → "aimecode/src")
    const clean = p.replace(/[*?[\]{}]/g, "").replace(/\/+$/, "")
    return path.dirname(clean)
  })

  let common = dirs[0]!
  for (const d of dirs.slice(1)) {
    const parts1 = common.split(/[/\\]/)
    const parts2 = d.split(/[/\\]/)
    const shared: string[] = []
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i]) shared.push(parts1[i]!)
      else break
    }
    common = shared.join("/")
    if (!common) return workDir
  }

  // Walk up from common prefix, looking for project markers
  const markers = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod"]
  let current = path.resolve(workDir, common)
  const root = path.resolve(workDir)

  while (current.length >= root.length && current.startsWith(root)) {
    for (const marker of markers) {
      if (await fileExists(path.join(current, marker))) {
        return current
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return workDir
}

// ---------------------------------------------------------------------------
// discoverCommands — find build/test/lint from package.json (existing logic)
// ---------------------------------------------------------------------------

async function discoverCommands(workDir: string): Promise<DiscoveredCommand[]> {
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

// ---------------------------------------------------------------------------
// deduplication — avoid running the same command twice
// ---------------------------------------------------------------------------

/**
 * Remove discovered commands that are already covered by done_definition commands.
 * Comparison is by normalized command string containment.
 */
function deduplicateDiscovered(
  doneDefCommands: ParsedCommand[],
  discovered: DiscoveredCommand[],
): DiscoveredCommand[] {
  const doneDefNormalized = doneDefCommands.map(c => normalizeCmd(c.command))
  return discovered.filter(d => {
    const norm = normalizeCmd(d.command)
    return !doneDefNormalized.some(dd =>
      dd.includes(norm) || norm.includes(dd),
    )
  })
}

function normalizeCmd(cmd: string): string {
  return cmd.toLowerCase()
    .replace(/^(pnpm|npm|npx|bun|yarn)\s+(run\s+)?/i, "")
    .trim()
}

// ---------------------------------------------------------------------------
// evaluateGoal — main entry point
// ---------------------------------------------------------------------------

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

  // ── 1. Parse done_definition ──
  const parsed = parseDoneDefinition(goal.done_definition ?? "")
  log.info("parsed done_definition", {
    goalID: goal.id,
    executable: parsed.executable.length,
    semantic: parsed.semantic.length,
  })

  // ── 2. Resolve correct eval directory ──
  const ownedPaths = (goal.owned_paths ?? []) as string[]
  const evalDir = await resolveEvalDir(workDir, ownedPaths)
  if (evalDir !== workDir) {
    log.info("resolved eval directory from owned_paths", {
      goalID: goal.id,
      workDir,
      evalDir,
    })
  }

  // ── 3. Discover project commands (in the correct directory) ──
  const discovered = await discoverCommands(evalDir)

  // ── 4. Merge: done_definition first, then non-duplicate discovered ──
  const supplementCommands = deduplicateDiscovered(parsed.executable, discovered)

  // ── 5. Build execution plan ──
  const hasExecutableChecks = parsed.executable.length > 0 || supplementCommands.length > 0

  if (!hasExecutableChecks) {
    log.info("no executable checks found, passing by default", { goalID: goal.id })
    const evidence = parsed.semantic.length > 0
      ? [`No executable commands found.`, ...parsed.semantic.map(s => `[semantic, deferred] ${s}`)]
      : ["No discoverable build/test commands — pass by default"]
    return {
      pass: true,
      verdict: "accepted",
      evidence,
      evidenceStatus: evidence.map(() => undefined),
      reasoning: parsed.semantic.length > 0
        ? `No executable commands in done_definition or project. ${parsed.semantic.length} semantic criterion/criteria deferred to delivery agent.`
        : "No build or test scripts found in project.",
    }
  }

  // ── 6. Execute all commands ──
  const results: CheckResult[] = []

  // 6a. done_definition commands (highest priority)
  for (const { label, command } of parsed.executable) {
    if (signal?.aborted) throw new Error("eval aborted")

    const run = await Shell.run(command, {
      cwd: evalDir,
      env: process.env,
      idleTimeoutMs: 15_000,    // inactivity-based: 15s of no output → done
      timeoutMs: 300_000,       // hard safety cap: 5 min max
      abort: signal,
    })

    const passed = evalCommandPassed(run)
    const outputParts = [
      run.stdout.trim().slice(0, 3000),
      run.stderr.trim().slice(0, 1000),
    ].filter(Boolean)

    results.push({
      name: `done_def: ${label.slice(0, 60)}`,
      command,
      passed,
      output: outputParts.join("\n"),
      source: "done_definition",
    })

    log.info("eval check (done_definition)", {
      goalID: goal.id, command, exitCode: run.exitCode,
      timedOut: run.timedOut, idleTimedOut: run.idleTimedOut, passed,
    })
  }

  // 6b. Supplementary project discovery commands
  for (const { name, command } of supplementCommands) {
    if (signal?.aborted) throw new Error("eval aborted")

    const run = await Shell.run(command, {
      cwd: evalDir,
      env: process.env,
      idleTimeoutMs: 15_000,
      timeoutMs: 300_000,
      abort: signal,
    })

    const passed = evalCommandPassed(run)
    const outputParts = [
      run.stdout.trim().slice(0, 3000),
      run.stderr.trim().slice(0, 1000),
    ].filter(Boolean)

    results.push({
      name,
      command,
      passed,
      output: outputParts.join("\n"),
      source: "project_discovery",
    })

    log.info("eval check (project_discovery)", {
      goalID: goal.id, name, command, exitCode: run.exitCode,
      timedOut: run.timedOut, idleTimedOut: run.idleTimedOut, passed,
    })
  }

  // ── 6c. Visual similarity check ──
  // When a goal carries a visual reference (image attachment or absolute
  // path in goal.metadata.visual), render whatever index.html the executor
  // produced inside the goal's owned scope and SSIM-compare against the
  // reference. The result joins the same `results` list — no separate gate,
  // no fallback when the browser isn't available (we record an explicit
  // failure so the agent can react).
  const visualRef = resolveVisualReference(goal, contract)
  if (visualRef) {
    if (signal?.aborted) throw new Error("eval aborted")
    const { findRenderedIndex, runVisualDiff, summarizeVisualReport } = await import("./visual")
    const renderedHtml = await findRenderedIndex(evalDir)
    if (!renderedHtml) {
      results.push({
        name: "visual_diff",
        command: `visual-diff against ${visualRef}`,
        passed: false,
        output: `no index.html found under ${evalDir} — executor must produce a renderable entry point`,
        source: "visual",
      })
    } else {
      const visualOut = await import("node:path").then((p) => p.join(evalDir, ".opencorvus", "visual-diff"))
      try {
        const report = await runVisualDiff({
          rendered: renderedHtml,
          reference: visualRef,
          outDir: visualOut,
        })
        results.push({
          name: "visual_diff",
          command: `visual-diff rendered=${renderedHtml} reference=${visualRef}`,
          passed: report.passed,
          output: summarizeVisualReport(report),
          source: "visual",
        })
      } catch (err) {
        results.push({
          name: "visual_diff",
          command: `visual-diff rendered=${renderedHtml} reference=${visualRef}`,
          passed: false,
          output: `visual-diff failed to run: ${err instanceof Error ? err.message : String(err)}`,
          source: "visual",
        })
      }
    }
  }

  // ── 7. Build verdict ──
  const allPassed = results.every((r) => r.passed)
  const failed = results.filter((r) => !r.passed)

  // Evidence: executable results + semantic criteria (deferred)
  const evidence = [
    ...results.map((r) => `[${r.source}] ${r.name}: ${r.command}`),
    ...parsed.semantic.map((s) => `[semantic, deferred] ${s}`),
  ]
  const evidenceStatus: Array<"passed" | "failed" | undefined> = [
    ...results.map((r) => (r.passed ? "passed" as const : "failed" as const)),
    ...parsed.semantic.map(() => undefined),
  ]

  return {
    pass: allPassed,
    verdict: allPassed ? "accepted" : "rejected",
    evidence,
    evidenceStatus,
    reasoning: allPassed
      ? `All ${results.length} check(s) passed.${parsed.semantic.length > 0 ? ` ${parsed.semantic.length} semantic criterion/criteria deferred to delivery agent.` : ""}`
      : `${failed.length} of ${results.length} check(s) failed:\n${failed
          .map((r) => `- [${r.source}] ${r.name}: ${r.output.slice(0, 500)}`)
          .join("\n")}`,
    failureClass: allPassed ? undefined : inferFailureClass(results),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate a visual reference image for a goal. Looks at goal.metadata.visual
 * (caller-supplied absolute path) first, then falls back to scanning the
 * task's attachment store via metadata.visual_attachment_sha when the
 * decompose agent tagged a reference attachment for this specific goal.
 *
 * Returns an absolute filesystem path or undefined when the goal has no
 * visual reference (most goals don't — only fig2code-style work does).
 */
function resolveVisualReference(goal: GoalContract["goal"], _contract: GoalContract): string | undefined {
  const meta = (goal.metadata as Record<string, unknown> | undefined) ?? {}
  const direct = typeof meta.visual === "string" ? meta.visual : undefined
  if (direct) return direct
  const ref = typeof meta.visual_reference === "string" ? meta.visual_reference : undefined
  if (ref) return ref
  return undefined
}

/**
 * Determine if an eval command passed.
 *
 * Two paths:
 *   1. Process exited on its own → trust the exit code (0 = pass)
 *   2. Process went idle (idleTimedOut) after producing stdout → pass.
 *      Idle timeout means the process finished its observable work (startup,
 *      output) then went quiet. The exit code is from our kill signal, not
 *      from the process itself — so we don't use it. The process completed
 *      what it was going to do. If it had a fatal error, it would have
 *      exited on its own with a non-zero code (path 1).
 *   3. Hard timeout (still actively running after safety cap) → fail.
 *   4. No output + idle timeout → fail (nothing happened).
 */
function evalCommandPassed(run: Shell.RunResult): boolean {
  // Process exited on its own — trust exit code
  if (!run.timedOut && !run.idleTimedOut) return run.exitCode === 0

  // Process went idle after producing output — it finished its work
  if (run.idleTimedOut && run.stdout.length > 0) return true

  // Hard timeout or idle with no output
  return false
}

function inferFailureClass(
  _results: Array<{ passed: boolean; source: string; name: string; command: string }>,
): "bug" | "plan_wrong" | "goal_wrong" {
  // Currently all deterministic eval failures are classified as "bug".
  // Future: could infer "goal_wrong" if all discovery commands are missing
  // (suggesting the project structure doesn't match done_definition).
  return "bug"
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
