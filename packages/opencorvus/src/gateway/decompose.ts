/**
 * Gateway requirement decomposition.
 *
 * One-shot, stateless LLM call that turns a free-text "big requirement"
 * into a structured proposal of small task candidates. This is a
 * preview only — no engine_task / engine_session row is written here.
 * The caller (Gateway page) presents the proposal to the operator,
 * who selects which candidates to actually create via the existing
 * `EngineService.createTask` path.
 *
 * Design choices:
 *
 * - **Stateless**: uses the bare `streamText` helper, not
 *   `runAgentSession`. The runner is the right tool for worker agents
 *   that need a persisted child session, structured trace, skill
 *   injection, and recoverable abort handling. None of that is needed
 *   for an idempotent preview that never persists. (rule 6 — don't
 *   over-engineer; rule 9 — keep abstractions where they earn rent.)
 *
 * - **Structured output**: uses `Output.object({ schema })` so the
 *   model returns a fully typed payload validated against the same
 *   Zod schema the route serialises to clients. No tool-collector
 *   plumbing because there are no incremental side-effects the LLM
 *   needs to record between calls.
 *
 * - **Model resolution**: `resolveAgentModel("gateway-decompose")`
 *   falls through to the project default `model` in opencorvus.jsonc
 *   when no per-agent override is configured. Operators who want a
 *   cheaper model just set `agent.gateway-decompose.model`.
 *
 * - **No fallback**: errors propagate to the route which surfaces a
 *   500 with the exact message; the Gateway UI then renders the
 *   server message. (rule 7.)
 */

import { streamText } from "@/llm/api"
import { Output, type ModelMessage } from "ai"
import z from "zod"
import { resolveAgentModel } from "@/agent/model"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { withStreamActivity } from "@/util/stream-activity"
import crypto from "node:crypto"

const log = Log.create({ service: "gateway.decompose" })

// Idle-timeout instead of wall-clock: a legitimately long decomposition
// stream should keep going as long as it's actually emitting tokens.
// 30 s without a single chunk is unambiguous staleness — the provider
// has stalled or the connection died. (codex review round 2 P2 —
// pre-fix used a 60s wall-clock cap that killed valid slow streams.)
const DECOMPOSE_IDLE_MS = 30_000

export const GatewayCandidatePriority = z.enum(["critical", "high", "normal", "low"])
export const GatewayCandidateExecutor = z.enum(["opencorvus", "codex", "claude-code"])

export const GatewayTaskCandidate = z.object({
  id: z.string().min(1).describe(
    "Stable within-proposal identifier in snake_case (e.g. \"add_login_route\"). Used by other candidates' `dependencies` lists.",
  ),
  title: z.string().min(1).describe("Imperative, concise task title (≤80 chars)."),
  description: z.string().min(1).describe(
    "Detailed actionable description of the task — what to do and the rough scope.",
  ),
  acceptance: z.array(z.string().min(1)).default([]).describe(
    "Concrete acceptance criteria. Each item is a single observable condition.",
  ),
  priority: GatewayCandidatePriority.describe(
    "Priority bucket. Default to \"normal\"; raise to \"high\" or \"critical\" only when other candidates depend on this one or it's a blocker.",
  ),
  executor: GatewayCandidateExecutor.optional().describe(
    "Optional executor hint. Leave empty unless the task strongly favours a specific executor.",
  ),
  recommended_queue: z.boolean().describe(
    "true = recommended to enter the directory queue (defer to current active task), false = recommended to start immediately.",
  ),
  dependencies: z.array(z.string()).default([]).describe(
    "Within-proposal dependency IDs (must match other candidates' `id` fields). Empty for independent tasks.",
  ),
  risks: z.array(z.string()).default([]).describe(
    "Short risk notes (one per item). Empty when no notable risk.",
  ),
})
export type GatewayTaskCandidate = z.infer<typeof GatewayTaskCandidate>

export const GatewayTaskDecomposition = z.object({
  proposal_id: z.string(),
  requirement: z.string(),
  summary: z.string(),
  tasks: z.array(GatewayTaskCandidate),
})
export type GatewayTaskDecomposition = z.infer<typeof GatewayTaskDecomposition>

const StructuredPayload = z.object({
  summary: z.string().min(1),
  tasks: z.array(GatewayTaskCandidate).min(1),
})

