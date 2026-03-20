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
  const tools = new Map<string, string>()
  return {
    hooks: {
      onChunk: async ({ chunk }) => {
        if (chunk.type === "text-delta") {
          if (!chunk.text) return
          publishFireAndForget(meta, {
            kind: "message_delta",
            id: chunk.id,
            text: chunk.text,
            summary: chunk.text,
          })
          return
        }

        if (chunk.type === "tool-input-start") {
          tools.set(chunk.id, chunk.toolName)
          publishFireAndForget(meta, {
            kind: "tool_call",
            id: chunk.id,
            toolName: chunk.toolName,
            summary: `${stageLabel(meta.stage)} -> ${chunk.toolName}`,
          })
          return
        }

        if (chunk.type === "tool-call") {
          tools.set(chunk.toolCallId, chunk.toolName)
          publishFireAndForget(meta, {
            kind: "tool_call",
            id: chunk.toolCallId,
            toolName: chunk.toolName,
            summary: `${stageLabel(meta.stage)} -> ${chunk.toolName}`,
          })
          return
        }

        if (chunk.type === "tool-input-delta") {
          const id = (chunk as { id?: string }).id
          const delta = (chunk as { delta?: string }).delta
          if (!delta) return
          publishFireAndForget(meta, {
            kind: "tool_delta",
            id,
            toolName: id ? tools.get(id) : undefined,
            text: delta,
            summary: delta,
          })
          return
        }

        if (chunk.type === "tool-result") {
          publishFireAndForget(meta, {
            kind: "tool_result",
            id: chunk.toolCallId,
            toolName: chunk.toolName,
            summary: chunk.toolName ? `${chunk.toolName} completed` : `${stageLabel(meta.stage)} tool completed`,
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
