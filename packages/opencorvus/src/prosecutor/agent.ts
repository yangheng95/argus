/**
 * Prosecutor — adversarial sub-agent that reads the current iteration's
 * evidence and either:
 *   - files a counterexample (engine_counterexample) when it finds a
 *     concrete reproducer, OR
 *   - proposes a diagnostic challenge metric (engine_metric_spec with
 *     source='challenge') to surface a failure mode the existing ruler can't
 *     measure.
 *
 * Everything the Prosecutor can do is quota-enforced at the store layer:
 *   - ≤1 new challenge per iteration
 *   - ≤3 new challenges per task
 *   - challenge gate_class is always 'diagnostic' — Prosecutor cannot veto
 *     accept through a metric
 *   - baseline specs are off-limits (SQL trigger + store refusals)
 *   - counterexample novelty_hash dedups so the Arbiter sees 0 novelty when
 *     the Prosecutor keeps filing the same reproducer
 *
 * Phase 4 ships the tool surface + a pluggable runner. Wiring an LLM-driven
 * agent loop around these tools is Phase 5's job; the tools themselves are
 * fully usable and tested in isolation here.
 */
import { tool } from "ai"
import { createHash } from "node:crypto"
import z from "zod"
import PROSECUTOR_CORE from "@/prompt/core/prosecutor-core.txt"
import { runAgentSession } from "@/agent/runner"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { toolGuard } from "@/util/tool-guard"
import type { TextHooks } from "@/llm/api"
import { Log } from "@/util/log"
import type { Message } from "@/session/message"
import {
  addChallengeMetric,
  MetricWriteError,
  readCounterexamplesForTask,
  readIterationHistory,
  readResultsForIteration,
  readSpecsForTask,
  resolveCounterexample,
  upsertCounterexample,
} from "@/metrics/store"
import type { Counterexample } from "@/metrics/types"
import type { DeliveryVerdictType } from "@/delivery/verdict"
import { limitSummary, markdownList, requireReportString, type AgentReportContext } from "@/agent/report"

const log = Log.create({ service: "prosecutor" })

export interface ProsecutorCollector {
  counterexamples: Counterexample[]
  challenges: Array<{ spec_id: string; name: string; goal_id: string | null }>
  rationale?: string
}

function emptyCollector(): ProsecutorCollector {
  return { counterexamples: [], challenges: [] }
}

export interface CreateProsecutorToolsInput {
  task_id: string
  iteration: number
}

