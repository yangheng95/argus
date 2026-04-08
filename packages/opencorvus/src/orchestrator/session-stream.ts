/**
 * Session-stream adapter — routes AI SDK stream events into the session/message
 * system so that spec/planner/delivery agent output is persisted and delivered
 * via the standard message.part.* SSE path.
 *
 * Replaces the fire-and-forget agent-stream for content events.
 * Agent-stream is kept only for lightweight status events (start/finish/error).
 */
import type { TextHooks } from "@/llm/api"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"

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
  input: unknown,
): { inputID?: string; part?: Message.ToolPart } {
  const direct = toolParts.get(toolCallID)
  if (direct) return { inputID: toolCallID, part: direct }

  const pending = [...toolParts.entries()].filter(([, part]) =>
    part.tool === toolName && part.state?.status === "pending",
  )
  if (pending.length === 0) return {}

  const normalizedInput = record(input) ? stableStringify(input) : ""
  if (normalizedInput) {
    const exact = pending.find(([, part]) => stableStringify(pendingToolInput(part) ?? {}) === normalizedInput)
    if (exact) return { inputID: exact[0], part: exact[1] }
  }

  if (pending.length === 1) {
    return { inputID: pending[0][0], part: pending[0][1] }
  }

  return {}
}

/**
 * Create TextHooks that write streaming content (text deltas, tool calls,
 * tool results) into a session as Message parts.
 *
 * Events are persisted to DB and published via Bus → SSE automatically
 * through Session.updatePart / Session.updatePartDelta.
 */
export type SessionStreamHooks = TextHooks & {
  /** Flush accumulated text to DB. Must be called after stream ends. */
  flush(): Promise<void>
}

export function sessionStreamHooks(input: {
  sessionID: string
  taskID: string
  stage?: string
}): SessionStreamHooks {
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

  return {
    onChunk: async ({ chunk }: { chunk: any }) => {
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
          // Persist accumulated text before switching to tool
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
          // Pause text accumulation — next text-delta after tools should create a new part
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
          const msgID = await ensureMessage()
          const resolved = resolvePendingToolPart(toolParts, chunk.toolName, chunk.toolCallId, chunk.input)
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
              input: chunk.input ?? {},
              time: { start: Date.now() },
            },
          } as Message.ToolPart)
          toolParts.set(chunk.toolCallId, part as Message.ToolPart)
          return
        }

        if (chunk.type === "tool-result") {
          const existing = toolParts.get(chunk.toolCallId)
          if (!existing) return
          // chunk.output is the tool execute() return value: { output: string, title: string, metadata: object }
          // Extract properties matching SessionProcessor's handling of tool-result
          const toolOutput = chunk.output
          const outputStr = typeof toolOutput === "string"
            ? toolOutput
            : toolOutput && typeof toolOutput === "object" && "output" in toolOutput
              ? String((toolOutput as any).output ?? "")
              : toolOutput != null ? JSON.stringify(toolOutput) : ""
          const title = toolOutput && typeof toolOutput === "object" && "title" in toolOutput
            ? String((toolOutput as any).title ?? "")
            : (chunk.toolName ?? existing.tool)
          const metadata = toolOutput && typeof toolOutput === "object" && "metadata" in toolOutput
            ? ((toolOutput as any).metadata ?? {})
            : {}
          await Session.updatePart({
            ...existing,
            state: {
              status: "completed",
              input: chunk.input ?? existing.state?.input ?? {},
              output: outputStr,
              title,
              metadata,
              time: {
                start: (existing.state as any)?.time?.start ?? Date.now(),
                end: Date.now(),
              },
            },
          } as Message.ToolPart)
          toolParts.delete(chunk.toolCallId)
          // Clean up id mapping
          for (const [k, v] of inputIdToCallId) {
            if (v === chunk.toolCallId) { inputIdToCallId.delete(k); break }
          }
          // When all parallel tools complete, start a new message for the next step.
          // This splits each agent invocation into per-step messages so the overlay
          // can render them as separate timeline cards.
          if (toolParts.size === 0) {
            messageID = undefined
            textPartID = undefined
            reasoningPartID = undefined
          }
          return
        }
      } catch (err) {
        log.warn("session-stream onChunk failed", {
          type: chunk?.type,
          sessionID: input.sessionID,
          error: String(err),
        })
      }
    },
    onError: async ({ error }: { error: unknown }) => {
      log.warn("session-stream onError", {
        sessionID: input.sessionID,
        error: String(error),
      })
    },
    async flush() {
      // Flush accumulated reasoning
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
          log.warn("session-stream flush reasoning failed", {
            sessionID: input.sessionID,
            error: String(err),
          })
        }
      }
      // Flush accumulated text
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
          log.warn("session-stream flush text failed", {
            sessionID: input.sessionID,
            error: String(err),
          })
        }
      }
      // Finalize any tool parts still in running/pending state
      // (e.g. stream ended or agent aborted before tool-result chunk arrived)
      for (const [, part] of toolParts) {
        const currentState = part.state && typeof part.state === "object" ? part.state : {} as Record<string, unknown>
        const status = (currentState as any).status
        if (status === "running" || status === "pending" || !status) {
          try {
            await Session.updatePart({
              ...part,
              state: {
                ...currentState,
                status: "completed",
                output: (currentState as any).output ?? "",
                time: {
                  start: (currentState as any).time?.start ?? Date.now(),
                  end: Date.now(),
                },
              },
            } as Message.ToolPart)
          } catch (err) {
            log.warn("session-stream flush tool part failed", {
              sessionID: input.sessionID,
              partID: part.id,
              error: String(err),
            })
          }
        }
      }
      toolParts.clear()
    },
  }
}
