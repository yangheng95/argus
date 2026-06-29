/**
 * Evaluator type definitions — consumed by evaluator/discovery, acceptance
 * agent + service, and orchestrator persist + docs.
 */
import z from "zod"
import { CheckConfig, EvaluationCheck, NamedCheckFamily } from "@/engine"
import { Snapshot } from "@/snapshot"
import type { AcceptanceSpec } from "@/acceptance/types"

// ---------------------------------------------------------------------------
// Output schema (from evaluator/agent.ts)
// ---------------------------------------------------------------------------

export const FailureClassification = z.enum([
  "transient",
  "environment",
  "input",
  "permission",
  "evaluation",
  "strategy",
  "unknown",
])

export const ReplanGuidance = z.object({
  root_cause: z.string().describe("What actually went wrong at the technical level"),
  what_failed: z.string().describe("Which specific part of the acceptance failed"),
  suggested_strategy: z.string().describe("How the next attempt should approach the problem differently"),
  avoid_approaches: z.array(z.string()).describe("Approaches that were tried and failed — do not repeat"),
})

export const GoalAssessment = z.object({
  goal_index: z.number(),
  status: z.enum(["passed", "failed", "inconclusive"]),
  evidence: z.array(z.string()).describe("List of specific evidence items supporting this assessment"),
  reasoning: z.string().optional().describe("Why this goal was assessed this way"),
})

export const EvaluatorAnalysis = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  classification: FailureClassification,
  summary: z.string().optional().default(""),
  goal_statuses: z.array(GoalAssessment),
  replan_guidance: ReplanGuidance.nullish(),
})

export type EvaluatorAnalysisType = z.infer<typeof EvaluatorAnalysis>

/** Alias used by the orchestrator persist layer and acceptance evidence manifests. */
export type GoalJudgmentType = EvaluatorAnalysisType

// ---------------------------------------------------------------------------
// Input types (from evaluator/agent.ts)
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string
  status: "passed" | "failed" | "skipped" | "inconclusive"
  evidence?: string
}

export interface GoalInfo {
  /** Goal DB id (e.g. `gol_...`). Required: acceptance review must cite it
   *  when writing rejection_details[].goal_id so the orchestrator can route
   *  each rejection back to the correct goal without string-matching. */
  id: string
  latest_goal_run_id?: string
  /** Short human title — same as engine_goal.title. Shown alongside the id
   *  in the prompt so the agent has a label, not just a random identifier. */
  title: string
  description: string
  criteria: string
  priority: "blocking" | "advisory"
  acceptance_spec_count?: number
  acceptance_scenarios?: AcceptanceSpec[]
  acceptance_specs?: AcceptanceSpec[]
  check_selector?: string[]
  requirement_ids: string[]
  depends_on: string[]
  owned_paths: string[]
}

export interface GoalReportClaim {
  files_changed: Array<{ path: string; summary: string }>
  checks_run: Array<{ name: string; command: string; exit_code: number; output_excerpt?: string }>
  implementation_approach: string
  design_decisions: Array<{ choice: string; alternatives: string[]; reason: string }>
  blockers: string[]
}

export interface AcceptanceInfo {
  summary: string
  changedFiles: string[]
  diffs?: Array<{
    file: string
    diff?: string
    before?: string
    after?: string
    additions?: number
    deletions?: number
    status?: string
  }>
  // Host-side deterministic conclusions were intentionally removed from this
  // contract. Current acceptance review runs inside the integrity session and
  // must investigate from session-owned evidence, not host failure summaries.
  /**
   * Structured per-goal implementation reports emitted by goal executors via
   * the `goal_report` tool call. One entry per delivered goal. Length 1 for
   * per-goal evaluator input; length N for the aggregated final-acceptance
   * context. Authoritative source for acceptance review's adversarial
   * cross-check: `implementation_approach` is matched against the diff and
   * `design_decisions[].reason` is challenged. Absence of the array (or an
   * empty array) means the executor never produced a report — the pipeline
   * fails loud rather than silently passing.
   */
  goalReports?: Array<{ goalTitle: string; report: GoalReportClaim }>
}

// ---------------------------------------------------------------------------
// Evaluation pipeline types (from evaluator/shared.ts)
// ---------------------------------------------------------------------------

export const JudgeResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  strengths: z.array(z.string()).optional(),
  concerns: z.array(z.string()).optional(),
})

export const SpecCheckResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  criteria: z.array(
    z.object({
      criterion: z.string(),
      status: z.enum(["passed", "failed", "inconclusive"]),
      evidence: z.string(),
    }),
  ),
})

export const ReviewResultSchema = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
})

export type EvaluatorCommand = {
  command: string
  cwd?: string
}