export function createProsecutorTools(input: CreateProsecutorToolsInput) {
  let collector = emptyCollector()
  const { task_id, iteration } = input

  const tools = {
    query_metric_trajectory: tool({
      description:
        "Read the per-iteration score trajectory + current iteration's metric results. " +
        "Use this to reason about where Defender is stuck and which blocking metric is " +
        "the root cause. Returns arbiter-visible snapshot rows plus every metric_result " +
        "for the current iteration, with normalized scores and freshness flags.",
      inputSchema: z.object({
        window: z.number().int().min(1).max(20).default(5).describe("Number of recent iterations to return."),
      }),
      execute: async ({ window }) => {
        const history = readIterationHistory(task_id)
        const tail = history.slice(-window)
        const results = readResultsForIteration(task_id, iteration)
        const specs = new Map(readSpecsForTask(task_id).map((s) => [s.id, s]))
        const lines: string[] = []
        lines.push(`## Iteration trajectory (last ${tail.length})`)
        for (const it of tail) {
          lines.push(
            `iter=${it.iteration} verdict=${it.arbiter_verdict} S_k=${it.aggregate_score.toFixed(3)} ΔS=${it.delta_vs_prev.toFixed(3)} blocking_unmet=${it.blocking_unmet_count} open_ce=${it.open_counterexamples} novelty=${it.novelty_score} regressed=${it.regressed_blocking}`,
          )
        }
        lines.push("")
        lines.push(`## Current iteration (${iteration}) metric results`)
        for (const r of results) {
          const spec = specs.get(r.metric_spec_id)
          if (!spec) continue
          const scope = spec.scope === "goal" ? `goal=${spec.goal_id}` : "global"
          lines.push(
            `- ${spec.name} [${scope}, ${spec.gate_class}, ${spec.evaluator_kind}] raw=${r.raw_value.toFixed(3)} norm=${r.normalized_value.toFixed(3)} met_target=${r.met_target} met_floor=${r.met_floor} fresh=${r.evidence_fresh}`,
          )
        }
        return lines.join("\n")
      },
    }),

    query_diff: tool({
      description:
        "Inspect the Defender's latest delivery summary and changed-file list. Use when you " +
        "need to ground a counterexample in actual code changes. Phase 4 returns a stub — the " +
        "real delivery-snapshot reader lands with Phase 5's orchestrator wiring.",
      inputSchema: z.object({
        focus: z.string().optional().describe("Optional goal_id or file substring to filter the diff."),
      }),
      execute: async ({ focus }) => {
        return `query_diff: delivery snapshot reader not yet wired (Phase 5); focus=${focus ?? "(none)"}. ` +
          `For Phase 4 tests, use the mock harness that pre-loads delivery context.`
      },
    }),

    propose_challenge_metric: tool({
      description:
        "Propose a NEW diagnostic metric to surface a failure mode the baseline ruler " +
        "can't see. Budget is hard-capped at 1 per iteration and 3 per task; the store " +
        "layer will refuse beyond that. The challenge's gate_class is forced to " +
        "'diagnostic' — you cannot use a challenge metric to veto accept. Prefer filing " +
        "a counterexample when a concrete reproducer exists.",
      inputSchema: z.object({
        scope: z.enum(["goal", "global"]),
        goal_id: z.string().nullable().describe("Required when scope='goal'; must be null for scope='global'."),
        name: z.string().min(1),
        description: z.string().min(5),
        unit: z.string().min(1),
        direction: z.enum(["higher_better", "lower_better"]),
        target: z.number(),
        floor: z.number(),
        weight: z.number().min(0),
        evaluator_kind: z.enum(["shell", "judge", "query", "aggregator"]),
        evaluator_config: z.record(z.string(), z.unknown()).default({}),
        source_requirement_ids: z.array(z.string()).default([]),
      }),
      execute: async (args) => {
        try {
          const row = addChallengeMetric({
            task_id,
            scope: args.scope,
            goal_id: args.goal_id,
            name: args.name,
            description: args.description,
            unit: args.unit,
            direction: args.direction,
            target: args.target,
            floor: args.floor,
            weight: args.weight,
            evaluator_kind: args.evaluator_kind,
            evaluator_config: args.evaluator_config,
            source_requirement_ids: args.source_requirement_ids,
            iteration,
          })
          collector.challenges.push({ spec_id: row.id, name: row.name, goal_id: row.goal_id })
          return `OK: challenge metric "${row.name}" registered as ${row.id} (gate_class=diagnostic). Total task challenges: ${collector.challenges.length}.`
        } catch (err) {
          // MetricWriteError stores its real message on `.data.message`; the
          // base Error.message is just the class name. Unwrap it here so the
          // tool response carries the actual violation code/message.
          if (err instanceof MetricWriteError) {
            log.warn("propose_challenge_metric rejected", {
              name: args.name,
              code: err.data.code,
              msg: err.data.message,
            })
            return `Error: ${err.data.code}: ${err.data.message}`
          }
          const msg = err instanceof Error ? err.message : String(err)
          log.warn("propose_challenge_metric rejected", { name: args.name, err: msg })
          return `Error: ${msg}`
        }
      },
    }),

    mark_counterexample: tool({
      description:
        "File a concrete counterexample — a reproducible claim that Defender's delivery " +
        "is broken in a specific way. novelty_hash is computed deterministically from " +
        "(target_scope, target_ref, reproducer) so re-filing the same reproducer is a " +
        "no-op. Arbiter uses novelty_score=0 to detect Prosecutor exhaustion, which feeds " +
        "'stalled'. Always include a reproducer a human could follow.",
      inputSchema: z.object({
        target_scope: z.enum(["goal", "global"]),
        target_ref: z.string().min(1).describe("goal_id when scope='goal'; free-form label when scope='global'."),
        claim: z.string().min(5),
        reproducer: z.string().min(5).describe("Exact steps or a shell command that reproduces the failure."),
        severity: z.enum(["blocking", "diagnostic"]).default("blocking"),
        linked_metric_spec_id: z.string().nullable().default(null),
      }),
      execute: async (args) => {
        const novelty_hash = noveltyHash(args.target_scope, args.target_ref, args.reproducer)
        const row = upsertCounterexample({
          task_id,
          iteration_found: iteration,
          novelty_hash,
          target_scope: args.target_scope,
          target_ref: args.target_ref,
          claim: args.claim,
          reproducer: args.reproducer,
          severity: args.severity,
          linked_metric_spec_id: args.linked_metric_spec_id,
        })
        collector.counterexamples.push(row)
        const dedup = row.iteration_found !== iteration
          ? ` (existing row from iter=${row.iteration_found}, novelty_score unchanged)`
          : ""
        return `OK: counterexample ${row.id} (novelty=${novelty_hash.slice(0, 10)}…)${dedup}.`
      },
    }),

    resolve_counterexample: tool({
      description:
        "Mark an open counterexample as resolved when the current iteration's delivery " +
        "actually addresses it. Only file this when you've verified the reproducer no longer " +
        "reproduces — otherwise leave it open so Arbiter can keep tracking it.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      execute: async ({ id }) => {
        const matching = readCounterexamplesForTask(task_id).find((c) => c.id === id)
        if (!matching) return `Error: counterexample ${id} not found for this task`
        if (matching.iteration_resolved !== null) {
          return `Already resolved at iteration ${matching.iteration_resolved}`
        }
        resolveCounterexample(id, iteration)
        return `OK: counterexample ${id} resolved at iteration ${iteration}`
      },
    }),
  }

  return {
    tools,
    collector,
    reset() {
      collector = emptyCollector()
      return collector
    },
    getCollector() {
      return collector
    },
    buildReport(context?: AgentReportContext) {
      const rationale = requireReportString(context?.finalText ?? collector.rationale, "prosecutor rationale")
      collector.rationale = rationale.slice(0, 8000)
      const counterexampleLines = collector.counterexamples.map(
        (item) => `${item.id}: ${item.claim}`,
      )
      const challengeLines = collector.challenges.map(
        (item) => `${item.spec_id}: ${item.name}${item.goal_id ? ` (${item.goal_id})` : ""}`,
      )
      return {
        summary: limitSummary(collector.rationale),
        detail: [
          `## Rationale\n${collector.rationale}`,
          `## Counterexamples\n${counterexampleLines.length ? markdownList(counterexampleLines) : "- none filed"}`,
          `## Challenges\n${challengeLines.length ? markdownList(challengeLines) : "- none proposed"}`,
        ].join("\n\n"),
      }
    },
  }
}

