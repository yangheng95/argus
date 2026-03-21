import { Bus } from "@/bus"
import { type TextHooks } from "@/llm/api"
import { Log } from "@/util/log"
import { type AgentStageType, Event } from "./model"
import { OrchestratorProtocol } from "./protocol"

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
 * Fire-and-forget publish for streaming chunks.
 * Bus.publish and OrchestratorProtocol.emit are NOT awaited so the LLM stream
 * is never back-pressured by slow subscribers or DB writes.
 * Status/error events still await to ensure ordering guarantees.
 */
function publishFireAndForget(
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
  OrchestratorProtocol.emit(Event.AgentUpdated, properties, { source: "agent-stream" }).catch((err) => {
    log.warn("agent-stream Protocol.emit failed", { error: String(err) })
  })
}

async function publish(
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
  await Bus.publish(Event.AgentUpdated, properties)
  await OrchestratorProtocol.emit(Event.AgentUpdated, properties, { source: "agent-stream" })
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
          publishFireAndForget(meta, {
            kind: "status",
            summary: `${stageLabel(meta.stage)} → ${toolName}`,
          })
        }
      },
      onError: async ({ error }) => {
        const summary = error instanceof Error ? error.message : String(error)
        await publish(meta, {
          kind: "error",
          summary,
          text: summary,
        })
      },
    } satisfies TextHooks,
    start(summary?: string) {
      return publish(meta, {
        kind: "status",
        summary: summary ?? `${stageLabel(meta.stage)} started`,
      })
    },
    error(error: unknown) {
      const summary = error instanceof Error ? error.message : String(error)
      return publish(meta, {
        kind: "error",
        summary,
        text: summary,
      })
    },
    finish(summary?: string) {
      return publish(meta, {
        kind: "status",
        summary: summary ?? `${stageLabel(meta.stage)} finished`,
      })
    },
    statusHook(summary: string) {
      return publish(meta, { kind: "status", summary })
    },
  }
}
