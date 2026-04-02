/**
 * Result aggregation, verdict computation, check ordering, and plugin integration.
 */

import z from "zod"
import { CheckConfig, EvaluationCheck } from "@/orchestrator/model"
import { Plugin } from "@/plugin"
import { BUILTIN_CHECK_INDEX } from "./check-defs"
import * as Outcome from "./outcome"
import { commandResult } from "./shell-executor"
import type {
  CommandGroup,
  EvaluationTask,
  EvaluationDelivery,
  EvaluationArtifact,
  EvaluationOutcome,
  EvaluationOutput,
  PluginCheck,
  OptionalCheckDef,
} from "./types"
import { DEFAULT_TIMEOUT_MS, clip } from "./types"

import { startupResult, artifactResult } from "./shell-executor"
import { visualResult, puppeteerResult } from "./browser-checker"
import { uiReviewResult, codeQualityResult, codeReviewResult, deadCodeReviewResult, judgeResult, specCheckResult } from "./judge"
import { CORE_CHECK_DEFS } from "./check-defs"

// ---------------------------------------------------------------------------
// Optional check definitions registry
// ---------------------------------------------------------------------------

const OPTIONAL_CHECK_DEFS: readonly OptionalCheckDef[] = [
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
]

export const BUILTIN_CHECK_DEFS = [...CORE_CHECK_DEFS, ...OPTIONAL_CHECK_DEFS]

// ---------------------------------------------------------------------------
// Task refs helper
// ---------------------------------------------------------------------------

export function taskRefs(task: EvaluationTask) {
  return {
    taskID: task.metadata?.taskID as string | undefined,
    runID: task.metadata?.runID as string | undefined,
    request: task.request,
  }
}

// ---------------------------------------------------------------------------
// Result publishing
// ---------------------------------------------------------------------------

export async function publishResult(task: EvaluationTask, output: EvaluationOutput) {
  await Plugin.trigger("evaluation.result", taskRefs(task), output).catch(() => undefined)
  return output
}

// ---------------------------------------------------------------------------
// Command checks (core shell checks)
// ---------------------------------------------------------------------------

export async function commandChecks(
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

// ---------------------------------------------------------------------------
// Optional checks (LLM, browser, plugins)
// ---------------------------------------------------------------------------

export async function optionalChecks(
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

// ---------------------------------------------------------------------------
// Plugin checks
// ---------------------------------------------------------------------------

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

  const output = Outcome.softOrStrict({
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

function pluginFallback(name: string) {
  return {
    status: "skipped" as const,
    evidence: `Plugin check ${name} threw an error.`,
    artifacts: undefined as Array<{ kind: string; label: string; payload: Record<string, unknown> }> | undefined,
  }
}

function normalizeArtifacts(input?: Array<{ kind: string; label: string; payload: Record<string, unknown> }>) {
  return (input ?? []).map((item) => ({
    kind: item.kind as EvaluationArtifact["kind"],
    label: item.label,
    payload: item.payload,
  }))
}

// ---------------------------------------------------------------------------
// Check result enrichment & ordering
// ---------------------------------------------------------------------------

function checkBase(name: string) {
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

function orderChecks(input: z.infer<typeof EvaluationCheck>[]) {
  const rank = (name: string) => BUILTIN_CHECK_INDEX.get(checkBase(name))?.order ?? BUILTIN_CHECK_INDEX.size + 100
  const suffix = (name: string) => Number(name.match(/#(\d+)$/)?.[1] ?? 0)
  return [...input].sort((a, b) =>
    rank(a.name) - rank(b.name) ||
    suffix(a.name) - suffix(b.name) ||
    a.name.localeCompare(b.name),
  )
}

// ---------------------------------------------------------------------------
// Final evaluation assembly
// ---------------------------------------------------------------------------

export function finalizeEvaluation(
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