/**
 * Deterministic counterexample fingerprint. The Architect-facing guarantee
 * is: "reproducer + target ⇒ same hash every time". The Prosecutor should
 * normalise the reproducer text before filing so superficial whitespace
 * differences don't create spurious novelty.
 */
export function noveltyHash(scope: "goal" | "global", target_ref: string, reproducer: string): string {
  const normalised = reproducer
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim()
  return createHash("sha256")
    .update(`${scope}|${target_ref}|${normalised}`)
    .digest("hex")
}

// ---------------------------------------------------------------------------
// Prosecutor runner — one LLM invocation per iteration
// ---------------------------------------------------------------------------

const PROSECUTOR_MAX_STEPS = 8

const PROSECUTOR_SYSTEM = PROSECUTOR_CORE

/** Optional externally-authored probe hints for the Prosecutor.
 *  Architect no longer emits these; keep the input shape local so callers that
 *  already have explicit probes can pass them without coupling to another layer. */
export interface ArchitectSeedInput {
  id: string
  scope: "goal" | "global"
  target_ref: string
  claim: string
  rationale: string
  priority_hint: "high" | "medium" | "low"
}

export interface ProsecutorRunInput {
  task: { id: string; title: string; request: string; sessionID?: string }
  iteration: number
  defenderVerdict: DeliveryVerdictType
  /** Architect priors — merged into the brief so Prosecutor doesn't have
   *  to re-derive risk areas from scratch. */
  architectSeeds?: readonly ArchitectSeedInput[]
  stream?: TextHooks
  signal?: AbortSignal
}

