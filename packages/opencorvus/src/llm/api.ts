import {
  streamObject as streamObjectBase,
  streamText as streamTextBase,
  type StreamTextOnChunkCallback,
  type StreamTextOnErrorCallback,
  type StreamTextOnFinishCallback,
  type StreamTextOnStepFinishCallback,
  type StepResult,
  type ToolSet,
} from "ai"

import { Env } from "@/env"
import { abortableIterable } from "@/util/stream-activity"

type StreamTextOnAbortCallback<TOOLS extends ToolSet> = (event: {
  readonly steps: StepResult<TOOLS>[]
}) => PromiseLike<void> | void

export type TextHooks<TOOLS extends ToolSet = ToolSet> = {
  onAbort?: StreamTextOnAbortCallback<TOOLS>
  onChunk?: StreamTextOnChunkCallback<TOOLS>
  onError?: StreamTextOnErrorCallback
  onFinish?: StreamTextOnFinishCallback<TOOLS>
  onStepFinish?: StreamTextOnStepFinishCallback<TOOLS>
}

const DEFAULT_TIMEOUT_MS = 5_000

function timeoutMs(value?: number | false) {
  if (value === false) return undefined
  if (typeof value === "number" && value > 0) return value
  const env = Number.parseInt(Env.get("OPENCORVUS_LLM_TIMEOUT_MS") ?? "", 10)
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS
}

function retries(value?: number) {
  // Retries are now owned by withLLMActivity (packages/opencorvus/src/llm/activity.ts).
  // The AI SDK's `maxRetries` is set to 0 here so the SDK does NOT also retry —
  // double-retry was the cause of confused terminal events / mismatched
  // attempt counters / quota exhaustion noise across the layered retry stack
  // (see specs/new-arch/2026-04-30-llm-activity-redesign.md). The `value`
  // parameter is preserved on the input type for forward-compat but is
  // intentionally ignored — callers that want retries should configure
  // their LLMActivityPolicy.maxRetries instead.
  void value
  return 0
}

function signal(signal?: AbortSignal, timeout?: number | false) {
  const ms = timeoutMs(timeout)
  if (!ms) return signal
  const next = AbortSignal.timeout(ms)
  if (!signal) return next
  return AbortSignal.any([signal, next])
}

export function streamText<TOOLS extends ToolSet = ToolSet>(
  input: Parameters<typeof streamTextBase<TOOLS>>[0] & {
    timeoutMs?: number | false
    retries?: number
  },
) {
  const { timeoutMs: timeout, retries: count, abortSignal, ...rest } = input
  const composed = signal(abortSignal, timeout)
  const result = streamTextBase({
    ...(rest as Parameters<typeof streamTextBase<TOOLS>>[0]),
    abortSignal: composed,
    maxRetries: retries(count),
  })
  // The AI SDK's fullStream/textStream are AsyncIterableStreams whose
  // backing reader.read() can park indefinitely on a stalled upstream
  // socket; the abortSignal closes the connection but does not reject the
  // pending read. Wrap each iterable so consumers' for-await loops throw
  // an AbortError as soon as `composed` flips, no matter what the SDK /
  // Bun fetch reader does internally. Other properties (usage, response,
  // toAIStreamResponse, …) pass through unchanged via Proxy.
  if (!composed) return result
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (prop === "fullStream") return abortableIterable(target.fullStream, composed)
      if (prop === "textStream") return abortableIterable(target.textStream, composed)
      return Reflect.get(target, prop, receiver)
    },
  })
}

export function streamObject(
  input: Parameters<typeof streamObjectBase>[0] & {
    timeoutMs?: number | false
    retries?: number
  },
) {
  const { timeoutMs: timeout, retries: count, abortSignal, ...rest } = input
  const composed = signal(abortSignal, timeout)
  const result = streamObjectBase({
    ...(rest as Parameters<typeof streamObjectBase>[0]),
    abortSignal: composed,
    maxRetries: retries(count),
  })
  if (!composed) return result
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (prop === "partialObjectStream") return abortableIterable(target.partialObjectStream, composed)
      if (prop === "textStream") return abortableIterable(target.textStream, composed)
      if (prop === "elementStream") {
        const v = (target as any).elementStream
        return v ? abortableIterable(v, composed) : v
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
