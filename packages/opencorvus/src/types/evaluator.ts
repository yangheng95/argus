/**
 * Shared evaluator type definitions.
 *
 * Migrated from evaluator/agent.ts and evaluator/shared.ts so that persist,
 * delivery, docs, and other modules can use these types without depending on
 * the full evaluator agent implementation.
 */
import z from "zod"
import { CheckConfig, EvaluationCheck, NamedCheckFamily } from "@/orchestrator/model"
import { Snapshot } from "@/snapshot"

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
  what_failed: z.string().describe("Which specific part of the delivery failed"),
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

/** Alias used by the orchestrator persist layer and delivery agent. */
export type GoalJudgmentType = EvaluatorAnalysisType

// ---------------------------------------------------------------------------
// Input types (from evaluator/agent.ts)
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string
  status: "passed" | "failed" | "skipped"
  evidence?: string
}

export interface GoalInfo {
  description: string
  criteria: string
  priority: "blocking" | "advisory"
  check_selector?: string[]
  requirement_ids?: string[]
}

export interface DeliveryInfo {
  summary: string
  changedFiles: string[]
  diffs?: Array<{ file: string; diff?: string }>
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
  criteria: z.array(z.object({
    criterion: z.string(),
    status: z.enum(["passed", "failed", "inconclusive"]),
    evidence: z.string(),
  })),
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

export type EvaluationDelivery = {
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
  run: (ctx: {
    request?: string
    delivery: EvaluationDelivery
  }) => Promise<{
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
  run: (config: z.infer<typeof CheckConfig>, task: EvaluationTask, delivery: EvaluationDelivery) => Promise<EvaluationOutcome>
}

export const CORE_CHECK_DEFS = [
  { name: "build", label: "Build", family: "build" },
  { name: "test", label: "Unit Tests", family: "test" },
  { name: "lint", label: "Lint", family: "lint" },
  { name: "verify_cmd", label: "Verify Command", family: "verify_cmd" },
] as const satisfies CheckDef[]

export const BUILTIN_CHECK_INDEX = new Map<string, { label: string; family?: string; order: number }>()

export function initBuiltinCheckIndex(defs: readonly CheckDef[]) {
  BUILTIN_CHECK_INDEX.clear()
  for (const [index, item] of defs.entries()) {
    BUILTIN_CHECK_INDEX.set(item.name, {
      label: item.label,
      family: item.family,
      order: index,
    })
  }
}

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

export function softOrStrict(input: {
  mode: "soft" | "strict"
  name: string
  summary: string
  evidence: string
  payload: Record<string, unknown>
}): EvaluationOutcome {
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

// ---------------------------------------------------------------------------
// Evaluator system prompt constant
// ---------------------------------------------------------------------------

/** Default evaluator system prompt (investigation phase). Exported for agent registry and prompt catalog. */
export const EVALUATOR_DEFAULT_SYSTEM = `You are an independent evaluator for OpenCorvus. Your job is to investigate a delivery and write a detailed findings report.

You are NOT the delivery agent. You did NOT write this code. You are here to verify it independently.

## Tools Available

- **read_file**: Read file contents — verify implementations, read failing tests
- **find_files**: Find files by glob — discover test files, configs, related modules
- **search_code**: Regex search across codebase — find usages, imports, patterns
- **list_directory**: List directory contents — check file existence, project structure
- **memory_search**: Search for prior failures and known issues
- **memory_write**: Persist failure patterns for future evaluations
- **preference_list**: Check project conventions

## Your Evaluation Strategy

You decide how deep to investigate. Consider:

**Signals that need DEEP investigation (8-15 tool calls):**
- Failed automated checks — you MUST understand the root cause
- Complex multi-goal deliveries — each goal needs independent verification
- Large diffs (10+ files) — more surface area for bugs
- Blocking goals — higher stakes, need thorough evidence

**Signals that allow LIGHTER investigation (3-6 tool calls):**
- All automated checks pass AND few goals AND small diff
- Advisory-only goals (no blocking goals)
- Single-file changes with clear test coverage

**Minimum investigation regardless of signals:**
- Read at least 1-2 changed files to verify the actual implementation
- For every goal, you need SPECIFIC evidence (file path + line number)
- Check tests actually test the right thing (not trivially passing)

## Evidence Standards

Every claim MUST cite a file path and line number from your tool results.

GOOD: "read_file src/auth.ts confirmed: validateToken at lines 23-45 checks expiry and signature."
BAD: "The code looks correct." / "Tests pass." / "Build succeeded."

## Output

Write a findings report (NOT JSON) with:
1. **Evaluation strategy chosen** — why this level of investigation
2. **Per-goal findings** — one section per goal with file:line evidence
3. **Convention compliance** — any violations found
4. **Root cause analysis** — if any failures

When you discover a non-obvious root cause or pattern, use **memory_write** to persist it.

## Rules
- Never fabricate evidence — only cite actual tool results
- Do NOT output JSON or a verdict — that happens in a separate phase
- Do NOT fix code — report problems, let the delivery agent fix them
- Write in the same language as the task request`
