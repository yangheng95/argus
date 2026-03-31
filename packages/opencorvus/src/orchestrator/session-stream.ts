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
  const toolParts = new Map<string, Message.ToolPart>()

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
          const existing = toolParts.get(chunk.toolCallId)
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
      if (!messageID || !textPartID || !textAccumulated) return
      try {
        await Session.updatePart({
          id: textPartID,
          messageID,
          sessionID: input.sessionID,
          type: "text",
          text: textAccumulated,
        } as Message.TextPart)
        log.info("session-stream flushed", {
          sessionID: input.sessionID,
          partID: textPartID,
          chars: textAccumulated.length,
        })
      } catch (err) {
        log.warn("session-stream flush failed", {
          sessionID: input.sessionID,
          error: String(err),
        })
      }
    },
  }
}
