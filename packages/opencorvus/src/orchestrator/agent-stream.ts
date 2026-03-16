import { type TextHooks } from "@/llm/api"
import { type AgentStageType, Event } from "./model"
import { OrchestratorProtocol } from "./protocol"

type Meta = {
  taskID: string
  runID?: string
  stage: AgentStageType
}

function stageLabel(stage: AgentStageType) {
  if (stage === "spec") return "Spec agent"
  if (stage === "planner") return "Planner agent"
  return "Evaluator agent"
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
  await OrchestratorProtocol.emit(Event.AgentUpdated, {
    taskID: meta.taskID,
    ...(meta.runID ? { runID: meta.runID } : {}),
    stage: meta.stage,
    kind: input.kind,
    ...(input.id ? { id: input.id } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.text ? { text: input.text } : {}),
    summary: input.summary,
  }, { source: "agent-stream" })
}

export function agentStream(meta: Meta) {
  const tools = new Map<string, string>()
  return {
    hooks: {
      onChunk: async ({ chunk }) => {
        if (chunk.type === "text-delta") {
          if (!chunk.text) return
          await publish(meta, {
            kind: "message_delta",
            id: chunk.id,
            text: chunk.text,
            summary: chunk.text,
          })
          return
        }

        if (chunk.type === "tool-input-start") {
          tools.set(chunk.id, chunk.toolName)
          await publish(meta, {
            kind: "tool_call",
            id: chunk.id,
            toolName: chunk.toolName,
            summary: `${stageLabel(meta.stage)} -> ${chunk.toolName}`,
          })
          return
        }

        if (chunk.type === "tool-call") {
          tools.set(chunk.toolCallId, chunk.toolName)
          await publish(meta, {
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
          await publish(meta, {
            kind: "tool_delta",
            id,
            toolName: id ? tools.get(id) : undefined,
            text: delta,
            summary: delta,
          })
          return
        }

        if (chunk.type === "tool-result") {
          await publish(meta, {
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