export type CommandGroup = {
  name: string
  label?: string
  family?: z.infer<typeof NamedCheckFamily>
  commands: EvaluatorCommand[]
}

export type EvaluationTask = {
  taskID?: string
  activeSpecVersionID?: string
  request?: string
  metadata?: Record<string, unknown>
}

export type EvaluationAcceptance = {
  summary: string
  diffs?: Snapshot.FileDiff[]
  changedFiles?: string[]
}

export type EvaluationArtifact = {
  kind: "log" | "report" | "image"
  label: string
  payload: Record<string, unknown>
}

export type EvaluationOutcome = {
  outcome: "passed" | "failed" | "skipped"
  summary: string
  checks: z.infer<typeof EvaluationCheck>[]
  artifacts: EvaluationArtifact[]
}

export type EvaluationOutput = {
  status: "passed" | "failed" | "inconclusive"
  verdict: "accepted" | "rejected" | "inconclusive"
  summary: string
  checks: z.infer<typeof EvaluationCheck>[]
  artifacts: EvaluationArtifact[]
}

export type PluginCheck = {
  name: string
  mode: "soft" | "strict"
  run: (ctx: { request?: string; acceptance: EvaluationAcceptance }) => Promise<{
    status: "passed" | "failed" | "skipped"
    evidence: string
    artifacts?: Array<{ kind: string; label: string; payload: Record<string, unknown> }>
  }>
}

export type CheckDef = {
  name: string
  label: string
  family?: string
}

export type OptionalCheckDef = CheckDef & {
  run: (
    config: z.infer<typeof CheckConfig>,
    task: EvaluationTask,
    acceptance: EvaluationAcceptance,
  ) => Promise<EvaluationOutcome>
}

export const CORE_CHECK_DEFS = [
  { name: "build", label: "Build", family: "build" },
  { name: "test", label: "Unit Tests", family: "test" },
  { name: "lint", label: "Lint", family: "lint" },
  { name: "verify_cmd", label: "Verify Command", family: "verify_cmd" },
] as const satisfies CheckDef[]

/**
 * Static map from check name → metadata. Built once at module load from the
 * CORE_CHECK_DEFS array. Previously populated via a runtime
 * `initBuiltinCheckIndex()` that was never called, leaving the index empty
 * and causing `checkResult()` to always fall through to input.label/family.
 */
export const BUILTIN_CHECK_INDEX: ReadonlyMap<string, { label: string; family?: string; order: number }> = new Map(
  CORE_CHECK_DEFS.map((item, index) => [item.name, { label: item.label, family: item.family, order: index }]),
)

export function checkBase(name: string) {
  return name.replace(/#\d+$/, "")
}

export function checkResult(input: z.infer<typeof EvaluationCheck>) {
  const meta = BUILTIN_CHECK_INDEX.get(checkBase(input.name))
  return {
    ...input,
    label: input.label ?? meta?.label,
    family: input.family ?? meta?.family,
  }
}

const MAX_OUTPUT = 12000

export function clip(input: string, maxLength?: number) {
  const value = input.trim()
  const limit = maxLength ?? MAX_OUTPUT
  if (value.length <= limit) return value
  return value.slice(0, limit) + "\n...[truncated]"
}

export function emptyOptional(): EvaluationOutcome & { artifacts: EvaluationArtifact[] } {
  return {
    outcome: "passed" as const,
    summary: "",
    checks: [],
    artifacts: [] as Array<{ kind: "log" | "report" | "image"; label: string; payload: Record<string, unknown> }>,
  }
}

const OUTCOME_BY_MODE = {
  strict: { outcome: "failed" as const, status: "failed" as const },
  soft: { outcome: "skipped" as const, status: "skipped" as const },
} as const satisfies Record<"strict" | "soft", { outcome: "failed" | "skipped"; status: "failed" | "skipped" }>

export function softOrStrict(input: {
  mode: "soft" | "strict"
  name: string
  summary: string
  evidence: string
  payload: Record<string, unknown>
}): EvaluationOutcome {
  const { outcome, status } = OUTCOME_BY_MODE[input.mode]
  return {
    outcome,
    summary: input.summary,
    checks: [{ name: input.name, status, evidence: input.evidence }],
    artifacts: [{ kind: "report" as const, label: `evaluation:${input.name}`, payload: input.payload }],
  }
}

export async function webPage(url: string, timeoutMs: number) {
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

export function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeArtifacts(input?: Array<{ kind: string; label: string; payload: Record<string, unknown> }>) {
  return (input ?? []).map((item) => ({
    kind: item.kind as EvaluationArtifact["kind"],
    label: item.label,
    payload: item.payload,
  }))
}
