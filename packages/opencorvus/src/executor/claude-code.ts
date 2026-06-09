import {
  CodingCapabilities,
  CodingRunInput,
  CodingResumeInput,
  codingRuntimeEnv,
  type CodingEventInfo,
  type CodingProvider,
} from "./contract"
import { decode, record, text } from "./contract"
import { assertExecutorModel } from "./runtime-env"

type Tool = {
  id: string
  name: string
  input: string
}

export type ClaudeQuery = (input: {
  prompt: string
  options?: Record<string, unknown>
}) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>

export namespace ClaudeCodeExecutor {
  export function capabilities() {
    return CodingCapabilities.parse({
      builtinTools: true,
      customTools: false,
      stream: true,
      resume: true,
      interrupt: false,
      cwd: true,
      system: true,
    })
  }

  export function request(raw: Parameters<typeof CodingRunInput.parse>[0]) {
    const input = CodingRunInput.parse(raw)
    if (input.model) assertExecutorModel("claude-code", input.model)
    const tools = input.toolMode === "none" ? [] : builtins(input.tools ?? [])
    return {
      prompt: input.prompt,
      options: {
        ...(input.model ? { model: input.model } : {}),
        cwd: input.cwd,
        maxTurns: input.maxTurns,
        includePartialMessages: true,
        env: codingRuntimeEnv(input),
        systemPrompt: input.system
          ? {
              type: "preset",
              preset: "claude_code",
              append: input.system,
            }
          : {
              type: "preset",
              preset: "claude_code",
            },
        tools:
          input.toolMode === "none"
            ? []
            : tools.length > 0
              ? tools
              : {
                  type: "preset",
                  preset: "claude_code",
                },
      },
    }
  }

  export function resumeRequest(raw: Parameters<typeof CodingResumeInput.parse>[0]) {
    const input = CodingResumeInput.parse(raw)
    const req = request(input)
    return {
      ...req,
      options: {
        ...req.options,
        resume: input.sessionID,
      },
    }
  }

  export function decoder() {
    const tools = new Map<number, Tool>()
    const seen = new Set<string>()

    return {
      push(raw: unknown): CodingEventInfo[] {
        const item = record(raw)
        if (!item) return []
        const type = typeof item.type === "string" ? item.type : ""

        if (type === "system") {
          const subtype = typeof item.subtype === "string" ? item.subtype : "system"
          return [
            {
              type: "progress",
              phase: subtype,
              summary: subtype,
              meta: item,
            },
          ]
        }

        if (type === "stream_event") {
          if (typeof item.uuid === "string" && item.uuid) seen.add(item.uuid)
          return fromStreamEvent(record(item.event), tools)
        }

        if (type === "assistant") {
          const id = typeof item.uuid === "string" ? item.uuid : ""
          if (id && seen.has(id)) return []
          return fromAssistant(record(item.message))
        }

        if (type === "user") {
          return fromUser(record(item.message))
        }

        if (type === "result") {
          if (item.subtype === "success") {
            return [
              {
                type: "done",
                sessionID: typeof item.session_id === "string" ? item.session_id : undefined,
                output: text(item.result),
                costUSD: typeof item.total_cost_usd === "number" ? item.total_cost_usd : undefined,
                turns: typeof item.num_turns === "number" ? item.num_turns : undefined,
                meta: item,
              },
            ]
          }
          return [
            {
              type: "error",
              message: resultError(item),
              meta: item,
            },
          ]
        }

        return []
      },
    }
  }

  export function create(query: ClaudeQuery): CodingProvider {
    return {
      name: "claude-code",
      capabilities,
      async *run(input) {
        const stream = await query(request(input))
        yield* decode(stream, decoder().push)
      },
      async *resume(input) {
        const stream = await query(resumeRequest(input))
        yield* decode(stream, decoder().push)
      },
      async interrupt() {
        return false
      },
    }
  }
}

function builtins(items: Array<{ type: string; name: string }>) {
  return items.filter((item) => item.type === "builtin").map((item) => item.name)
}

function fromAssistant(item?: Record<string, unknown>): CodingEventInfo[] {
  if (!item || !Array.isArray(item.content)) return []
  const out: CodingEventInfo[] = []
  for (const part of item.content) {
    const next = record(part)
    if (!next) continue
    if (next.type === "text") {
      const value = text(next.text)
      if (!value) continue
      out.push({ type: "text_delta", text: value })
      continue
    }
    if (next.type === "tool_use") {
      const id = typeof next.id === "string" ? next.id : ""
      const name = typeof next.name === "string" ? next.name : ""
      if (!id || !name) continue
      out.push({ type: "tool_call", id, name, input: text(next.input) })
    }
  }
  return out
}

function fromUser(item?: Record<string, unknown>): CodingEventInfo[] {
  if (!item || !Array.isArray(item.content)) return []
  const out: CodingEventInfo[] = []
  for (const part of item.content) {
    const next = record(part)
    if (!next || next.type !== "tool_result") continue
    const id = typeof next.tool_use_id === "string" ? next.tool_use_id : ""
    if (!id) continue
    out.push({ type: "tool_result", id, output: toolOutput(next.content) })
  }
  return out
}

function fromStreamEvent(item: Record<string, unknown> | undefined, tools: Map<number, Tool>): CodingEventInfo[] {
  if (!item) return []
  const type = typeof item.type === "string" ? item.type : ""

  if (type === "content_block_start") {
    const block = record(item.content_block)
    const idx = typeof item.index === "number" ? item.index : -1
    if (!block || idx < 0 || block.type !== "tool_use") return []
    const id = typeof block.id === "string" ? block.id : ""
    const name = typeof block.name === "string" ? block.name : ""
    if (!id || !name) return []
    tools.set(idx, { id, name, input: seed(block.input) })
    return []
  }

  if (type === "content_block_delta") {
    const delta = record(item.delta)
    if (!delta) return []
    if (delta.type === "text_delta") {
      const value = text(delta.text)
      if (!value) return []
      return [{ type: "text_delta", text: value }]
    }
    if (delta.type !== "input_json_delta") return []
    const idx = typeof item.index === "number" ? item.index : -1
    const tool = tools.get(idx)
    if (!tool) return []
    tool.input += text(delta.partial_json)
    return []
  }

  if (type === "content_block_stop") {
    const idx = typeof item.index === "number" ? item.index : -1
    const tool = tools.get(idx)
    if (!tool) return []
    tools.delete(idx)
    return [{ type: "tool_call", id: tool.id, name: tool.name, input: tool.input }]
  }

  if (type === "message_start" || type === "message_stop" || type === "message_delta") {
    return []
  }

  return []
}

function toolOutput(input: unknown): string {
  if (typeof input === "string") return input
  if (!Array.isArray(input)) return text(input)
  return input
    .flatMap((part) => {
      const next = record(part)
      if (!next) return []
      if (next.type === "text" && typeof next.text === "string") return [next.text]
      return [text(next)]
    })
    .join("")
}

function resultError(item: Record<string, unknown>) {
  if (typeof item.result === "string" && item.result) return item.result
  if (typeof item.error === "string" && item.error) return item.error
  if (typeof item.subtype === "string" && item.subtype) return item.subtype
  return "Claude Code request failed"
}

function seed(input: unknown) {
  if (Array.isArray(input) && input.length === 0) return ""
  const item = record(input)
  if (item && Object.keys(item).length === 0) return ""
  return text(input)
}
