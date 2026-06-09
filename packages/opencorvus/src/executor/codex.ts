import {
  CodingCapabilities,
  CodingRunInput,
  CodingResumeInput,
  type CodingEventInfo,
  type CodingProvider,
} from "./contract"
import { decode, record, text } from "./contract"

type Call = {
  id: string
  name: string
  input: string
}

export type CodexClient = {
  responses: {
    create(input: Record<string, unknown>): AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>
    cancel?(responseID: string): Promise<unknown>
  }
}

export namespace CodexExecutor {
  export function capabilities(client?: CodexClient) {
    return CodingCapabilities.parse({
      builtinTools: true,
      customTools: true,
      stream: true,
      resume: true,
      interrupt: Boolean(client?.responses.cancel),
      cwd: true,
      system: true,
    })
  }

  export function request(raw: Parameters<typeof CodingRunInput.parse>[0]) {
    const input = CodingRunInput.parse(raw)
    return {
      ...(input.model ? { model: input.model } : {}),
      stream: true,
      input: input.prompt,
      instructions: input.system,
      metadata: {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.taskID ? { taskID: input.taskID } : {}),
        ...(input.logicalSessionID ? { sessionID: input.logicalSessionID } : {}),
        ...(input.runtimeDir ? { runtimeDir: input.runtimeDir } : {}),
      },
      max_output_tokens: undefined,
      tools: (input.tools ?? []).flatMap((item) => {
        if (item.type === "function") {
          return [
            {
              type: "function",
              name: item.name,
              description: item.description,
              parameters: item.inputSchema ?? {
                type: "object",
                properties: {},
                additionalProperties: true,
              },
            },
          ]
        }
        const type = builtin(item.name)
        if (!type) return []
        return [{ type }]
      }),
    }
  }

  export function resumeRequest(raw: Parameters<typeof CodingResumeInput.parse>[0]) {
    const input = CodingResumeInput.parse(raw)
    return {
      ...request(input),
      previous_response_id: input.sessionID,
    }
  }

  export function decoder() {
    const calls = new Map<string, Call>()
    const sent = new Set<string>()

    return {
      push(raw: unknown): CodingEventInfo[] {
        const item = record(raw)
        if (!item) return []
        const type = typeof item.type === "string" ? item.type : ""

        if (type === "response.output_text.delta") {
          const delta = text(item.delta)
          if (!delta) return []
          return [{ type: "text_delta", text: delta }]
        }

        if (type === "response.output_item.added" || type === "response.output_item.done") {
          const next = record(item.item)
          if (!next) return []
          if (next.type === "function_call") {
            const key = keyOf(item, next)
            const id = typeof next.call_id === "string" ? next.call_id : typeof next.id === "string" ? next.id : key
            const prev = calls.get(key) ?? { id, name: "", input: "" }
            const name = typeof next.name === "string" ? next.name : prev.name
            const input = typeof next.arguments === "string" ? next.arguments : prev.input
            setCall(
              calls,
              [key, typeof next.id === "string" ? next.id : "", typeof next.call_id === "string" ? next.call_id : ""],
              {
                id,
                name,
                input,
              },
            )
            if (type === "response.output_item.done" && name && !sent.has(id)) {
              sent.add(id)
              return [{ type: "tool_call", id, name, input }]
            }
            return []
          }

          if (next.type === "function_call_output") {
            const id =
              typeof next.call_id === "string"
                ? next.call_id
                : typeof next.id === "string"
                  ? next.id
                  : keyOf(item, next)
            return [{ type: "tool_result", id, output: text(next.output) }]
          }

          return []
        }

        if (type === "response.function_call_arguments.delta") {
          const key = keyOf(item)
          if (!key) return []
          const delta = text(item.delta || item.arguments_delta)
          const prev = calls.get(key) ?? {
            id: typeof item.call_id === "string" ? item.call_id : key,
            name: typeof item.name === "string" ? item.name : "",
            input: "",
          }
          prev.input += delta
          if (typeof item.name === "string" && item.name) prev.name = item.name
          setCall(
            calls,
            [
              key,
              prev.id,
              typeof item.item_id === "string" ? item.item_id : "",
              typeof item.call_id === "string" ? item.call_id : "",
            ],
            prev,
          )
          return delta ? [{ type: "tool_delta", id: prev.id, name: prev.name || undefined, delta }] : []
        }

        if (type === "response.function_call_arguments.done") {
          const key = keyOf(item)
          if (!key) return []
          const prev = calls.get(key) ?? {
            id: typeof item.call_id === "string" ? item.call_id : key,
            name: typeof item.name === "string" ? item.name : "",
            input: "",
          }
          const input = typeof item.arguments === "string" ? item.arguments : prev.input
          const name = typeof item.name === "string" ? item.name : prev.name
          const id = prev.id
          setCall(
            calls,
            [
              key,
              id,
              typeof item.item_id === "string" ? item.item_id : "",
              typeof item.call_id === "string" ? item.call_id : "",
            ],
            { id, name, input },
          )
          if (!name || sent.has(id)) return []
          sent.add(id)
          return [{ type: "tool_call", id, name, input }]
        }

        if (type === "response.completed") {
          const next = record(item.response)
          return [
            {
              type: "done",
              sessionID: typeof next?.id === "string" ? next.id : undefined,
              output: output(next),
              meta: next,
            },
          ]
        }

        if (type === "response.failed" || type === "error") {
          return [
            {
              type: "error",
              message: error(item),
              meta: item,
            },
          ]
        }

        if (type.startsWith("response.")) {
          return []
        }

        return []
      },
    }
  }

  export function create(client: CodexClient): CodingProvider {
    return {
      name: "codex",
      capabilities() {
        return capabilities(client)
      },
      async *run(input) {
        const stream = await client.responses.create(request(input))
        yield* decode(stream, decoder().push)
      },
      async *resume(input) {
        const stream = await client.responses.create(resumeRequest(input))
        yield* decode(stream, decoder().push)
      },
      async interrupt(sessionID: string) {
        if (!client.responses.cancel) return false
        await client.responses.cancel(sessionID)
        return true
      },
    }
  }
}

