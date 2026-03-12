import { Plugin } from "@/plugin"
import { CheckConfig, EvaluationCheck } from "@/orchestrator/model"
import { EvaluatorAgent, type EvaluatorAnalysisType, type GoalInfo, type CheckResult, type DeliveryInfo } from "./agent"
import { Log } from "@/util/log"
import z from "zod"
import { resolveConfig, discoverChecks, resolvedChecks, commandGroups } from "./discovery"
import { commandChecks } from "./checks"
import { startupResult } from "./checks"
import { artifactResult } from "./checks"
import { visualResult } from "./checks"
import { puppeteerResult } from "./checks"
import { uiReviewResult, codeQualityResult, codeReviewResult, deadCodeReviewResult, specCheckResult } from "./review"
import {
  type EvaluationTask,
  type EvaluationDelivery,
  type EvaluationArtifact,
  type EvaluationOutcome,
  type EvaluationOutput,
  type PluginCheck,
  type OptionalCheckDef,
  CORE_CHECK_DEFS,
  BUILTIN_CHECK_INDEX,
  initBuiltinCheckIndex,
  checkBase,
  checkResult,
  emptyOptional,
  normalizeArtifacts,
  softOrStrict,
} from "./shared"

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

const OPTIONAL_CHECK_DEFS = [
  { name: "startup", label: "Startup", family: "runtime", run: (config) => startupResult(config.startup) },
  { name: "artifact", label: "Artifacts", family: "artifact", run: (config, _task, delivery) => artifactResult(config.artifact, delivery) },
  { name: "visual", label: "Visual Check", family: "runtime", run: (config) => visualResult(config.visual) },
  { name: "puppeteer", label: "Puppeteer", family: "runtime", run: (config) => puppeteerResult(config.puppeteer) },
  { name: "ui_review", label: "UI Review", family: "review", run: (config, task, delivery) => uiReviewResult(config.ui_review, task.request, delivery) },
  { name: "code_quality", label: "Code Quality", family: "review", run: (config, task, delivery) => codeQualityResult(config.code_quality, task.request, delivery) },
  { name: "code_review", label: "Code Review", family: "review", run: (config, task, delivery) => codeReviewResult(config.code_review, task.request, delivery) },
  { name: "dead_code_review", label: "Dead Code Review", family: "review", run: (config, task, delivery) => deadCodeReviewResult(config.dead_code_review, task.request, delivery) },
  { name: "spec_check", label: "Spec Check", family: "acceptance", run: (config, task, delivery) => specCheckResult(config.spec_check, task.request, task.activeSpecVersionID, delivery) },
] as const satisfies OptionalCheckDef[]

const BUILTIN_CHECK_DEFS = [...CORE_CHECK_DEFS, ...OPTIONAL_CHECK_DEFS]
initBuiltinCheckIndex(BUILTIN_CHECK_DEFS)

export namespace EvaluatorService {
  export async function resolveChecks(metadata?: Record<string, unknown>, changedFiles?: unknown) {
    const config = await resolveConfig(metadata)
    const discovered = await discoverChecks(changedFiles)
    return resolvedChecks(config, discovered)
  }

  export async function evaluate(
    task: EvaluationTask,
    delivery: EvaluationDelivery,
  ) {
    const config = await resolveConfig(task.metadata)
    const discovered = await discoverChecks(task.metadata?.delivery_changed_files)
    const commands = commandGroups(config, discovered)
    const core = await commandChecks(commands, config.timeout_ms ?? DEFAULT_TIMEOUT_MS, delivery)
    if (core.checks.some((item) => item.status === "failed")) {
      return publishResult(task, finalizeEvaluation(commands, core.checks, core.artifacts, [], !!task.activeSpecVersionID))
    }
    const optional = await optionalChecks(config, task, delivery)
    const checks = [...core.checks, ...optional.flatMap((item) => Array.isArray(item.checks) ? item.checks : [])]
    const artifacts = [...core.artifacts, ...optional.flatMap((item) => Array.isArray(item.artifacts) ? item.artifacts : [])]
    return publishResult(task, finalizeEvaluation(commands, checks, artifacts, optional, !!task.activeSpecVersionID))
  }

