/**
 * AcceptanceSpec → execution plan translator.
 *
 * Produces two buckets consumed by the per-goal evaluator:
 *   • heuristicCommands — shell commands with labels + mode (soft/strict)
 *   • rubricChecks      — llm_judge + prebuilt entries evaluated by llm-judge-runner
 *
 * Pure function: given identical specs it returns byte-identical output. This
 * is the only place that maps IR → runtime plan; evaluator/per-goal stays
 * oblivious to IR shape.
 */
import path from "path"
import type {
  AcceptanceSpec,
  AcceptanceScorer,
  HeuristicScorer,
  LlmJudgeScorer,
  PrebuiltScorer,
} from "./types"
import { resolveTrigger, scorerMode } from "./types"

export interface TranslatedHeuristic {
  /** spec-local scorer name, prefixed with spec id for uniqueness across a goal. */
  name: string
  /** "[spec-id] scorer-name" label for evidence. */
  label: string
  /** Shell command to execute. */
  command: string
  /** Which heuristic sub-kind produced this row — consumers need this to
   *  populate `EngineEvaluationCheck.scorer_kind` (see spec-09). `shell`
   *  scorers map to `heuristic_shell`; `script_ref` scorers map to
   *  `heuristic_script_ref` even though the rendered command is `bun run ...`. */
  subKind: "shell" | "script_ref"
  /** Optional cwd override (relative to eval dir). */
  cwd?: string
  /** Expected exit code; undefined means "0 = pass". */
  expectedExitCode?: number
  mode: "soft" | "strict"
  severity: AcceptanceSpec["severity"]
  trigger: "on_goal" | "on_delivery"
  sourceSpecId: string
  sourceRequirementId: string
}

export interface TranslatedRubric {
  name: string
  label: string
  kind: "llm_judge" | "prebuilt"
  scorer: LlmJudgeScorer | PrebuiltScorer
  mode: "soft" | "strict"
  severity: AcceptanceSpec["severity"]
  trigger: "on_goal" | "on_delivery"
  sourceSpecId: string
  sourceRequirementId: string
}

export interface TranslationPlan {
  heuristic: TranslatedHeuristic[]
  rubric: TranslatedRubric[]
}

/**
 * Translate a set of specs into a deterministic execution plan. Output order
 * follows input order, with a stable secondary sort on `${specId}:${name}` to
 * make diff-idempotency trivial to assert.
 */
export function translateSpecs(specs: readonly AcceptanceSpec[]): TranslationPlan {
  const plan: TranslationPlan = { heuristic: [], rubric: [] }

  for (const spec of specs) {
    for (const scorer of spec.scorers) {
      const trigger = resolveTrigger(spec, scorer)
      const mode = scorerMode(spec)
      const name = `${spec.id}:${scorer.name}`
      const label = `[${spec.title}] ${scorer.name}`

      if (scorer.type === "heuristic") {
        plan.heuristic.push({
          name,
          label,
          command: buildHeuristicCommand(scorer),
          subKind: scorer.spec.kind,
          cwd: scorer.spec.kind === "shell" ? scorer.spec.cwd : undefined,
          expectedExitCode: scorer.expect?.exit_code,
          mode,
          severity: spec.severity,
          trigger,
          sourceSpecId: spec.id,
          sourceRequirementId: spec.source_requirement_id,
        })
        continue
      }

      plan.rubric.push({
        name,
        label,
        kind: scorer.type,
        scorer,
        mode,
        severity: spec.severity,
        trigger,
        sourceSpecId: spec.id,
        sourceRequirementId: spec.source_requirement_id,
      })
    }
  }

  plan.heuristic.sort((a, b) => a.name.localeCompare(b.name))
  plan.rubric.sort((a, b) => a.name.localeCompare(b.name))
  return plan
}

export function buildHeuristicCommand(scorer: HeuristicScorer): string {
  if (scorer.spec.kind === "shell") return scorer.spec.cmd
  // script_ref: run via bun to stay consistent with the project's runtime.
  const parts = ["bun", "run", normalizeScriptPath(scorer.spec.path)]
  if (scorer.spec.args && scorer.spec.args.length > 0) {
    for (const arg of scorer.spec.args) parts.push(quoteArg(arg))
  }
  return parts.join(" ")
}

function normalizeScriptPath(p: string): string {
  // Ensure the path is a relative POSIX-style reference within the repo.
  // Absolute paths bind to a specific worktree (reject), and `..` segments
  // can escape the repo into arbitrary filesystem locations (reject) — both
  // are correctness/safety hazards when produced by an LLM.
  if (path.isAbsolute(p)) {
    throw new Error(`script_ref path must be repo-relative, got absolute: ${p}`)
  }
  const normalized = p.split(path.sep).join("/")
  const segments = normalized.split("/").filter((seg) => seg !== "" && seg !== ".")
  if (segments.some((seg) => seg === "..")) {
    throw new Error(`script_ref path must not contain '..' segments: ${p}`)
  }
  return normalized
}

function quoteArg(arg: string): string {
  if (!/[\s"'$`\\]/.test(arg)) return arg
  // Single-quote and escape embedded single quotes.
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
