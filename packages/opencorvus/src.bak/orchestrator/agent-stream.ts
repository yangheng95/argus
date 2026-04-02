import { Bus } from "@/bus"
import { type TextHooks } from "@/llm/api"
import { ProtocolStore } from "@/protocol/store"
import { Log } from "@/util/log"
import { type AgentStageType, Event } from "./model"

const log = Log.create({ service: "agent-stream" })

type Meta = {
  taskID: string
  runID?: string
  stage: AgentStageType
}

function stageLabel(stage: AgentStageType) {
  if (stage === "spec") return "Spec agent"
  if (stage === "goal") return "Goal agent"
  if (stage === "planner") return "Planner agent"
  if (stage === "delivery") return "Delivery agent"
  return "Evaluator agent"
}

/**
 * Publish an agent status event via Bus (for in-process subscribers like
 * event-log) and ProtocolStore.dispatchEphemeral (for SSE clients).
 *
 * agent.updated events are pure status indicators — they don't need DB
 * persistence or sequence numbering.  Using dispatchEphemeral bypasses
 * the per-task DB lock that serialises all persisted protocol events,
 * eliminating the main source of UI update delay.
 *
 * On SSE reconnect the client recovers agent state from the transcript
 * snapshot (syncTask), so replay of these events is unnecessary.
 */
function publish(
  meta: Meta,
  input: {
    kind: "status" | "message_delta" | "tool_call" | "tool_delta" | "tool_result" | "error"
    id?: string
    summary: string
    text?: string
    toolName?: string
  },
) {
  const properties = {
    taskID: meta.taskID,
    ...(meta.runID ? { runID: meta.runID } : {}),
    stage: meta.stage,
    kind: input.kind,
    ...(input.id ? { id: input.id } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.text ? { text: input.text } : {}),
    summary: input.summary,
  }
  Bus.publish(Event.AgentUpdated, properties).catch((err) => {
    log.warn("agent-stream Bus.publish failed", { error: String(err) })
  })
  ProtocolStore.dispatchEphemeral({
    type: Event.AgentUpdated.type,
    aggregate: "task",
    taskID: meta.taskID,
    runID: meta.runID,
    source: "agent-stream",
    payload: properties,
  })
}

export function agentStream(meta: Meta) {
  return {
    /**
     * Lightweight status-only hooks. Content events (text, tool calls) are
     * handled by sessionStreamHooks which persists them to a session.
     * These hooks only publish status events for the agent status indicator.
     */
    hooks: {
      onChunk: async ({ chunk }) => {
        // Content events are handled by sessionStreamHooks — only publish
        // tool-call status for the agent status indicator line.
        if (chunk.type === "tool-input-start" || chunk.type === "tool-call") {
          const toolName = chunk.type === "tool-call" ? chunk.toolName : chunk.toolName
          publish(meta, {
            kind: "status",
            summary: `${stageLabel(meta.stage)} → ${toolName}`,
          })
        }
      },
      onError: async ({ error }) => {
        const summary = error instanceof Error ? error.message : String(error)
        publish(meta, {
          kind: "error",
          summary,
          text: summary,
        })
      },
    } satisfies TextHooks,
    start(summary?: string) {
      publish(meta, {
        kind: "status",
        summary: summary ?? `${stageLabel(meta.stage)} started`,
      })
    },
    error(error: unknown) {
      const summary = error instanceof Error ? error.message : String(error)
      publish(meta, {
        kind: "error",
        summary,
        text: summary,
      })
    },
    finish(summary?: string) {
      publish(meta, {
        kind: "status",
        summary: summary ?? `${stageLabel(meta.stage)} finished`,
      })
    },
    statusHook(summary: string) {
      publish(meta, { kind: "status", summary })
    },
  }
}
