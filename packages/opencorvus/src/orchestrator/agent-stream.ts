import { Bus } from "@/bus"
import { type TextHooks } from "@/llm/api"
import { type AgentEventKindType, type AgentStageType, Event } from "./model"

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

function text(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (!value) return ""
  return JSON.stringify(value)
}

function clip(value: string, max = 1200) {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`
}

async function publish(
  meta: Meta,
  input: {
    kind: AgentEventKindType
    id?: string
    payload?: Record<string, unknown>
    summary: string
    text?: string
    toolName?: string
  },
) {
  await Bus.publish(Event.AgentUpdated, {
    taskID: meta.taskID,
    ...(meta.runID ? { runID: meta.runID } : {}),
    stage: meta.stage,
    kind: input.kind,
    ...(input.id ? { id: input.id } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.text ? { text: input.text } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    summary: input.summary,
  })
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
            payload: {
              toolName: chunk.toolName,
            },
          })
          return
        }

        if (chunk.type === "tool-input-delta") {
          if (!chunk.delta) return
          await publish(meta, {
            kind: "tool_delta",
            id: chunk.id,
            toolName: tools.get(chunk.id),
            text: chunk.delta,
            summary: chunk.delta,
            payload: {
              toolName: tools.get(chunk.id),
              text: chunk.delta,
            },
          })
          return
        }

        if (chunk.type === "tool-call") {
          tools.set(chunk.toolCallId, chunk.toolName)
          const input = clip(text("input" in chunk ? chunk.input : ""))
          await publish(meta, {
            kind: "tool_call",
            id: chunk.toolCallId,
            toolName: chunk.toolName,
            text: input || undefined,
            summary: `${stageLabel(meta.stage)} -> ${chunk.toolName}`,
            payload: {
              toolName: chunk.toolName,
              ...(input ? { input } : {}),
            },
          })
          return
        }

        if (chunk.type === "tool-result") {
          const output = clip(text("result" in chunk ? chunk.result : ""))
          await publish(meta, {
            kind: "tool_result",
            id: chunk.toolCallId,
            toolName: chunk.toolName,
            text: output || undefined,
            summary: chunk.toolName ? `${chunk.toolName} completed` : `${stageLabel(meta.stage)} tool completed`,
            payload: {
              toolName: chunk.toolName,
              ...(output ? { result: output } : {}),
            },
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
  }
}