const SYSTEM_PROMPT = [
  "You are the Gateway requirement decomposer for OpenCorvus.",
  "",
  "Input: a natural-language requirement that may span multiple distinct pieces of work.",
  "Output: a list of small task candidates that the operator will review before any task is actually created.",
  "",
  "Hard rules:",
  "1. Decompose into the smallest set of independently executable tasks. Two tasks may share an acceptance criterion but each must be runnable in isolation.",
  "2. Every task gets concrete acceptance criteria — observable conditions, not vague qualities.",
  "3. Each candidate `id` is snake_case and stable; reference it from other candidates' `dependencies`.",
  "4. `dependencies` IDs MUST match an `id` already present in your `tasks` list. Forward references are NOT allowed — list dependencies before they are referenced.",
  "5. If the requirement is small enough to be ONE task, return one candidate — do not invent splits.",
  "6. If the requirement is unclear or under-specified, still propose tasks that capture the operator's intent, but list the ambiguity in the affected candidate's `risks`.",
  "7. Do not invent tasks for code paths the requirement does not call out. Stick to what the operator asked for.",
  "8. Provide a one-line `summary` of the overall proposal.",
  "",
  "Format: a JSON object matching the provided schema. No prose, no markdown, no fences.",
].join("\n")

export interface DecomposeInput {
  requirement: string
  executor?: "opencorvus" | "codex" | "claude-code"
  signal?: AbortSignal
}

/**
 * Validate a list of candidates: every `dependencies[]` entry must be a
 * known candidate `id` declared earlier in the list. Forward references
 * are rejected so the proposal review UI can render dependencies in a
 * stable left-to-right order (PRD §18 unit test — dependency ids must
 * refer to proposed task ids).
 */
export function validateCandidateDependencies(tasks: GatewayTaskCandidate[]): void {
  const knownIDs = new Set<string>()
  for (const task of tasks) {
    for (const dep of task.dependencies ?? []) {
      if (!knownIDs.has(dep)) {
        throw new Error(
          `Gateway decomposition: candidate "${task.id}" depends on "${dep}" which is not a known earlier candidate id. ` +
          `Known ids so far: ${[...knownIDs].join(", ") || "(none)"}.`,
        )
      }
    }
    // Duplicate IDs would silently collapse referenced dependencies onto
    // a single candidate and confuse the proposal review UI. Reject them
    // outright — the LLM's contract is "stable within-proposal id" (codex
    // round-3 P2).
    if (knownIDs.has(task.id)) {
      throw new Error(
        `Gateway decomposition: duplicate candidate id "${task.id}". Each candidate must have a unique within-proposal id.`,
      )
    }
    knownIDs.add(task.id)
  }
}

export async function decomposeRequirement(input: DecomposeInput): Promise<GatewayTaskDecomposition> {
  const requirement = input.requirement.trim()
  if (!requirement) {
    throw new Error("decomposeRequirement: requirement text is required")
  }

  const model = await resolveAgentModel("gateway-decompose")
  const language = await Provider.getLanguage(model)

  const userPreface: string[] = ["# Requirement", "", requirement]
  if (input.executor) {
    userPreface.push("", `# Executor preference`, "", input.executor)
  }

  const messages: ModelMessage[] = [
    { role: "user", content: userPreface.join("\n") },
  ]

  // Combine the caller's signal (client disconnects, explicit abort)
  // with an idle gate that trips after DECOMPOSE_IDLE_MS without a
  // single chunk — the streamText proxy already wires
  // `gate.signal` into the reader so abort propagates cleanly.
  const gate = withStreamActivity({
    idleMs: DECOMPOSE_IDLE_MS,
    signal: input.signal,
    label: "gateway-decompose",
  })

  try {
    const result = streamText({
      model: language,
      system: SYSTEM_PROMPT,
      messages,
      output: Output.object({ schema: StructuredPayload }),
      temperature: 0.2,
      abortSignal: gate.signal,
      // Disable the default 5s LLM-API wall-clock timeout in favour of
      // the chunk-driven activity gate; `false` is the documented opt-out
      // (packages/opencorvus/src/llm/api.ts).
      timeoutMs: false,
    })

    for await (const part of result.fullStream) {
      gate.observe()
      if (part.type === "error") {
        throw part.error instanceof Error ? part.error : new Error(String(part.error))
      }
    }

    const payload = await result.output
    validateCandidateDependencies(payload.tasks)

    // Proposal IDs are transient (not persisted) — a UUID is enough to
    // give the Gateway UI a stable handle for telemetry and to attach the
    // selected candidates to via metadata when tasks are eventually
    // created. No need to enroll a new prefix in `Identifier`.
    const proposalID = `proposal_${crypto.randomUUID()}`
    const out: GatewayTaskDecomposition = {
      proposal_id: proposalID,
      requirement,
      summary: payload.summary,
      tasks: payload.tasks.map((t) => ({
        ...t,
        acceptance: t.acceptance ?? [],
        dependencies: t.dependencies ?? [],
        risks: t.risks ?? [],
      })),
    }
    log.info("decomposed requirement", {
      proposal_id: proposalID,
      requirement_chars: requirement.length,
      candidate_count: out.tasks.length,
    })
    return out
  } finally {
    gate.dispose()
  }
}