  export async function analyzeDelivery(input: {
    task: { title: string; request: string; sessionID?: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
  }): Promise<EvaluatorAnalysisType> {
    return EvaluatorAgent.analyze(input)
  }
}

const evaluatorLog = Log.create({ service: "evaluator" })

function taskRefs(task: EvaluationTask) {
  return {
    taskID: typeof task.metadata?.taskID === "string" ? task.metadata.taskID : undefined,
    runID: typeof task.metadata?.runID === "string" ? task.metadata.runID : undefined,
    request: task.request,
  }
}

async function publishResult(task: EvaluationTask, output: EvaluationOutput) {
  await Plugin.trigger("evaluation.result", taskRefs(task), output).catch((err) => {
    evaluatorLog.warn("evaluation.result plugin trigger failed", { error: String(err) })
  })
  return output
}

const LOCAL_CHECK_NAMES = new Set(["startup", "artifact", "visual", "puppeteer"])

async function optionalChecks(
  config: z.infer<typeof CheckConfig>,
  task: EvaluationTask,
  delivery: EvaluationDelivery,
) {
  // Phase 1: run local (non-LLM) checks concurrently
  const phase1 = await Promise.all(
    OPTIONAL_CHECK_DEFS.map((item) =>
      LOCAL_CHECK_NAMES.has(item.name) ? item.run(config, task, delivery) : undefined,
    ),
  )
  // If any local check failed strictly, skip LLM review checks and plugins
  const strictLocalFailed = phase1.some((item) => item !== undefined && item.outcome === "failed")
  // Phase 2: run LLM review checks (skip if strict local failure)
  const builtin = await Promise.all(
    OPTIONAL_CHECK_DEFS.map(async (item, i) => {
      if (phase1[i] !== undefined) return phase1[i]!
      if (strictLocalFailed) return emptyOptional()
      return item.run(config, task, delivery)
    }),
  )
  const plugins = strictLocalFailed ? [] : await pluginChecks(config, task, delivery)
  return [...builtin, ...plugins].map((item) => ({
    ...item,
    checks: item.checks.map(checkResult),
  }))
}

async function pluginChecks(
  config: z.infer<typeof CheckConfig>,
  task: EvaluationTask,
  delivery: EvaluationDelivery,
) {
  const output = { checks: [] as PluginCheck[] }
  await Plugin.trigger("evaluation.checks", {
    ...taskRefs(task),
    config: (config.custom as Record<string, unknown>) ?? {},
  }, output).catch((err) => {
    evaluatorLog.warn("evaluation.checks plugin trigger failed", { error: String(err) })
  })
  return Promise.all(output.checks.map((item) => pluginCheck(item, task, delivery)))
}

async function pluginCheck(
  input: PluginCheck,
  task: EvaluationTask,
  delivery: EvaluationDelivery,
): Promise<EvaluationOutcome> {
  const result = await input.run({ request: task.request, delivery }).catch((error) => pluginErrorResult(input.name, error))
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

  const output = softOrStrict({
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

function pluginErrorResult(name: string, error: unknown) {
  return {
    status: "failed" as const,
    evidence: `Plugin check ${name} threw an error: ${error instanceof Error ? error.message : String(error)}`,
    artifacts: undefined as Array<{ kind: string; label: string; payload: Record<string, unknown> }> | undefined,
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

function finalizeEvaluation(
  commands: { name: string }[],
  checks: z.infer<typeof EvaluationCheck>[],
  artifacts: EvaluationArtifact[],
  optional: EvaluationOutcome[],
  requireSpecCheck: boolean,
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
  const specCheck = ordered.find((item) => item.name === "spec_check")
  if (requireSpecCheck && (!specCheck || specCheck.status !== "passed")) {
    const reason = !specCheck
      ? "Spec check is required but did not run."
      : `Spec check is required and must pass before acceptance. Current status: ${specCheck.status}.`
    return {
      status: "failed",
      verdict: "rejected",
      summary: reason,
      checks: ordered,
      artifacts,
    }
  }
  if (commands.length === 0 && optionalChecks.length === 0 && ordered.every((item) => item.status === "skipped")) {
    return {
      status: "failed",
      verdict: "rejected",
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
