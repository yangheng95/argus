import { Message } from "./message"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { EngineConfig } from "@/engine/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { abortableIterable } from "@/util/stream-activity"
import {
  withLLMActivity,
  chunkHeartbeatKind,
  DefaultLLMActivityPolicy,
  LLMActivityError,
  type LLMActivityEvent,
  type LLMActivityPolicy,
} from "@/llm/activity"
import { normalizeToolInput } from "./tool-input-norm"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: Message.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, Message.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let needsCompaction = false
    // Reasoning delta buffer: aggregate per-token deltas into batched SSE updates
    const reasoningDeltaBuf = new Map<string, string>()
    let reasoningFlushTimer: ReturnType<typeof setTimeout> | null = null

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
        const idleMs = (await EngineConfig.get()).activity.session_llm_idle_ms
        // Activity owns retries (rule 8 — single source). The runner's
        // classifier + per-class maxRetries + totalMs deadline replace the
        // session/retry.ts SessionRetry namespace and the outer while-true
        // loop that used to wrap this block. Retries are now invisible to
        // the processor — withLLMActivity rethrows LLMActivityError only
        // after exhausting its retry budget OR hitting a non-retryable class
        // (client_4xx, request_timeout, payload_too_large, context_overflow).
        // Aborts from the external signal raise LLMActivityAbortedError,
        // also a single-attempt terminal.
        const activityPolicy: LLMActivityPolicy = {
          ...DefaultLLMActivityPolicy,
          idleMs,
        }
        {
          try {
            let currentText: Message.TextPart | undefined
            let reasoningMap: Record<string, Message.ReasoningPart> = {}
            await withLLMActivity(
              {
                sessionID: input.sessionID,
                provider: input.model.providerID,
                model: input.model.id,
              },
              activityPolicy,
              input.abort,
              async (run) => {
            const stream = await LLM.stream({ ...streamInput, abort: run.signal })

            for await (const value of abortableIterable(stream.fullStream, run.signal)) {
              run.bump(chunkHeartbeatKind(value))
              run.signal.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "streaming" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  const reasoningPart = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning" as const,
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  reasoningMap[value.id] = reasoningPart
                  await Session.updatePart(reasoningPart)
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    // Buffer reasoning deltas and flush periodically to avoid
                    // flooding the SSE stream with per-token events.
                    const bufKey = part.id
                    const prev = reasoningDeltaBuf.get(bufKey) || ""
                    reasoningDeltaBuf.set(bufKey, prev + value.text)
                    if (!reasoningFlushTimer) {
                      reasoningFlushTimer = setTimeout(async () => {
                        reasoningFlushTimer = null
                        for (const [pid, buf] of reasoningDeltaBuf) {
                          // Skip deltas that are only brackets/whitespace
                          if (buf.replace(/[\[\]\s]/g, "")) {
                            const rp = Object.values(reasoningMap).find((p: any) => p.id === pid) as any
                            if (rp) {
                              await Session.updatePartDelta({
                                sessionID: rp.sessionID,
                                messageID: rp.messageID,
                                partID: rp.id,
                                field: "text",
                                delta: buf,
                              })
                            }
                          }
                        }
                        reasoningDeltaBuf.clear()
                      }, 200)
                    }
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    // Flush any buffered reasoning delta before closing the part
                    if (reasoningFlushTimer) {
                      clearTimeout(reasoningFlushTimer)
                      reasoningFlushTimer = null
                    }
                    const endPart = reasoningMap[value.id]
                    const remaining = reasoningDeltaBuf.get(endPart.id)
                    if (remaining && remaining.replace(/[\[\]\s]/g, "")) {
                      await Session.updatePartDelta({
                        sessionID: endPart.sessionID,
                        messageID: endPart.messageID,
                        partID: endPart.id,
                        field: "text",
                        delta: remaining,
                      })
                    }
                    reasoningDeltaBuf.delete(endPart.id)

                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as Message.ToolPart
                  break

                case "tool-input-delta": {
                  if (!value.delta) break
                  const match = toolcalls[value.id]
                  if (match && match.state.status === "pending") {
                    ;(match.state as any).raw += value.delta
                    await Session.updatePartDelta({
                      sessionID: match.sessionID,
                      messageID: match.messageID,
                      partID: match.id,
                      field: "raw",
                      delta: value.delta,
                    })
                  }
                  break
                }

                case "tool-input-end":
                  break

                case "tool-call": {
                  // Pause the chunk-driven idle gate while the SDK runs the
                  // tool's `execute`. Long-running tools (build agent ~100-300s,
                  // delivery, architect) hold the LLM stream open without
                  // emitting chunks; the gate's 180s default would false-positive
                  // trip otherwise. Resume on tool-result. Per rule 23 the
                  // pause is scoped to known stream-pause semantics (tool-call
                  // boundary), not a generic disable switch.
                  run.pause("tool-call")
                  // AI SDK contract: tool-call.input is `unknown` — providers
                  // may stream JSON-stringified args. Normalize at this single
                  // boundary so the schema record invariant holds. Symmetric
                  // with the outbound site (message.ts safeToolInput) — see
                  // tool-input-norm.ts header for the original incident.
                  const norm = normalizeToolInput(value.input)
                  if (!norm.ok) {
                    log.warn("malformed tool-call input — skipping part write", {
                      tool: value.toolName,
                      callID: value.toolCallId,
                      reason: norm.reason,
                    })
                    break
                  }
                  const normalizedInput = norm.value
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: normalizedInput,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as Message.ToolPart

                    const parts = await Message.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    const exactMatch =
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(normalizedInput),
                      )

                    if (exactMatch) {
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await PermissionNext.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: normalizedInput,
                        },
                        always: [value.toolName],
                        ruleset: agent.permission ?? [],
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  // Pair with `run.pause("tool-call")` from tool-call. resume() is a
                  // no-op if the gate isn't paused (e.g. tool-result without
                  // matching tool-call after a recovery), so this is safe to
                  // run unconditionally before the match check.
                  run.resume("tool-call")
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    // tool-result echoes the original input; normalize against
                    // the same provider quirk as tool-call. On normalize fail,
                    // the authoritative input lives on the matched ToolPart
                    // (already validated when written at tool-call time).
                    const echo = normalizeToolInput(value.input)
                    const resolvedInput = echo.ok ? echo.value : match.state.input
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: resolvedInput,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  // Pair with `run.pause("tool-call")` from tool-call (errors close the
                  // tool-call window just like results).
                  run.resume("tool-call")
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    const echo = normalizeToolInput(value.input)
                    const resolvedInput = echo.ok ? echo.value : match.state.input
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: resolvedInput,
                        error: (value.error as any).toString(),
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (
                      value.error instanceof PermissionNext.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  input.assistantMessage.finish = value.finishReason
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                    needsCompaction = true
                  }
                  break

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  await Session.updatePart(currentText)
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    await Session.updatePartDelta({
                      sessionID: currentText.sessionID,
                      messageID: currentText.messageID,
                      partID: currentText.id,
                      field: "text",
                      delta: value.text,
                    })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata

                    await Session.updatePart(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
            }
              },
              (event: LLMActivityEvent) => {
                // Translate retry events directly into SessionStatus retry
                // updates. The activity runner is the single source of
                // truth for "I tried, hit a transient class, will retry
                // after backoffMs"; the overlay's spinner reads exactly
                // these SessionStatus retry events.
                if (event.type === "retry") {
                  SessionStatus.set(input.sessionID, {
                    type: "retry",
                    attempt: event.attempt,
                    message: `${event.cls}: backoff ${event.backoffMs}ms`,
                    next: event.ts + event.backoffMs,
                  })
                  return
                }
                if (event.type === "terminal") {
                  log.debug("activity terminal", {
                    activityID: event.id,
                    outcome: event.outcome,
                    cls: event.cls,
                  })
                }
              },
            )
          } catch (e: any) {
            // withLLMActivity rethrows LLMActivityError only after exhausting
            // its retry budget or hitting a non-retryable class (or as
            // LLMActivityAbortedError on external_abort). The processor sees
            // the underlying cause shape; map to Message.fromError / handle
            // ContextOverflowError as a special-case compaction trigger;
            // anything else terminates the processor turn with the error
            // attached to the assistant message.
            const original =
              e instanceof LLMActivityError ? (e.cause ?? e) : e
            log.error("process", {
              error: original,
              stack: JSON.stringify((original as { stack?: unknown })?.stack),
            })
            const error = Message.fromError(original, { providerID: input.model.providerID })
            if (Message.ContextOverflowError.isInstance(error)) {
              needsCompaction = true
            } else {
              input.assistantMessage.error = error
              Bus.publish(Session.Event.Error, {
                sessionID: input.assistantMessage.sessionID,
                error: input.assistantMessage.error,
              })
              SessionStatus.set(input.sessionID, { type: "idle" })
            }
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await Message.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
