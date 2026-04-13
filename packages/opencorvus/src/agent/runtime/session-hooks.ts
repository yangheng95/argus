/**
 * Session stream hooks — route AI SDK onChunk events into the session/message
 * persistence layer. Replaces the old `src/orchestrator/session-stream.ts`
 * implementation (which is now a thin re-export wrapper).
 *
 * Behavioural changes vs. the old implementation:
 *
 *   - tool-call `chunk.input` is normalized at the protocol boundary
 *     (`protocol-norm.ts`). A non-object that cannot be JSON-decoded to an
 *     object no longer throws inside Zod — it is persisted as an explicit
 *     `status: "error"` tool part, and recorded in the failure tracker.
 *     This makes the overlay show the failure and lets AgentRuntime fail
 *     the run instead of silently looping.
 *
 *   - Every thrown exception inside an onChunk handler is recorded on the
 *     tracker rather than swallowed into a WARN log. The try/catch is still
 *     there so one bad chunk does not take down the whole stream, but the
 *     agent sees the failure at the end via `.failures.snapshot()`.
 *
 *   - The hook object now exposes `.failures.snapshot()` so AgentRuntime can
 *     honour its `failurePolicy` setting.
 *
 *   - Per-chunk progress/alive signalling is delegated to a ProgressGuard
 *     when one is supplied — see `AgentRuntime.run`.
 */
import type { TextHooks } from "@/llm/api"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { normalizeToolInput, normalizeToolOutput } from "./protocol-norm"
import type { StreamFailureTracker, StreamFailureSnapshot } from "./stream-failures"
import { createStreamFailureTracker } from "./stream-failures"
import type { ProgressGuard } from "./progress-guard"

