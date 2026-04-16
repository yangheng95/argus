/**
 * Per-goal evaluator — runs the typed `acceptance_specs` attached to a goal.
 *
 * Pipeline:
 *   1. Translate AcceptanceSpec[] → heuristic commands + rubric checks.
 *   2. Resolve the correct working directory (nearest project root inside
 *      owned_paths) and discover supplementary build/test commands.
 *   3. Execute on_goal heuristics via Shell; deferred (on_delivery) ones are
 *      reported as evidence but skipped here.
 *   4. Execute on_goal rubric scorers via llm-judge-runner.
 *   5. Aggregate verdict by severity: any failing strict scorer rejects the
 *      goal; soft failures annotate the verdict with concerns.
 *
 * No free-form text parsing. No fallback. Specs are the single source of truth.
 */
import path from "path"
import { Shell } from "@/shell/shell"
import { Log } from "@/util/log"
import { which } from "@/util/which"
import type { TextHooks } from "@/llm/api"
import type { GoalContract, PipelineDelivery, EvalVerdict, EvalCheckResult } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import { translateSpecs, type TranslatedHeuristic, type TranslatedRubric } from "@/acceptance/translator"
import { runRubric } from "@/delivery/checks/llm-judge-runner"

const log = Log.create({ service: "pipeline-evaluator" })

interface DiscoveredCommand {
  name: string
  command: string
}

// Local alias — EvalCheckResult lives in pipeline/types so consumers don't
// need to depend on this evaluator file just for the shape.
type CheckResult = EvalCheckResult

// ---------------------------------------------------------------------------
// resolveEvalDir — find the nearest project root inside the goal's owned_paths
// ---------------------------------------------------------------------------

