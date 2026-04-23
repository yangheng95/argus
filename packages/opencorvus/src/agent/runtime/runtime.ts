/**
 * AgentRuntime — single entry point that every agent (requirements, architect,
 * design-analyst, planner/per-goal, delivery, orchestrator) runs through.
 *
 * Responsibilities, previously duplicated across 7 files:
 *
 *   1. Build the session-hooks that persist stream output, with a shared
 *      failure tracker so side-effect failures are visible to the agent.
 *   2. Call `ProviderLLM.stream(...)` + await `stream.text/steps/finishReason`.
 *   3. After the stream resolves (or aborts), consult the failure tracker:
 *      honour `failurePolicy: "throw" | "collect"`.
 *
 * Non-goals:
 *
 *   - Does NOT own tool wiring, system prompts, or result collection — each
 *     agent keeps its specialized output assembly (design analysis layout,
 *     requirements goal synthesis, plan file writes, etc.).
 *   - Does NOT replace `ProviderLLM.stream`; it composes it.
 */
import { ProviderLLM } from "@/provider/llm"
import type { ToolSet, ModelMessage } from "ai"
import type { Provider } from "@/provider/provider"
import { sessionStreamHooks } from "./session-hooks"
import type { SessionStreamHooks } from "./session-hooks"
import { AgentStreamFailureError, createStreamFailureTracker } from "./stream-failures"
import type { StreamFailureSnapshot } from "./stream-failures"

export namespace AgentRuntime {
  /** How the runtime responds to accumulated stream failures after the run.
   *  "throw" is the default and matches CLAUDE.md rule #1: failures must
   *  never be silently swallowed. "collect" is reserved for the orchestrator
   *  root orchestrator, which has its own policy for handling child failures. */
  export type FailurePolicy = "throw" | "collect"

  export interface Policies {
    failurePolicy?: FailurePolicy
  }

  export interface RunInput<TOOLS extends ToolSet> {
    /** Human-readable label used in errors, logs, traces. */
    agent: string
    model: Provider.Model
    system: string | string[]
    messages: ModelMessage[]
    tools: TOOLS
    toolChoice?: "auto" | "required" | "none"
    stopWhen?: unknown
    cacheKey?: string
    /** Session that persists assistant messages / tool parts. */
    sessionID: string
    taskID?: string
    /** Role/stage tag used by the session-hooks (e.g. "goal", "planner"). */
    stage?: string
    /** Upstream abort signal; will be composed with the guard's signal. */
    signal?: AbortSignal
    /** Invoked on every step-finish — the strongest "progress" signal we get
     *  from AI SDK. */
    onStepFinish?: (step: unknown) => void | Promise<void>
    /** Pipe stream chunks up to a parent agent (nested streams, e.g.
     *  orchestrator observing a design-analyst run). */
    forwardChunk?: (arg: { chunk: any }) => void | Promise<void>
    /** Optional override for the session hooks — advanced callers (tests
     *  or gateway/sub-agent bridges) may supply their own to inject a shared
     *  tracker. */
    hooks?: SessionStreamHooks
    policies: Policies
  }

  export interface RunResult {
    text: string
    steps: any[]
    finishReason: any
    toolCallCount: number
    failures: StreamFailureSnapshot
  }

  export async function run<TOOLS extends ToolSet>(input: RunInput<TOOLS>): Promise<RunResult> {
    const failurePolicy = input.policies.failurePolicy ?? "throw"

    const failures = createStreamFailureTracker()
    const hooks: SessionStreamHooks = input.hooks ?? sessionStreamHooks({
      sessionID: input.sessionID,
      taskID: input.taskID ?? "",
      stage: input.stage,
      failures,
    })

    const composedOnChunk = async (arg: any) => {
      await hooks.onChunk?.(arg)
      if (input.forwardChunk) await input.forwardChunk(arg)
    }

    const stream = await ProviderLLM.stream({
      model: input.model,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      toolChoice: input.toolChoice,
      ...(input.signal ? { abortSignal: input.signal } : {}),
      ...(input.stopWhen ? { stopWhen: input.stopWhen } : {}),
      cacheKey: input.cacheKey,
      onChunk: composedOnChunk,
      onError: hooks.onError,
      onStepFinish: (step: unknown) => input.onStepFinish?.(step),
    })

    let text: string, steps: any[], finishReason: any
    try {
      ;[text, steps, finishReason] = await Promise.all([
        stream.text,
        stream.steps,
        stream.finishReason,
      ])
    } finally {
      await hooks.flush()
    }

    // AI SDK delivers `tool-error` content parts only via `stream.steps`
    // (never through onChunk, see AI SDK v5 StreamTextOnChunkCallback).
    // Tool-error means inputSchema (Zod) rejected the model's tool call —
    // the SDK has ALREADY fed the validation error back to the model as
    // the tool's result, so the model sees it on the next step and can
    // self-correct. We record it with `tool-input-validation` kind so
    // downstream policy (orchestrator critical filter) keeps the task
    // running; step-cap bounds unrecoverable loops, so this is NOT a
    // silent fallback.
    for (const step of steps) {
      const content = Array.isArray((step as any).content) ? (step as any).content : []
      for (const part of content) {
        if (part?.type === "tool-error") {
          failures.record({
            kind: "tool-input-validation",
            reason: part.error instanceof Error ? part.error.message : String(part.error ?? "tool-error"),
            chunkType: "tool-error",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            raw: part.input,
          })
        }
      }
    }

    const hooksSnap = hooks.failures.snapshot()
    const runtimeSnap = failures.snapshot()
    const mergedSnapshot: StreamFailureSnapshot = hooksSnap === runtimeSnap
      ? hooksSnap
      : {
          count: hooksSnap.count + runtimeSnap.count,
          items: [...hooksSnap.items, ...runtimeSnap.items],
        }

    if (failurePolicy === "throw" && mergedSnapshot.count > 0) {
      throw new AgentStreamFailureError(input.agent, mergedSnapshot)
    }

    const toolCallCount = steps.reduce(
      (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
      0,
    )

    return {
      text,
      steps,
      finishReason,
      toolCallCount,
      failures: mergedSnapshot,
    }
  }
}