const log = Log.create({ service: "session-stream" })

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value == null) return "null"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }
  if (!record(value)) return JSON.stringify(String(value))
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`
}

function pendingToolInput(part: Message.ToolPart): Record<string, unknown> | undefined {
  if (part.state.status !== "pending") return undefined
  const raw = typeof part.state.raw === "string" ? part.state.raw.trim() : ""
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return record(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function resolvePendingToolPart(
  toolParts: Map<string, Message.ToolPart>,
  toolName: string,
  toolCallID: string,
  input: Record<string, unknown>,
): { inputID?: string; part?: Message.ToolPart } {
  const direct = toolParts.get(toolCallID)
  if (direct) return { inputID: toolCallID, part: direct }

  const pending = [...toolParts.entries()].filter(([, part]) =>
    part.tool === toolName && part.state?.status === "pending",
  )
  if (pending.length === 0) return {}

  const normalizedInput = stableStringify(input)
  if (normalizedInput !== "{}") {
    const exact = pending.find(([, part]) => stableStringify(pendingToolInput(part) ?? {}) === normalizedInput)
    if (exact) return { inputID: exact[0], part: exact[1] }
  }

  if (pending.length === 1) {
    return { inputID: pending[0][0], part: pending[0][1] }
  }

  return {}
}

export type SessionStreamHooks = TextHooks & {
  /** Flush accumulated text / tool parts to DB. Must be called after stream
   *  ends, regardless of success/abort path (put this in a `finally`). */
  flush(): Promise<void>
  /** Inspect whatever failures piled up during the stream. AgentRuntime uses
   *  this to decide whether to throw vs. return the snapshot. */
  failures: {
    snapshot(): StreamFailureSnapshot
  }
}

export interface SessionStreamHooksInput {
  sessionID: string
  taskID: string
  stage?: string
  /** Optional guard to ping on every chunk (alive) and on semantic progress
   *  chunks (progress). AgentRuntime owns the guard; callers who only want
   *  persistence can omit this. */
  guard?: ProgressGuard
  /** Inject a caller-provided tracker to merge with other sources (e.g.
   *  runtime-level failures). Defaults to a fresh tracker. */
  failures?: StreamFailureTracker
}

export function sessionStreamHooks(input: SessionStreamHooksInput): SessionStreamHooks {
  const failures = input.failures ?? createStreamFailureTracker()
  let messageID: string | undefined
  let textPartID: string | undefined
  let textAccumulated = ""
  let reasoningPartID: string | undefined
  let reasoningAccumulated = ""
  const toolParts = new Map<string, Message.ToolPart>()
  // AI SDK uses `chunk.id` for tool-input-* events and `chunk.toolCallId` for
  // tool-call/tool-result events. These may differ, so we maintain a mapping
  // from input-phase id → call-phase toolCallId to unify lookups.
  const inputIdToCallId = new Map<string, string>()

  async function ensureMessage() {
    if (messageID) return messageID
    const id = Identifier.ascending("message")
    const now = Date.now()
    await Session.updateMessage({
      id,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: now },
      parentID: "",
      modelID: "agent",
      providerID: "agent",
      mode: "agent",
      agent: input.stage || "agent",
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    } as Message.Assistant)
    messageID = id
    return id
  }

  async function persistErrorToolPart(opts: {
    toolName: string
    toolCallId: string
    error: string
    input: Record<string, unknown>
    existing?: Message.ToolPart
  }) {
    const msgID = await ensureMessage()
    const partID = opts.existing?.id ?? Identifier.ascending("part")
    const now = Date.now()
    await Session.updatePart({
      ...(opts.existing ?? {}),
      id: partID,
      messageID: msgID,
      sessionID: input.sessionID,
      type: "tool",
      tool: opts.toolName,
      callID: opts.toolCallId,
      state: {
        status: "error",
        input: opts.input,
        error: opts.error,
        time: {
          start: (opts.existing?.state as any)?.time?.start ?? now,
          end: now,
        },
      },
    } as Message.ToolPart)
    toolParts.delete(opts.toolCallId)
  }

  return {
    onChunk: async ({ chunk }: { chunk: any }) => {
      input.guard?.alive()
      try {
        if (chunk.type === "text-delta") {
          if (!chunk.text) return
          const msgID = await ensureMessage()
          if (!textPartID) {
            const id = Identifier.ascending("part")
            await Session.updatePart({
              id,
              messageID: msgID,
              sessionID: input.sessionID,
              type: "text",
              text: "",
            } as Message.TextPart)
            textPartID = id
          }
          textAccumulated += chunk.text
          await Session.updatePartDelta({
            sessionID: input.sessionID,
            messageID: msgID,
            partID: textPartID,
            field: "text",
            delta: chunk.text,
          })
          return
        }

        if (chunk.type === "reasoning-delta") {
          if (!chunk.text) return
          const msgID = await ensureMessage()
          if (!reasoningPartID) {
            const id = Identifier.ascending("part")
            await Session.updatePart({
              id,
              messageID: msgID,
              sessionID: input.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
            } as Message.ReasoningPart)
            reasoningPartID = id
          }
          reasoningAccumulated += chunk.text
          await Session.updatePartDelta({
            sessionID: input.sessionID,
            messageID: msgID,
            partID: reasoningPartID,
            field: "text",
            delta: chunk.text,
          })
          return
        }

        if (chunk.type === "tool-input-start") {
          const msgID = await ensureMessage()
          if (textPartID && textAccumulated) {
            await Session.updatePart({
              id: textPartID,
              messageID: msgID,
              sessionID: input.sessionID,
              type: "text",
              text: textAccumulated,
            } as Message.TextPart)
            textAccumulated = ""
          }
          textPartID = undefined
          const partID = Identifier.ascending("part")
          const part = await Session.updatePart({
            id: partID,
            messageID: msgID,
            sessionID: input.sessionID,
            type: "tool",
            tool: chunk.toolName,
            callID: chunk.id,
            state: {
              status: "pending",
              input: {},
              raw: "",
            },
          } as Message.ToolPart)
          toolParts.set(chunk.id, part as Message.ToolPart)
          return
        }

        if (chunk.type === "tool-input-delta") {
          if (!chunk.delta) return
          const existing = toolParts.get(chunk.id)
          if (existing && existing.state.status === "pending") {
            ;(existing.state as any).raw += chunk.delta
            await Session.updatePartDelta({
              sessionID: input.sessionID,
              messageID: existing.messageID,
              partID: existing.id,
              field: "raw",
              delta: chunk.delta,
            })
          }
          return
        }

        if (chunk.type === "tool-call") {
          input.guard?.progress()
          const norm = normalizeToolInput(chunk.input)
          if (!norm.ok) {
            failures.record({
              kind: "protocol-normalize",
              reason: norm.reason,
              chunkType: "tool-call",
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              raw: norm.raw,
            })
            const existing = toolParts.get(chunk.toolCallId)
              ?? resolvePendingToolPart(toolParts, chunk.toolName, chunk.toolCallId, {}).part
            await persistErrorToolPart({
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              error: norm.reason,
              input: {},
              existing,
            })
            return
          }
          const msgID = await ensureMessage()
          const resolved = resolvePendingToolPart(toolParts, chunk.toolName, chunk.toolCallId, norm.value)
          const existing = resolved.part
          if (resolved.inputID && resolved.inputID !== chunk.toolCallId) {
            inputIdToCallId.set(resolved.inputID, chunk.toolCallId)
            toolParts.delete(resolved.inputID)
          }
          const partID = existing?.id ?? Identifier.ascending("part")
          const part = await Session.updatePart({
            ...(existing ?? {}),
            id: partID,
            messageID: msgID,
            sessionID: input.sessionID,
            type: "tool",
            tool: chunk.toolName,
            callID: chunk.toolCallId,
            state: {
              status: "running",
              input: norm.value,
              time: { start: Date.now() },
            },
          } as Message.ToolPart)
          toolParts.set(chunk.toolCallId, part as Message.ToolPart)
          return
        }

        if (chunk.type === "tool-result") {
          input.guard?.progress()
          const existing = toolParts.get(chunk.toolCallId)
          if (!existing) return
          const inputNorm = normalizeToolInput(chunk.input)
          if (!inputNorm.ok) {
            failures.record({
              kind: "protocol-normalize",
              reason: inputNorm.reason,
              chunkType: "tool-result",
              toolName: chunk.toolName ?? existing.tool,
              toolCallId: chunk.toolCallId,
              raw: inputNorm.raw,
            })
          }
          const fallbackInput = inputNorm.ok
            ? inputNorm.value
            : (record(existing.state?.input) ? existing.state.input : {})
          const out = normalizeToolOutput(chunk.output, chunk.toolName ?? existing.tool)
          await Session.updatePart({
            ...existing,
            state: {
              status: "completed",
              input: fallbackInput,
              output: out.output,
              title: out.title ?? (chunk.toolName ?? existing.tool),
              metadata: out.metadata,
              time: {
                start: (existing.state as any)?.time?.start ?? Date.now(),
                end: Date.now(),
              },
            },
          } as Message.ToolPart)
          toolParts.delete(chunk.toolCallId)
          for (const [k, v] of inputIdToCallId) {
            if (v === chunk.toolCallId) { inputIdToCallId.delete(k); break }
          }
          if (toolParts.size === 0) {
            messageID = undefined
            textPartID = undefined
            reasoningPartID = undefined
          }
          return
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        failures.record({
          kind: "persist-part",
          reason,
          chunkType: chunk?.type,
          toolName: chunk?.toolName,
          toolCallId: chunk?.toolCallId ?? chunk?.id,
        })
        log.warn("session-stream onChunk failed", {
          type: chunk?.type,
          sessionID: input.sessionID,
          error: reason,
        })
      }
    },
    onError: async ({ error }: { error: unknown }) => {
      const reason = error instanceof Error ? error.message : String(error)
      failures.record({ kind: "on-error", reason })
      log.warn("session-stream onError", { sessionID: input.sessionID, error: reason })
    },
    async flush() {
      if (messageID && reasoningPartID && reasoningAccumulated) {
        try {
          await Session.updatePart({
            id: reasoningPartID,
            messageID,
            sessionID: input.sessionID,
            type: "reasoning",
            text: reasoningAccumulated,
            time: { start: Date.now() },
          } as Message.ReasoningPart)
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          failures.record({ kind: "flush", reason, chunkType: "reasoning" })
          log.warn("session-stream flush reasoning failed", { sessionID: input.sessionID, error: reason })
        }
      }
      if (messageID && textPartID && textAccumulated) {
        try {
          await Session.updatePart({
            id: textPartID,
            messageID,
            sessionID: input.sessionID,
            type: "text",
            text: textAccumulated,
          } as Message.TextPart)
          log.info("session-stream flushed text", {
            sessionID: input.sessionID,
            partID: textPartID,
            chars: textAccumulated.length,
          })
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          failures.record({ kind: "flush", reason, chunkType: "text" })
          log.warn("session-stream flush text failed", { sessionID: input.sessionID, error: reason })
        }
      }
      for (const [, part] of toolParts) {
        const currentState = part.state && typeof part.state === "object" ? part.state : {} as Record<string, unknown>
        const status = (currentState as any).status
        if (status === "running" || status === "pending" || !status) {
          try {
            // ToolStateCompleted requires an `input` record. A `pending` part
            // never had one assigned (only a streaming `raw` JSON string), so
            // we recover the parsed args via `pendingToolInput` when possible
            // and fall back to `{}` rather than letting `undefined` leak into
            // Zod's `.parse(...)`.
            const recoveredInput = ((currentState as any).input as Record<string, unknown> | undefined)
              ?? pendingToolInput(part)
              ?? {}
            await Session.updatePart({
              ...part,
              state: {
                ...currentState,
                status: "completed",
                input: recoveredInput,
                output: (currentState as any).output ?? "",
                time: {
                  start: (currentState as any).time?.start ?? Date.now(),
                  end: Date.now(),
                },
              },
            } as Message.ToolPart)
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            failures.record({ kind: "flush", reason, chunkType: "tool", toolCallId: part.callID })
            log.warn("session-stream flush tool part failed", {
              sessionID: input.sessionID,
              partID: part.id,
              error: reason,
            })
          }
        }
      }
      toolParts.clear()
    },
    failures: {
      snapshot: () => failures.snapshot(),
    },
  }
}