export async function resolveEvalDir(workDir: string, ownedPaths: string[]): Promise<string> {
  if (ownedPaths.length === 0) return workDir

  const dirs = ownedPaths.map((p) => {
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

  const markers = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod"]
  let current = path.resolve(workDir, common)
  const root = path.resolve(workDir)

  while (current.length >= root.length && current.startsWith(root)) {
    for (const marker of markers) {
      if (await fileExists(path.join(current, marker))) return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return workDir
}

// ---------------------------------------------------------------------------
// Project discovery — supplementary build/test/lint commands
// ---------------------------------------------------------------------------

async function discoverCommands(workDir: string): Promise<DiscoveredCommand[]> {
  const pkg = await readJson<{ scripts?: Record<string, string> }>(path.join(workDir, "package.json"))
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
  if (python) commands.push({ name: "py_compile", command: `${python} -m compileall .` })

  const pytest = findPyTool("pytest")
  if (pytest && (markers[4] || markers[5])) {
    commands.push({ name: "pytest", command: `${pytest} -q` })
  }
  return commands
}

function deduplicateDiscovered(
  specCommands: TranslatedHeuristic[],
  discovered: DiscoveredCommand[],
): DiscoveredCommand[] {
  const specNormalized = specCommands.map((c) => normalizeCmd(c.command))
  return discovered.filter((d) => {
    const norm = normalizeCmd(d.command)
    return !specNormalized.some((sc) => sc.includes(norm) || norm.includes(sc))
  })
}

function normalizeCmd(cmd: string): string {
  return cmd
    .toLowerCase()
    .replace(/^(pnpm|npm|npx|bun|yarn)\s+(run\s+)?/i, "")
    .trim()
}

// ---------------------------------------------------------------------------
// evaluateGoal — main entry
// ---------------------------------------------------------------------------

export type EvaluatorTier = "core" | "standard" | "full"

/** Map from tier → which discovered commands evaluator runs. Spec-declared
 *  scorers (heuristic + rubric) ALWAYS run regardless of tier — tier only
 *  controls auto-discovered fallback commands. Extended checks listed in
 *  evaluator.md (ui_review/code_quality/code_review/dead_code_review/startup)
 *  belong to delivery agent's "deferred_checks" surface, not evaluator. */
function tierAllowsDiscovered(name: string, tier: EvaluatorTier): boolean {
  if (tier === "core") {
    return name === "build" || name === "test" || name === "py_compile" || name === "pytest"
  }
  return true
}

export async function evaluateGoal(input: {
  contract: GoalContract
  delivery: PipelineDelivery
  decisionLog?: DecisionLog
  workDir?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  /** Evaluation tier. Defaults to "standard" (build/test/lint/typecheck
   *  discovery if no spec heuristic supplied them). Read from
   *  `EngineConfig.evaluator.tier` by callers. */
  tier?: EvaluatorTier
}): Promise<EvalVerdict> {
  const { contract, delivery, signal } = input
  const { goal } = contract

  if (signal?.aborted) throw new Error("eval aborted")

  const workDir = input.workDir ?? (await import("@/project/instance")).Instance.directory
  const ownedPaths = (goal.owned_paths ?? []) as string[]
  const evalDir = await resolveEvalDir(workDir, ownedPaths)
  if (evalDir !== workDir) {
    log.info("resolved eval directory from owned_paths", { goalID: goal.id, workDir, evalDir })
  }

  // ── 1. Translate specs ──
  const specs = goal.acceptance_specs ?? []
  const plan = translateSpecs(specs)
  log.info("translated acceptance specs", {
    goalID: goal.id,
    specs: specs.length,
    heuristic: plan.heuristic.length,
    rubric: plan.rubric.length,
  })

  // ── 2. Discover supplementary project commands (build/test/lint), but
  //      only when there are NO heuristic specs already. Specs win — if the
  //      requirements agent declared the build matters, it must say so.
  //      Tier filters which discovered commands actually run: tier=core keeps
  //      build/test only; tier=standard/full keeps everything discovered.
  const tier: EvaluatorTier = input.tier ?? "standard"
  const discoveredAll = plan.heuristic.length === 0 ? await discoverCommands(evalDir) : []
  const discovered = discoveredAll.filter((d) => tierAllowsDiscovered(d.name, tier))
  const supplement = deduplicateDiscovered(plan.heuristic, discovered)

  const results: CheckResult[] = []

  // ── 3. Execute on_goal heuristic scorers ──
  for (const item of plan.heuristic) {
    if (signal?.aborted) throw new Error("eval aborted")

    if (item.trigger === "on_delivery") {
      results.push({
        name: item.name,
        command: item.command,
        passed: true,
        output: "deferred to delivery — not executed at goal stage",
        source: "spec_heuristic",
        mode: item.mode,
        severity: item.severity,
      })
      continue
    }

    const cwd = item.cwd ? path.resolve(evalDir, item.cwd) : evalDir
    const run = await Shell.run(item.command, {
      cwd,
      env: process.env,
      idleTimeoutMs: 15_000,
      timeoutMs: 300_000,
      abort: signal,
    })

    const passed = scorerPassed(run, item.expectedExitCode)
    results.push({
      name: item.name,
      command: item.command,
      passed,
      output: [run.stdout.trim().slice(0, 3000), run.stderr.trim().slice(0, 1000)].filter(Boolean).join("\n"),
      source: "spec_heuristic",
      mode: item.mode,
      severity: item.severity,
    })

    log.info("eval heuristic", {
      goalID: goal.id,
      name: item.name,
      command: item.command,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      idleTimedOut: run.idleTimedOut,
      passed,
    })
  }

  // ── 4. Execute on_goal rubric scorers ──
  for (const item of plan.rubric) {
    if (signal?.aborted) throw new Error("eval aborted")

    if (item.trigger === "on_delivery") {
      results.push({
        name: item.name,
        command: `rubric:${item.kind}`,
        passed: true,
        output: "deferred to delivery — not executed at goal stage",
        source: "spec_rubric",
        mode: item.mode,
        severity: item.severity,
      })
      continue
    }

    const out = await runRubric(item, {
      deliverySummary: delivery.summary,
      changedFiles: delivery.diffs?.map((d) => d.file),
      requirementText: requirementTextFor(contract, item),
      signal,
      cacheKey: `goal-${goal.id}-evaluator`,
      taskID: contract.task.id,
    })

    results.push({
      name: item.name,
      command: `rubric:${item.kind}`,
      passed: out.status === "passed",
      output: out.evidence,
      source: "spec_rubric",
      mode: item.mode,
      severity: item.severity,
    })
  }

  // ── 5. Supplementary project commands ──
  for (const { name, command } of supplement) {
    if (signal?.aborted) throw new Error("eval aborted")
    const run = await Shell.run(command, {
      cwd: evalDir,
      env: process.env,
      idleTimeoutMs: 15_000,
      timeoutMs: 300_000,
      abort: signal,
    })
    const passed = scorerPassed(run, 0)
    results.push({
      name,
      command,
      passed,
      output: [run.stdout.trim().slice(0, 3000), run.stderr.trim().slice(0, 1000)].filter(Boolean).join("\n"),
      source: "project_discovery",
      mode: "soft",
    })
    log.info("eval discovery", { goalID: goal.id, name, command, exitCode: run.exitCode, passed })
  }

  // ── 6. Visual diff (unchanged from old evaluator — orthogonal to specs) ──
  const visualRef = resolveVisualReference(goal)
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
        mode: "strict",
      })
    } else {
      const visualOut = path.join(evalDir, ".opencorvus", "visual-diff")
      try {
        const report = await runVisualDiff({ rendered: renderedHtml, reference: visualRef, outDir: visualOut })
        results.push({
          name: "visual_diff",
          command: `visual-diff rendered=${renderedHtml} reference=${visualRef}`,
          passed: report.passed,
          output: summarizeVisualReport(report),
          source: "visual",
          mode: "strict",
        })
      } catch (err) {
        results.push({
          name: "visual_diff",
          command: `visual-diff rendered=${renderedHtml} reference=${visualRef}`,
          passed: false,
          output: `visual-diff failed to run: ${err instanceof Error ? err.message : String(err)}`,
          source: "visual",
          mode: "strict",
        })
      }
    }
  }

  // ── 7. Verdict aggregation by mode (severity) ──
  // If no scorers ran at all, the goal contract is malformed: the schema
  // mandates `acceptance_specs.min(1)` (goal-contract.schema.ts), so reaching
  // here means a producer wrote a goal with empty specs AND project discovery
  // found no fallback build/test command. Returning pass-by-default would
  // hide a configuration bug — explicitly reject so the operator notices.
  if (results.length === 0) {
    return {
      pass: false,
      verdict: "rejected",
      evidence: ["Goal has no acceptance scorers and no discoverable build/test commands."],
      evidenceStatus: ["failed"],
      reasoning:
        "Cannot evaluate this goal — its acceptance_specs are empty and project discovery found nothing to run. " +
        "Re-run requirements (or add specs via add_goal/modify_goal) before retrying.",
      failureClass: "goal_wrong",
      checks: [],
    }
  }

  const strictFailed = results.filter((r) => !r.passed && r.mode === "strict")
  const softFailed = results.filter((r) => !r.passed && r.mode === "soft")
  const passedAllStrict = strictFailed.length === 0

  const evidence = results.map((r) => `[${r.source}${r.severity ? `:${r.severity}` : ""}] ${r.name}: ${r.command}`)
  const evidenceStatus: Array<"passed" | "failed" | undefined> = results.map((r) => (r.passed ? "passed" : "failed"))

  return {
    pass: passedAllStrict,
    verdict: passedAllStrict ? "accepted" : "rejected",
    evidence,
    evidenceStatus,
    reasoning: passedAllStrict
      ? `All ${results.length} check(s) passed${
          softFailed.length > 0 ? `; ${softFailed.length} soft scorer(s) failed (annotated, non-blocking).` : "."
        }`
      : `${strictFailed.length} of ${results.length} strict check(s) failed:\n${strictFailed
          .map((r) => `- [${r.source}] ${r.name}: ${r.output.slice(0, 500)}`)
          .join("\n")}`,
    failureClass: passedAllStrict ? undefined : "bug",
    checks: results,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requirementTextFor(_contract: GoalContract, _item: TranslatedRubric): string | undefined {
  // Future: look up the requirement row by ID and return its description.
  // For now return undefined; the rubric scorer's `inputs` controls whether
  // requirement_text is even requested.
  return undefined
}

function resolveVisualReference(goal: GoalContract["goal"]): string | undefined {
  const meta = (goal.metadata as Record<string, unknown> | undefined) ?? {}
  const direct = typeof meta.visual === "string" ? meta.visual : undefined
  if (direct) return direct
  const ref = typeof meta.visual_reference === "string" ? meta.visual_reference : undefined
  if (ref) return ref
  return undefined
}

function scorerPassed(run: Shell.RunResult, expectedExitCode?: number): boolean {
  const wanted = expectedExitCode ?? 0
  if (!run.timedOut && !run.idleTimedOut) return run.exitCode === wanted
  if (run.idleTimedOut && run.stdout.length > 0) return wanted === 0
  return false
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
