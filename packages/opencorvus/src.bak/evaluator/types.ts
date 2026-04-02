/**
 * Shared types and Zod schemas for the evaluator subsystem.
 */

import z from "zod"
import { CheckConfig, EvaluationCheck, NamedCheckFamily } from "@/orchestrator/model"
import { Snapshot } from "@/snapshot"
import type { CheckDef } from "./check-defs"

// ---------------------------------------------------------------------------
// Zod schemas for LLM-generated results
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

export const ReviewResult = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  rationale: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
})

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

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

export type OptionalCheckDef = CheckDef & {
  run: (config: z.infer<typeof CheckConfig>, task: EvaluationTask, delivery: EvaluationDelivery) => Promise<EvaluationOutcome>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
export const MAX_OUTPUT = 12000

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

export function clip(input: string, maxLength?: number) {
  const value = input.trim()
  const limit = maxLength ?? MAX_OUTPUT
  if (value.length <= limit) return value
  return value.slice(0, limit) + "\n...[truncated]"
}

export function quote(input: string) {
  return `"${input.replaceAll('"', '\\"')}"`
}