export interface ProsecutorRunResult {
  counterexamples_filed: number
  challenges_proposed: number
  counterexamples_resolved: number
  /** Raw agent text — kept for audit trail, not used for routing. */
  rationale: string
}

export async function runProsecutor(
  input: ProsecutorRunInput,
): Promise<ProsecutorRunResult> {
  const kit = createProsecutorTools({ task_id: input.task.id, iteration: input.iteration })
  const guard = toolGuard(kit.tools)

  const priorIterations = readIterationHistory(input.task.id)
  const currentResults = readResultsForIteration(input.task.id, input.iteration)
  const openCounterexamples = readCounterexamplesForTask(input.task.id).filter(
    (c) => c.iteration_resolved === null,
  )

  const brief = buildProsecutorBrief({
    task: input.task,
    iteration: input.iteration,
    defenderVerdict: input.defenderVerdict,
    priorIterationCount: priorIterations.length,
    currentResultCount: currentResults.length,
    openCounterexampleCount: openCounterexamples.length,
    architectSeeds: input.architectSeeds ?? [],
  })

  // Prosecutor failures are soft: if the run throws (network, model,
  // anything), we absorb the error into the rationale string and return
  // a zero-activity result. The defender's verdict already holds; the
  // prosecutor is an opportunistic adversary, not a required step.
  let rationale = ""
  try {
    const out = await runAgentSession({
      kind: "evaluator",
      agentName: "prosecutor",
      core: PROSECUTOR_CORE,
      sessionTitle: `Prosecutor: ${input.task.title} (iter ${input.iteration})`,
      parentSessionID: input.task.sessionID,
      taskID: input.task.id,
      signal: input.signal,
      toolKit: {
        tools: guard.tools as any,
        getCollector: () => kit.getCollector(),
        buildReport: (context) => kit.buildReport(context),
      },
      buildUserPrompt: () => brief,
      buildUserParts: async () => {
        const taskAttachments = (input.task as { attachments?: unknown }).attachments
        const attachments = Array.isArray(taskAttachments)
          ? (taskAttachments as Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>)
          : undefined
        const enrichedText = brief + AttachmentStore.renderAttachmentInventory(attachments)
        const inlineParts = await AttachmentStore.inlineFileParts(attachments)
        return [{ type: "text" as const, text: enrichedText }, ...inlineParts]
      },
    })
    kit.buildReport({ finalText: finalTextFromMessage(out.finalMessage) })
    rationale = kit.getCollector().rationale ?? ""
    log.info("prosecutor finished", {
      task: input.task.id,
      iteration: input.iteration,
      sessionID: out.session.id,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn("prosecutor run failed — continuing with no new counterexamples", {
      task: input.task.id,
      iteration: input.iteration,
      err: msg,
    })
    rationale = `prosecutor error: ${msg}`
  }

  const collector = kit.getCollector()
  const resolvedThisIter = readCounterexamplesForTask(input.task.id).filter(
    (c) => c.iteration_resolved === input.iteration,
  ).length

  return {
    counterexamples_filed: collector.counterexamples.filter(
      (c) => c.iteration_found === input.iteration,
    ).length,
    challenges_proposed: collector.challenges.length,
    counterexamples_resolved: resolvedThisIter,
    rationale,
  }
}

function finalTextFromMessage(message: Message.WithParts | undefined): string {
  if (!message) return ""
  const lines: string[] = []
  for (const part of message.parts ?? []) {
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      lines.push(part.text.trim())
    }
  }
  return lines.join("\n\n").slice(0, 8000)
}

function buildProsecutorBrief(input: {
  task: { id: string; title: string; request: string }
  iteration: number
  defenderVerdict: DeliveryVerdictType
  priorIterationCount: number
  currentResultCount: number
  openCounterexampleCount: number
  architectSeeds: readonly ArchitectSeedInput[]
}): string {
  // Discriminated-union narrowing: only rejected verdicts carry
  // rejection_details. Accepted verdicts have no per-goal attribution
  // (an accepted delivery has no goals to blame).
  const rejectionDetails = input.defenderVerdict.verdict === "rejected"
    ? input.defenderVerdict.rejection_details
    : []
  // Single source of truth (rule 22): the issue text and goal-attribution
  // list are both derived from rejection_details — no `issues_found` /
  // `affected_goal_ids` shadow fields on the verdict.
  const issues = rejectionDetails.map((d) => d.error)
  const affectedGoalIds = Array.from(new Set(rejectionDetails.map((d) => d.goal_id).filter((item): item is string => Boolean(item))))
  const seeds = [...input.architectSeeds].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 }
    return rank[a.priority_hint] - rank[b.priority_hint]
  })
  const lines = [
    `# Task ${input.task.id}: "${input.task.title}"`,
    ``,
    renderUserRequestSection({ heading: "## User Request", request: input.task.request, taskID: input.task.id }),
    ``,
    `## This iteration: ${input.iteration}`,
    `- prior iterations: ${input.priorIterationCount}`,
    `- current-iteration metric_result rows: ${input.currentResultCount}`,
    `- open counterexamples before you run: ${input.openCounterexampleCount}`,
    ``,
    `## Defender acceptance verdict — advisory, not authoritative`,
    `verdict=${input.defenderVerdict.verdict}`,
    `summary: ${input.defenderVerdict.summary}`,
    issues.length > 0 ? `\nissues (${issues.length}):` : "",
    ...issues.map((i) => `- ${i}`),
    affectedGoalIds.length > 0
      ? `\naffected_goal_ids: ${affectedGoalIds.join(", ")}`
      : "",
    rejectionDetails.length > 0 ? `\nrejection_details (${rejectionDetails.length}):` : "",
    ...rejectionDetails.map(
      (d) => {
        const scope = d.goal_id ?? "task-scope"
        return `- [${scope} ${d.category}${d.file ? ` ${d.file}` : ""}] ${d.error}${d.suggestion ? ` → ${d.suggestion}` : ""}`
      },
    ),
  ]
  if (seeds.length > 0) {
    lines.push(``, `## Architect priors (challenge seeds)`)
    lines.push(
      `These are risk hypotheses the Architect flagged up front. The Prosecutor`,
      `treats them as pointers — if the evidence supports one, file a concrete`,
      `counterexample using mark_counterexample (novelty_hash auto-dedups across`,
      `iterations). If the evidence refutes one, ignore it. You are not obligated`,
      `to exercise every seed — they're suggestions, not requirements.`,
      ``,
    )
    for (const s of seeds) {
      lines.push(
        `- [${s.priority_hint}/${s.scope}:${s.target_ref}] (${s.id}) ${s.claim}`,
        `    rationale: ${s.rationale}`,
      )
    }
  }
  lines.push(
    ``,
    `## Delegation`,
    `Orchestrator is asking prosecutor to look for at most one concrete counterexample`,
    `the Defender missed, or at most one diagnostic challenge metric if the current`,
    `ruler is blind to a real failure mode.`,
    `When in doubt, write nothing — "no new signal this iteration" is a valid outcome.`,
  )
  return lines.filter((l) => l !== "").join("\n")
}
