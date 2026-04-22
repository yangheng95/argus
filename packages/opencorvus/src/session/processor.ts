import { Message } from "./message"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  // Starvation = inactivity watchdog in LLM.stream tripped mid-stream. Retry
  // is only safe when no tool has executed this turn (tool side effects are
  // not replayable). Bounded so a wedged provider cannot retry forever before
  // the parent executor's 90s watchdog kills the goal_run.
  const MAX_STARVATION_RETRIES = 2
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
    let attempt = 0
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
        let starvationAttempt = 0
        let stream: LLM.StreamResult | undefined
        // Snapshot of the tail part id at the start of each iteration.
        // On starvation retry, we remove every part with id > tailPartID so
        // the next streamText call emits into a clean tail rather than piling
        // new deltas on top of the aborted turn's partial parts.
        let tailPartID: string | undefined
        // Flipped true as soon as a tool-result is persisted this turn. Tool
        // side effects are not replayable (files written, commands run), so
        // starvation retry is disabled once any tool has executed.
        let toolExecutedThisTurn = false
        while (true) {
          try {
            const partsBefore = await Message.parts(input.assistantMessage.id)
            tailPartID = partsBefore.length ? partsBefore[partsBefore.length - 1].id : undefined
            toolExecutedThisTurn = false
            let currentText: Message.TextPart | undefined
            let reasoningMap: Record<string, Message.ReasoningPart> = {}
            stream = await LLM.stream(streamInput)
            const pauseInactivity = stream.pauseInactivityTimer
            const resumeInactivity = stream.resumeInactivityTimer

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
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
                  // Tool execution starts — pause stream inactivity timer
                  // because tools (bash, bun test, etc.) can run for minutes
                  // without producing LLM tokens.
                  pauseInactivity?.()
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
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
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )

                    if (exactMatch) {
                      const agent = await Agent.get(input.assistantMessage.agent)
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
                  }
                  break
                }
                case "tool-result": {
                  // Tool execution completed — resume stream inactivity timer
                  resumeInactivity?.()
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
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

                    // Tool side effects have landed — starvation retry is no
                    // longer safe for this turn (rollback would replay tools).
                    toolExecutedThisTurn = true
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  resumeInactivity?.()
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
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
                    // Tool ran (produced error after side effects possibly
                    // taken) — same starvation-retry guard as tool-result.
                    toolExecutedThisTurn = true
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
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            // Starvation retry: the inactivity watchdog in LLM.stream tripped
            // and the abort propagated out of fullStream. Safe to replay only
            // when no tool has run this turn (tools are not idempotent). We
            // remove every part emitted since `tailPartID` (the snapshot taken
            // at the top of this iteration), reset per-turn tracking state,
            // and fall through to `continue` so the next while-iteration
            // re-invokes LLM.stream with the same streamInput.
            const starved = stream?.isStarvation?.() === true
            if (starved && !toolExecutedThisTurn && starvationAttempt < MAX_STARVATION_RETRIES) {
              starvationAttempt++
              const parts = await Message.parts(input.assistantMessage.id)
              const stale = tailPartID ? parts.filter((p) => p.id > tailPartID!) : parts
              for (const part of stale) {
                await Session.removePart({
                  sessionID: input.sessionID,
                  messageID: input.assistantMessage.id,
                  partID: part.id,
                })
              }
              // Reset per-turn tracking: reasoning/tool dicts, snapshot ref,
              // buffered reasoning deltas. currentText is block-scoped inside
              // the try so it's already cleared.
              for (const k of Object.keys(toolcalls)) delete toolcalls[k]
              reasoningDeltaBuf.clear()
              if (reasoningFlushTimer) {
                clearTimeout(reasoningFlushTimer)
                reasoningFlushTimer = null
              }
              snapshot = undefined
              const delay = SessionRetry.delay(starvationAttempt)
              log.warn("stream starvation — rolling back partial parts and retrying", {
                sessionID: input.sessionID,
                messageID: input.assistantMessage.id,
                attempt: starvationAttempt,
                rolledBackParts: stale.length,
                delayMs: delay,
              })
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt: starvationAttempt,
                message: "LLM stream stalled — retrying",
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch((err) => {
                log.debug("starvation retry sleep aborted or failed", { error: String(err) })
              })
              continue
            }
            const error = Message.fromError(e, { providerID: input.model.providerID })
            if (Message.ContextOverflowError.isInstance(error)) {
              needsCompaction = true
              break
            }
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch((err) => {
                log.debug("retry sleep aborted or failed", { error: String(err) })
              })
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
            SessionStatus.set(input.sessionID, { type: "idle" })
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
