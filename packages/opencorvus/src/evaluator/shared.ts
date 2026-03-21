import z from "zod"
import { CheckConfig, EvaluationCheck, NamedCheckFamily } from "@/orchestrator/model"
import { Snapshot } from "@/snapshot"

const MAX_OUTPUT = 12000

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

/** Structured check report used by persist layer for evaluation persistence. */
export type CheckReport = EvaluationOutput

/** Alias for EvaluationDelivery for backward compatibility. */
export type CheckDelivery = EvaluationDelivery

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
