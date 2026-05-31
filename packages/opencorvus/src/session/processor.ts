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
import { EffectiveConfig } from "@/config/effective"
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
import { toolFailureCauseFromUnknown, type ToolFailureCause } from "./tool-failure-cause"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export class ProcessorLostPartsError extends Error {
    constructor(public readonly partIDs: string[]) {
      super(`SessionProcessor lost open tool parts: ${partIDs.join(", ")}`)
      this.name = "ProcessorLostPartsError"
    }
  }

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: Message.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, Message.ToolPart> = {}
    const toolPartLocks = new Map<string, Promise<void>>()

    const withToolPartLock = async <T>(toolCallID: string, fn: () => Promise<T>): Promise<T> => {
      const previous = toolPartLocks.get(toolCallID)
      let release!: () => void
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      toolPartLocks.set(toolCallID, current)
      try {
        if (previous) await previous.catch(() => {})
        return await fn()
      } finally {
        release()
        if (toolPartLocks.get(toolCallID) === current) toolPartLocks.delete(toolCallID)
      }
    }

    // Resolve the part that already represents `toolCallID` on this assistant
    // message. `toolcalls` only tracks IN-FLIGHT calls â€” the tool-result /
    // tool-error cases delete the entry once a call finishes â€” so a
    // re-delivered tool-call (a provider re-emit, or a retried stream
    // replaying the same response with identical `call_*` ids) finds nothing
    // there, and the handlers below would mint a SECOND part for the same
    // callID. Two parts sharing one callID make `toModelMessages` emit a
    // duplicate provider `tool_call_id`, which the provider rejects with
    // HTTP 400 (`Duplicate value for 'tool_call_id'`). Falling back to the
    // message's persisted parts keeps (messageID, callID) -> exactly one part
    // however many times the call is delivered.
    const priorToolPart = async (toolCallID: string): Promise<Message.ToolPart | undefined> => {
      const warm = toolcalls[toolCallID]
      if (warm) return warm
      const parts = await Message.parts(input.assistantMessage.id)
      return parts.find((p): p is Message.ToolPart => p.type === "tool" && p.callID === toolCallID)
    }

    const openToolParts = async (): Promise<Message.ToolPart[]> => {
      const parts = await Message.parts(input.assistantMessage.id)
      return parts.filter(
        (part): part is Message.ToolPart =>
          part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
      )
    }

    const failToolPart = async (part: Message.ToolPart, failure: ToolFailureCause): Promise<void> => {
      const start = part.state.status === "running" ? part.state.time.start : Date.now()
      await Session.updatePart({
        ...part,
        state: {
          status: "error",
          input: part.state.input,
          failure,
          time: {
            start,
            end: Date.now(),
          },
        },
      })
      delete toolcalls[part.callID]
    }

    const failOpenToolParts = async (failure: ToolFailureCause): Promise<void> => {
      for (const part of await openToolParts()) {
        await failToolPart(part, failure)
      }
    }

    const completeOpenToolPartsWithReflection = async (input: {
      toolName: string
      exceptToolCallID: string
      output: string
      title: string
      metadata: Record<string, unknown>
      attachments?: Message.FilePart[]
    }): Promise<void> => {
      const parts = await openToolParts()
      for (const part of parts) {
        if (part.callID === input.exceptToolCallID || part.tool !== input.toolName) continue
        await withToolPartLock(part.callID, async () => {
          const latest = await priorToolPart(part.callID)
          if (!latest || (latest.state.status !== "running" && latest.state.status !== "pending")) return
          await Session.updatePart({
            ...latest,
            state: {
              status: "completed",
              input: latest.state.input,
              output: input.output,
              title: input.title,
              metadata: input.metadata,
              attachments: input.attachments,
              time: {
                start: latest.state.status === "running" ? latest.state.time.start : Date.now(),
                end: Date.now(),
              },
            },
          })
          delete toolcalls[part.callID]
        })
      }
    }

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
      async ensureToolPart(toolCallID: string, toolName: string, toolInput: Record<string, unknown>) {
        return withToolPartLock(toolCallID, async () => {
          const existing = await priorToolPart(toolCallID)
          const start =
            existing?.type === "tool" && existing.state.status === "running"
              ? existing.state.time.start
              : Date.now()
          const part = await Session.updatePart({
            ...(existing ?? {
              id: Identifier.ascending("part"),
              messageID: input.assistantMessage.id,
              sessionID: input.assistantMessage.sessionID,
              type: "tool" as const,
              callID: toolCallID,
              tool: toolName,
            }),
            tool: toolName,
            callID: toolCallID,
            state: {
              status: "running",
              input: toolInput,
              time: { start },
            },
          })
          toolcalls[toolCallID] = part as Message.ToolPart
          return part as Message.ToolPart
        })
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const shouldBreak =
          (await EffectiveConfig.effective({ sessionID: input.assistantMessage.sessionID })).experimental
            ?.continue_loop_on_deny !== true
        const idleMs = (await EngineConfig.get()).activity.session_llm_idle_ms
        // Activity owns retries (rule 8 â€” single source). The runner's
        // classifier + per-class maxRetries + totalMs deadline replace the
        // session/retry.ts SessionRetry namespace and the outer while-true
        // loop that used to wrap this block. Retries are now invisible to
        // the processor â€” withLLMActivity rethrows LLMActivityError only
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
            let preTerminalInterrupted = false
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
              await streamInput.stream?.onChunk?.({ chunk: value } as never)
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

                case "tool-input-start": {
                  const toolCallID =
                    typeof (value as any).toolCallId === "string"
                      ? (value as any).toolCallId
                      : typeof (value as any).id === "string"
                        ? (value as any).id
                        : ""
                  if (!toolCallID) break
                  const preTerminalReflection = streamInput.preTerminalToolInputStart?.({
                    toolName: value.toolName,
                    toolCallID,
                  })
                  if (preTerminalReflection) {
                    await withToolPartLock(toolCallID, async () => {
                      await Session.updatePart({
                        id: (await priorToolPart(toolCallID))?.id ?? Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.assistantMessage.sessionID,
                        type: "tool",
                        tool: value.toolName,
                        callID: toolCallID,
                        state: {
                          status: "completed",
                          input: {},
                          output: preTerminalReflection.output,
                          title: preTerminalReflection.title,
                          metadata: preTerminalReflection.metadata,
                          time: {
                            start: Date.now(),
                            end: Date.now(),
                          },
                        },
                      })
                    })
                    input.assistantMessage.finish = "tool-calls"
                    preTerminalInterrupted = true
                    return
                  }
                  const part = await withToolPartLock(toolCallID, async () => {
                    return await Session.updatePart({
                      id: (await priorToolPart(toolCallID))?.id ?? Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "tool",
                      tool: value.toolName,
                      callID: toolCallID,
                      state: {
                        status: "pending",
                        input: {},
                        raw: "",
                      },
                    })
                  })
                  toolcalls[toolCallID] = part as Message.ToolPart
                  break
                }

                case "tool-input-delta": {
                  const toolCallID =
                    typeof (value as any).toolCallId === "string"
                      ? (value as any).toolCallId
                      : typeof (value as any).id === "string"
                        ? (value as any).id
                        : ""
                  const delta =
                    typeof (value as any).inputTextDelta === "string"
                      ? (value as any).inputTextDelta
                      : typeof (value as any).delta === "string"
                        ? (value as any).delta
                        : ""
                  if (!toolCallID || !delta) break
                  const match = toolcalls[toolCallID]
                  if (match && match.state.status === "pending") {
                    ;(match.state as any).raw += delta
                    await Session.updatePartDelta({
                      sessionID: match.sessionID,
                      messageID: match.messageID,
                      partID: match.id,
                      field: "raw",
                      delta,
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
                  const part = await withToolPartLock(value.toolCallId, async () => {
                    const match = await priorToolPart(value.toolCallId)
                    return await Session.updatePart({
                      ...(match ?? {
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.assistantMessage.sessionID,
                        type: "tool" as const,
                        callID: value.toolCallId,
                        tool: value.toolName,
                      }),
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start:
                            match?.state.status === "running"
                              ? match.state.time.start
                              : Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
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
                        JSON.stringify(p.state.input) === JSON.stringify(value.input),
                    )

                  if (exactMatch) {
                    const config = await EffectiveConfig.effective({ sessionID: input.assistantMessage.sessionID })
                    const agent = await Agent.get(input.assistantMessage.agent, { config })
                    await PermissionNext.ask({
                      permission: "doom_loop",
                      patterns: [value.toolName],
                      sessionID: input.assistantMessage.sessionID,
                      metadata: {
                        tool: value.toolName,
                        input: value.input,
                      },
                      always: [value.toolName],
                      ruleset: agent.permission ?? [],
                    })
                  }
                  break
                }
                case "tool-result": {
                  // Pair with `run.pause("tool-call")` from tool-call. resume() is a
                  // no-op if the gate isn't paused (e.g. tool-result without
                  // matching tool-call after a recovery), so this is safe to
                  // run unconditionally before the match check.
                  run.resume("tool-call")
                  const metadata = value.output.metadata
                  await withToolPartLock(value.toolCallId, async () => {
                    const match = toolcalls[value.toolCallId] ?? await priorToolPart(value.toolCallId)
                    if (match && (match.state.status === "running" || match.state.status === "pending")) {
                      const resolvedInput = value.input === undefined ? match.state.input : value.input
                      await Session.updatePart({
                        ...match,
                        state: {
                          status: "completed",
                          input: resolvedInput,
                          output: value.output.output,
                          metadata,
                          title: value.output.title,
                          time: {
                            start: match.state.status === "running" ? match.state.time.start : Date.now(),
                            end: Date.now(),
                          },
                          attachments: value.output.attachments,
                        },
                      })
                      delete toolcalls[value.toolCallId]
                    }
                  })
                  if (metadata?.preTerminalReflection === true) {
                    await completeOpenToolPartsWithReflection({
                      toolName: value.toolName,
                      exceptToolCallID: value.toolCallId,
                      output: value.output.output,
                      title: value.output.title,
                      metadata,
                      attachments: value.output.attachments,
                    })
                    input.assistantMessage.finish = "tool-calls"
                    preTerminalInterrupted = true
                  }
                  break
                }

                case "tool-error": {
                  // Pair with `run.pause("tool-call")` from tool-call (errors close the
                  // tool-call window just like results).
                  run.resume("tool-call")
                  await withToolPartLock(value.toolCallId, async () => {
                    const match = toolcalls[value.toolCallId] ?? await priorToolPart(value.toolCallId)
                    if (match && (match.state.status === "running" || match.state.status === "pending")) {
                      const resolvedInput = value.input === undefined ? match.state.input : value.input
                      const classification = (value as { dynamic?: boolean }).dynamic === true
                        ? "tool-input-invalid"
                        : "tool-execution"
                      const failure = toolFailureCauseFromUnknown({
                        error: value.error,
                        originSite: "session.processor.tool-error",
                        classification,
                        kind: classification,
                        data: {
                          toolCallId: value.toolCallId,
                          toolName: value.toolName,
                        },
                      })
                      await Session.updatePart({
                        ...match,
                        state: {
                          status: "error",
                          input: resolvedInput,
                          failure,
                          time: {
                            start: match.state.status === "running" ? match.state.time.start : Date.now(),
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
                  })
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
                  // Accumulate across steps so multi-step messages keep all
                  // tokens (overwrite-only would silently drop earlier steps;
                  // `cost +=` is already cumulative — match it).
                  input.assistantMessage.tokens = {
                    input: input.assistantMessage.tokens.input + usage.tokens.input,
                    output: input.assistantMessage.tokens.output + usage.tokens.output,
                    reasoning: input.assistantMessage.tokens.reasoning + usage.tokens.reasoning,
                    total:
                      (input.assistantMessage.tokens.total ?? 0) +
                      (usage.tokens.total ?? 0),
                    cache: {
                      read: input.assistantMessage.tokens.cache.read + usage.tokens.cache.read,
                      write: input.assistantMessage.tokens.cache.write + usage.tokens.cache.write,
                    },
                  }
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
                    Snapshot.assertPatchEvidenceIntegrity(patch)
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
                  if (
                    await SessionCompaction.isOverflow({
                      tokens: usage.tokens,
                      model: input.model,
                      sessionID: input.assistantMessage.sessionID,
                    })
                  ) {
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
                  await streamInput.stream?.onFinish?.(value as never)
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) break
              if (preTerminalInterrupted) break
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
            await failOpenToolParts(toolFailureCauseFromUnknown({
              error: original,
              originSite: "session.processor.catch",
              classification: "llm-activity",
              kind: "llm-activity-error",
              data: {
                sessionID: input.sessionID,
              },
            }))
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
            try {
              const patch = await Snapshot.patch(snapshot)
              Snapshot.assertPatchEvidenceIntegrity(patch)
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
            } catch (e) {
              input.assistantMessage.error = Message.fromError(e, { providerID: input.model.providerID })
              Bus.publish(Session.Event.Error, {
                sessionID: input.assistantMessage.sessionID,
                error: input.assistantMessage.error,
              })
            }
            snapshot = undefined
          }
          const lostParts = await openToolParts()
          if (lostParts.length > 0) {
            throw new ProcessorLostPartsError(lostParts.map((part) => part.id))
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