function setCall(calls: Map<string, Call>, keys: string[], call: Call) {
  for (const key of keys) {
    if (!key) continue
    calls.set(key, call)
  }
}

function builtin(name: string) {
  if (name === "web_search") return "web_search_preview"
  if (name === "file_search") return "file_search"
  if (name === "code_interpreter") return "code_interpreter"
  if (name === "computer_use") return "computer_use_preview"
}

function keyOf(...items: Array<Record<string, unknown> | undefined>) {
  for (const item of items) {
    if (!item) continue
    if (typeof item.call_id === "string" && item.call_id) return item.call_id
    if (typeof item.item_id === "string" && item.item_id) return item.item_id
    if (typeof item.id === "string" && item.id) return item.id
    const next = record(item.item)
    if (!next) continue
    if (typeof next.call_id === "string" && next.call_id) return next.call_id
    if (typeof next.id === "string" && next.id) return next.id
  }
  return ""
}

function output(item?: Record<string, unknown>) {
  if (!item) return ""
  if (typeof item.output_text === "string") return item.output_text
  if (!Array.isArray(item.output)) return ""

  return item.output
    .flatMap((entry) => {
      const next = record(entry)
      if (!next) return []
      if (next.type === "output_text" && typeof next.text === "string") return [next.text]
      if (next.type !== "message" || !Array.isArray(next.content)) return []
      return next.content.flatMap((part) => {
        const block = record(part)
        if (!block) return []
        if (block.type !== "output_text" || typeof block.text !== "string") return []
        return [block.text]
      })
    })
    .join("")
}

function error(item: Record<string, unknown>) {
  const next = record(item.error) ?? item
  if (typeof next.message === "string" && next.message) return next.message
  if (typeof next.code === "string" && next.code) return next.code
  if (typeof item.type === "string" && item.type) return item.type
  return "Codex request failed"
}
