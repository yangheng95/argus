/**
 * Gateway agent — LLM-driven dispatcher for user dialog.
 *
 * Each `handleMessage` call:
 *   1. Resolves the gateway session for `channelKey` (race-safe singleton).
 *   2. Persists the incoming user message to that session.
 *   3. Loads recent history and feeds it to AgentRuntime alongside the gateway
 *      tools (list/get/cancel/enqueue/dispatch/forward_clarification/switch_cwd).
 *   4. AgentRuntime's session hooks persist the assistant reply + tool parts.
 *
 * The agent itself contains no routing logic — all decisions live in the
 * system prompt + tool descriptions. The runtime is a pure passthrough.
 */

import { stepCountIs } from "ai"
import path from "path"
import { AgentRuntime } from "@/agent/runtime"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { Message } from "@/session/message"
import { Agent } from "@/agent/agent"
import { Log } from "@/util/log"
import { OrchestratorTaskActor } from "@/orchestrator/task-actor"
import { ensureGatewaySession } from "./session"
import { readCwd } from "./cwd-state"
import { createGatewayTools } from "./tools"

import GATEWAY_SYSTEM from "./prompt/system.txt"

const log = Log.create({ service: "gateway" })

const MAX_STEPS = 8
const PROGRESS_TIMEOUT_MS = 60_000
const HISTORY_LIMIT = 40

export namespace Gateway {
  export interface HandleInput {
    /** Composite channel identity from `channelKey(...)`. */
    channelKey: string
    /** Default cwd to seed a fresh gateway session and to use for tool calls
     *  that omit an explicit cwd. Required because the Gateway has no
     *  ambient project context — it lives at the daemon layer. */
    defaultCwd: string
    /** Plain text from the user. */
    text: string
    /** Optional binding for the originating thread (Slack/Discord/etc).
     *  When supplied, any task this turn enqueues will be bound to the
     *  same (platform, channel, thread) so subsequent ingress messages
     *  on that thread find the binding instead of creating a new task. */
    channelBinding?: {
      platform: string
      channel: string
      thread: string
      payload?: Record<string, unknown>
    }
    signal?: AbortSignal
  }

  export interface HandleResult {
    sessionID: string
    /** Assistant reply text (empty when the LLM only emitted tool calls). */
    text: string
    /** Number of tool calls invoked during this turn. */
    toolCalls: number
  }

  export async function handleMessage(input: HandleInput): Promise<HandleResult> {
    // Per-channelKey serialization — concurrent turns from the same channel
    // would otherwise race on history loading and assistant-message
    // persistence inside the same gateway session. The actor key namespace
    // (`gateway:`) keeps us out of OrchestratorTaskActor's task-id space.
    return Instance.provide({
      directory: input.defaultCwd,
      fn: () =>
        OrchestratorTaskActor.submit(`gateway:${input.channelKey}`, () =>
          handleMessageInner(input),
        ),
    })
  }

  async function handleMessageInner(input: HandleInput): Promise<HandleResult> {
    if (!input.text.trim()) throw new Error("Gateway.handleMessage: empty text")

    const session = await ensureGatewaySession({
      channelKey: input.channelKey,
      defaultCwd: input.defaultCwd,
    })
    const cwd = readCwd(session) ?? input.defaultCwd

    // Persist incoming user message before the LLM call so it shows up in the
    // dialog stream regardless of whether the run later aborts.
    const agentName = await Agent.defaultAgent()
    const def = await Provider.defaultModel()
    const model = await Provider.getModel(def.providerID, def.modelID)
    const now = Date.now()
    const userMessageID = Identifier.ascending("message")
    await Session.updateMessage({
      id: userMessageID,
      sessionID: session.id,
      role: "user",
      time: { created: now },
      agent: agentName,
      model: { providerID: def.providerID, modelID: def.modelID },
    })
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMessageID,
      sessionID: session.id,
      type: "text",
      text: input.text,
    })

    // Load recent history (after the just-written user message).
    const history = await Session.messages({ sessionID: session.id, limit: HISTORY_LIMIT })
    const messages = Message.toModelMessages(history, model)

    const tools = createGatewayTools({
      sessionID: session.id,
      defaultCwd: cwd,
      channelBinding: input.channelBinding,
    })

    const cwdLine = `Current cwd: ${path.resolve(cwd)}`
    const systemPrompt = `${GATEWAY_SYSTEM}\n\n${cwdLine}`

    log.info("gateway turn", {
      sessionID: session.id,
      channelKey: input.channelKey,
      cwd,
      model: model.id,
      historySize: history.length,
    })

    const result = await AgentRuntime.run({
      agent: "gateway",
      model,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      sessionID: session.id,
      stage: "gateway",
      signal: input.signal,
      policies: { progressTimeoutMs: PROGRESS_TIMEOUT_MS },
    })

    return {
      sessionID: session.id,
      text: result.text,
      toolCalls: result.toolCallCount,
    }
  }
}
