import z from "zod"
import { CodingCapabilities, CodingRunInput, CodingResumeInput, type CodingEventInfo, type CodingProvider } from "./contracts"
import { record, text } from "./contracts"
import { ToolAdapterRegistry } from "./protocol"

type RequestID = string | number

type ThreadRef = {
  thread: {
    id: string
  }
}

type TurnRef = {
  turn: {
    id: string
  }
}

export type CodexInbound =
  | {
      type: "notification"
      method: string
      params?: Record<string, unknown>
    }
  | {
      type: "request"
      id: RequestID
      method: string
      params?: Record<string, unknown>
    }

export type CodexAppServerClient = {
  initialize(input: {
    clientInfo: {
      name: string
      version: string
    }
    capabilities?: {
      experimentalApi?: boolean
      optOutNotificationMethods?: string[] | null
    }
  }): Promise<unknown>
  threadStart(input: Record<string, unknown>): Promise<ThreadRef>
  threadResume(input: Record<string, unknown>): Promise<ThreadRef>
  turnStart(input: Record<string, unknown>): Promise<TurnRef>
  turnInterrupt(input: {
    threadId: string
    turnId: string
  }): Promise<unknown>
  respond?(input: {
    id: RequestID
    result?: Record<string, unknown>
    error?: Record<string, unknown>
  }): Promise<void>
  events(input?: { signal?: AbortSignal }): AsyncIterable<CodexInbound>
  close?(): Promise<void> | void
}

export namespace CodexAppServerExecutor {
  export function capabilities() {
    return CodingCapabilities.parse({
      builtinTools: true,
      customTools: false,
      stream: true,
      resume: true,
      interrupt: true,
      cwd: true,
      system: true,
    })
  }

  export function create(input: CodexAppServerClient | (() => CodexAppServerClient)): CodingProvider {
    const factory = typeof input === "function" ? input : () => input
    const sessions = new Map<string, { client: CodexAppServerClient; threadID?: string; turnID?: string }>()
    return {
      name: "codex",
      capabilities,
      async *run(raw) {
        const input = CodingRunInput.parse(raw)
        const logicalID = provisionalID()
        const client = factory()
        sessions.set(logicalID, { client })
        await ensure(client)
        const thread = await client.threadStart(threadStart(input))
        const turn = await client.turnStart(turnStart(thread.thread.id, input))
        const current = { client, threadID: thread.thread.id, turnID: turn.turn.id }
        sessions.set(logicalID, current)
        sessions.set(sessionID(thread.thread.id, turn.turn.id), current)
        yield {
          type: "status",
          status: "thread.started",
          meta: {
            thread_id: thread.thread.id,
            turn_id: turn.turn.id,
            session_id: sessionID(thread.thread.id, turn.turn.id),
          },
        }
        try {
          yield* stream(client, thread.thread.id, turn.turn.id, raw.signal)
        } finally {
          sessions.delete(logicalID)
          sessions.delete(sessionID(thread.thread.id, turn.turn.id))
          await client.close?.()
        }
      },
      async *resume(raw) {
        const input = CodingResumeInput.parse(raw)
        const ref = splitSession(input.sessionID)
        const client = factory()
        sessions.set(input.sessionID, { client, threadID: ref.threadID, turnID: ref.turnID })
        await ensure(client)
        const thread = await client.threadResume(threadResume(ref.threadID, input))
        const turn = await client.turnStart(turnStart(thread.thread.id, input))
        const current = { client, threadID: thread.thread.id, turnID: turn.turn.id }
        sessions.set(input.sessionID, current)
        sessions.set(sessionID(thread.thread.id, turn.turn.id), current)
        yield {
          type: "status",
          status: "thread.resumed",
          meta: {
            thread_id: thread.thread.id,
            turn_id: turn.turn.id,
            session_id: sessionID(thread.thread.id, turn.turn.id),
          },
        }
        try {
          yield* stream(client, thread.thread.id, turn.turn.id, raw.signal)
        } finally {
          sessions.delete(input.sessionID)
          sessions.delete(sessionID(thread.thread.id, turn.turn.id))
          await client.close?.()
        }
      },
      async interrupt(id) {
        const current = sessions.get(id)
        const ref = current
          ? {
              threadID: current.threadID,
              turnID: current.turnID,
            }
          : splitSession(id)
        if (!current?.client || !ref.turnID || !ref.threadID) return false
        await current.client.turnInterrupt({
          threadId: ref.threadID,
          turnId: ref.turnID,
        })
        return true
      },
      async respond(input) {
        const current = sessions.get(input.sessionID)
        if (!current?.client.respond) return false
        await current.client.respond({
          id: requestID(input.requestID),
          result: input.response,
          error: input.error,
        })
        return true
      },
    }
  }
}

async function ensure(client: CodexAppServerClient) {
  await client.initialize({
    clientInfo: {
      name: "opencorvus",
      version: "0.0.1-alpha",
    },
    capabilities: {
      experimentalApi: true,
    },
  })
}

async function* stream(client: CodexAppServerClient, threadID: string, turnID: string, signal?: AbortSignal) {
  for await (const item of client.events({ signal })) {
    if (item.type === "notification") {
      yield* notification(threadID, turnID, item.method, item.params)
      if (terminal(threadID, turnID, item.method, item.params)) return
      continue
    }
    yield* request(item)
  }
}

function terminal(threadID: string, turnID: string, method: string, params?: Record<string, unknown>) {
  const data = params ?? {}
  const currentThread = typeof data.threadId === "string" ? data.threadId : threadID
  const currentTurn = typeof data.turnId === "string"
    ? data.turnId
    : typeof record(data.turn)?.id === "string"
      ? String(record(data.turn)?.id)
      : turnID
  if (currentThread !== threadID || currentTurn !== turnID) return false
  return method === "turn/completed" || method === "error"
}

function* notification(threadID: string, turnID: string, method: string, params?: Record<string, unknown>): Generator<CodingEventInfo> {
  const data = params ?? {}
  const currentThread = typeof data.threadId === "string" ? data.threadId : threadID
  const currentTurn = typeof data.turnId === "string" ? data.turnId : turnID
  if (currentThread !== threadID) return

  if (method === "item/agentMessage/delta") {
    const delta = text(data.delta)
    if (!delta) return
    yield {
      type: "text_delta",
      text: delta,
    }
    return
  }

  if (method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") {
    const delta = text(data.delta)
    if (!delta) return
    yield {
      type: "reasoning_delta",
      text: delta,
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        item_id: typeof data.itemId === "string" ? data.itemId : undefined,
      },
    }
    return
  }

  if (method === "turn/plan/updated" || method === "item/plan/delta") {
    yield {
      type: "plan_delta",
      summary: text(data.delta || data.text || data.plan || "Plan updated"),
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
    return
  }

  if (method === "turn/diff/updated" || method === "item/fileChange/outputDelta") {
    const live = method === "item/fileChange/outputDelta"
      ? progressFromMethod(currentThread, currentTurn, method, data)
      : undefined
    if (live) yield live
    yield {
      type: "diff_delta",
      summary: text(data.delta || data.summary || "Diff updated"),
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
    return
  }

  if (method === "thread/tokenUsage/updated") {
    const usage = record(data.tokenUsage)
    const total = record(usage?.total)
    yield {
      type: "usage",
      inputTokens: number(total?.inputTokens),
      outputTokens: number(total?.outputTokens),
      totalTokens: number(total?.totalTokens),
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
    return
  }

  if (method === "item/mcpToolCall/progress") {
    const live = progressFromMethod(currentThread, currentTurn, method, data)
    if (live) yield live
    return
  }

  if (method === "turn/completed") {
    yield {
      type: "done",
      sessionID: sessionID(currentThread, currentTurn),
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
    return
  }

  if (method === "error") {
    yield {
      type: "error",
      message: text(data.message || data.detail || "Codex app server error"),
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
    return
  }

  if (method === "thread/started" || method === "turn/started" || method === "thread/status/changed" || method === "thread/name/updated" || method === "model/rerouted" || method === "thread/compacted") {
    yield {
      type: "status",
      status: method,
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
    return
  }

  const live = progressFromMethod(currentThread, currentTurn, method, data)
  if (live) {
    yield live
    return
  }

  if (method === "item/completed") {
    const item = record(data.item)
    if (!item) return
    const type = typeof item.type === "string" ? item.type : ""
    if (type === "dynamicToolCall") {
      const adapter = ToolAdapterRegistry.classify(String(item.tool || ""))
      yield {
        type: "tool_result",
        id: toolID(item) || currentTurn,
        output: text(item.contentItems ?? item),
        meta: {
          tool_name: String(item.tool || ""),
          adapter: adapter?.id,
          tool_kind: adapter?.kind,
        },
      }
      return
    }
    if (type === "commandExecution" || type === "fileChange" || type === "mcpToolCall") {
      const done = progressFromItem(currentThread, currentTurn, item)
      if (done) yield done
      return
    }
    if (type === "plan") {
      yield {
        type: "plan_delta",
        summary: text(item.text),
        meta: {
          thread_id: currentThread,
          turn_id: currentTurn,
          item_id: typeof item.id === "string" ? item.id : undefined,
        },
      }
      return
    }
    if (type === "reasoning") {
      yield {
        type: "reasoning_delta",
        text: text(item.content ?? item.summary ?? ""),
        meta: {
          thread_id: currentThread,
          turn_id: currentTurn,
          item_id: typeof item.id === "string" ? item.id : undefined,
        },
      }
    }
    return
  }

  yield {
    type: "raw",
    name: method,
    meta: {
      thread_id: currentThread,
      turn_id: currentTurn,
      ...data,
    },
  }
}

function* request(item: Extract<CodexInbound, { type: "request" }>): Generator<CodingEventInfo> {
  const data = item.params ?? {}
  if (item.method === "item/tool/requestUserInput" || item.method === "toolRequestUserInput" || item.method === "mcpServer/elicitation/request") {
    yield {
      type: "input_request",
      id: String(item.id),
      questions: Array.isArray(data.questions) ? data.questions.flatMap((question) => {
        const next = record(question)
        return next ? [next] : []
      }) : [{
        id: String(item.id),
        header: typeof data.serverName === "string" ? data.serverName : "Input",
        question: text(data.message || "Additional input required"),
        mode: data.mode,
        url: data.url,
        requested_schema: data.requestedSchema,
      }],
      meta: {
        request_id: item.id,
        ...data,
      },
    }
    return
  }
  if (
    item.method === "item/commandExecution/requestApproval" ||
    item.method === "commandExecutionRequestApproval" ||
    item.method === "item/fileChange/requestApproval" ||
    item.method === "fileChangeRequestApproval" ||
    item.method === "applyPatchApproval" ||
    item.method === "execCommandApproval" ||
    item.method === "item/tool/call" ||
    item.method === "dynamicToolCall"
  ) {
    if (item.method === "item/tool/call" || item.method === "dynamicToolCall") {
      const name = text(data.tool)
      const adapter = ToolAdapterRegistry.classify(name)
      yield {
        type: "tool_call",
        id: toolID(data) || String(item.id),
        name,
        input: text(data.arguments),
        meta: {
          adapter: adapter?.id,
          tool_kind: adapter?.kind,
          request_id: item.id,
        },
      }
      return
    }
    yield {
      type: "approval_request",
      id: String(item.id),
      approval: item.method,
      message: text(data.reason || data.command || data.tool || item.method),
      meta: {
        request_id: item.id,
        ...data,
      },
    }
    return
  }
  yield {
    type: "raw",
    name: item.method,
    meta: {
      request_id: item.id,
      ...data,
    },
  }
}

function threadStart(input: z.input<typeof CodingRunInput>) {
  const next = CodingRunInput.parse(input)
  return {
    model: next.model,
    cwd: next.cwd,
    approvalPolicy: approvalPolicy(),
    sandbox: next.sandbox ?? sandboxMode(),
    developerInstructions: next.system,
    experimentalRawEvents: true,
    persistExtendedHistory: true,
  }
}

function threadResume(threadID: string, input: z.input<typeof CodingResumeInput>) {
  const next = CodingResumeInput.parse(input)
  return {
    threadId: threadID,
    cwd: next.cwd,
    model: next.model,
    approvalPolicy: approvalPolicy(),
    sandbox: next.sandbox ?? sandboxMode(),
    developerInstructions: next.system,
    persistExtendedHistory: true,
  }
}

function turnStart(threadID: string, input: z.input<typeof CodingRunInput>) {
  const next = CodingRunInput.parse(input)
  return {
    threadId: threadID,
    input: [
      {
        type: "text",
        text: next.prompt,
        text_elements: [],
      },
    ],
    cwd: next.cwd,
    approvalPolicy: approvalPolicy(),
    sandboxPolicy: sandboxPolicy(next.cwd, next.sandbox),
    model: next.model,
    ...(next.outputSchema ? { outputSchema: next.outputSchema } : {}),
  }
}

function splitSession(input: string) {
  const [threadID, turnID] = String(input || "").split(":")
  return {
    threadID,
    turnID,
  }
}

function sessionID(threadID: string, turnID?: string) {
  return turnID ? `${threadID}:${turnID}` : threadID
}

function provisionalID() {
  return `codex-app-server-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function approvalPolicy() {
  const raw = process.env.OPENCORVUS_EXECUTOR_CODEX_APPROVAL?.trim()
  if (!raw) return "never"
  if (raw === "untrusted" || raw === "on-failure" || raw === "on-request" || raw === "never") return raw
  return "never"
}

function sandboxMode() {
  const raw = process.env.OPENCORVUS_EXECUTOR_CODEX_SANDBOX?.trim()
  if (raw === "read-only" || raw === "workspace-write" || raw === "danger-full-access") return raw
  return "workspace-write"
}

function sandboxPolicy(cwd?: string, sandbox?: z.infer<typeof CodingRunInput>["sandbox"]) {
  const mode = sandbox ?? sandboxMode()
  if (mode === "danger-full-access") {
    return {
      type: "dangerFullAccess",
    }
  }
  if (mode === "read-only") {
    return {
      type: "readOnly",
      access: {
        type: "fullAccess",
      },
      networkAccess: networkAccess(),
    }
  }
  return {
    type: "workspaceWrite",
    writableRoots: cwd ? [cwd] : [],
    readOnlyAccess: {
      type: "fullAccess",
    },
    networkAccess: networkAccess(),
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

function networkAccess() {
  const raw = process.env.OPENCORVUS_EXECUTOR_CODEX_NETWORK?.trim()
  if (!raw) return true
  return raw !== "0" && raw.toLowerCase() !== "false"
}

function number(input: unknown) {
  const next = Number(input)
  if (!Number.isFinite(next) || next < 0) return undefined
  return next
}

function progressFromMethod(threadID: string, turnID: string, method: string, data: Record<string, unknown>) {
  const kind = progressKind(method)
  if (!kind) return
  const id = progressID(kind, data)
  if (!id) return
  const status = progressStatus(method, data)
  const output = progressOutput(method, data)
  return {
    type: "progress",
    kind,
    id,
    status,
    summary: progressSummary(kind, method, status, data),
    ...(output ? { output } : {}),
    meta: progressMeta(threadID, turnID, kind, status, data),
  } satisfies CodingEventInfo
}

function progressFromItem(threadID: string, turnID: string, item: Record<string, unknown>) {
  const type = typeof item.type === "string" ? item.type : ""
  const kind = progressKind(type)
  if (!kind) return
  const id = progressID(kind, item)
  if (!id) return
  const status = progressStatus(type, {
    ...item,
    status: typeof item.status === "string" && item.status ? item.status : "completed",
  })
  const output = progressOutput(type, item)
  return {
    type: "progress",
    kind,
    id,
    status,
    summary: progressSummary(kind, type, status, item),
    ...(output ? { output } : {}),
    meta: progressMeta(threadID, turnID, kind, status, item),
  } satisfies CodingEventInfo
}

function progressKind(input: string) {
  const value = input.toLowerCase()
  if (value.includes("commandexecution")) return "command"
  if (value.includes("mcptoolcall")) return "mcp"
  if (value.includes("filechange")) return "tool"
  return ""
}

function progressID(kind: string, data: Record<string, unknown>) {
  const id = itemKey(data) || toolID(data)
  if (id) return id
  const label = progressLabel(kind, data)
  if (!label) return ""
  return `${kind}:${label}`
}

function progressLabel(kind: string, data: Record<string, unknown>) {
  const cmd = commandText(data)
  if (kind === "command" && cmd) return cmd
  if (kind === "mcp") {
    const server = serverName(data)
    if (server) return server
  }
  const name = typeof data.tool === "string" && data.tool.trim()
    ? data.tool.trim()
    : typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : fileText(data)
  if (name) return name
  return kind === "tool" ? "file change" : ""
}

function progressStatus(input: string, data: Record<string, unknown>) {
  const state = typeof data.status === "string" ? data.status.trim().toLowerCase() : ""
  if (state.includes("fail") || state.includes("error")) return "failed"
  if (state.includes("complete") || state.includes("done")) return "completed"
  if (state.includes("block")) return "blocked"
  if (state.includes("queue") || state.includes("pending")) return "queued"
  if (state.includes("run") || state.includes("start") || state.includes("progress")) return "running"
  const value = input.toLowerCase()
  if (value.includes("fail") || value.includes("error")) return "failed"
  if (value.includes("complete") || value.includes("done") || value.includes("finished")) return "completed"
  if (value.includes("block")) return "blocked"
  if (value.includes("queue") || value.includes("pending")) return "queued"
  return "running"
}

function progressSummary(kind: string, input: string, status: string, data: Record<string, unknown>) {
  const value = input.toLowerCase()
  const info = text(data.message || data.summary || "")
  if (info && !value.includes("outputdelta")) return info
  if (kind === "command") {
    if (status === "completed") return "Command completed"
    if (status === "failed") return "Command failed"
    if (value.includes("outputdelta") || value.includes("stdout") || value.includes("stderr")) return "Streaming output"
    if (status === "queued") return "Command queued"
    return "Command started"
  }
  if (kind === "mcp") {
    if (status === "completed") return "MCP completed"
    if (status === "failed") return "MCP failed"
    if (status === "queued") return "MCP queued"
    return "MCP running"
  }
  if (status === "completed") return "File change completed"
  if (status === "failed") return "File change failed"
  if (status === "queued") return "File change queued"
  return "Applying changes"
}

function progressOutput(input: string, data: Record<string, unknown>) {
  const value = input.toLowerCase()
  if (value.includes("outputdelta")) {
    const delta = text(data.delta || data.output || data.stdout || data.stderr)
    if (delta) return delta
  }
  const output = data.output
  if (typeof output === "string" && output) return output
  const recordOutput = record(output)
  if (recordOutput) {
    const textOutput = [
      recordOutput.output,
      recordOutput.stdout,
      recordOutput.stderr,
      recordOutput.result,
      recordOutput.message,
      recordOutput.content,
    ]
      .flatMap((item) => typeof item === "string" && item ? [item] : [])
      .join("\n")
    if (textOutput) return textOutput
  }
  const next = [
    data.stdout,
    data.stderr,
    data.result,
    data.content,
    data.contentItems,
  ]
    .flatMap((item) => typeof item === "string" && item ? [item] : [])
    .join("\n")
  if (next) return next
  return ""
}

function progressMeta(
  threadID: string,
  turnID: string,
  kind: string,
  status: string,
  data: Record<string, unknown>,
) {
  const cmd = commandText(data)
  const server = serverName(data)
  const name = progressLabel(kind, data)
  return {
    thread_id: threadID,
    turn_id: turnID,
    ...data,
    item_id: itemKey(data) || undefined,
    call_id: callKey(data) || undefined,
    ...(cmd ? { command: cmd } : {}),
    ...(server ? { serverName: server } : {}),
    ...(kind === "tool" && name ? { name } : {}),
    status,
  }
}

function commandText(data: Record<string, unknown>) {
  const value = data.command ?? data.argv ?? data.cmd
  if (typeof value === "string") return value.trim()
  if (!Array.isArray(value)) return ""
  return value
    .flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    .join(" ")
    .trim()
}

function serverName(data: Record<string, unknown>) {
  if (typeof data.serverName === "string" && data.serverName.trim()) return data.serverName.trim()
  if (typeof data.server_name === "string" && data.server_name.trim()) return data.server_name.trim()
  return ""
}

function fileText(data: Record<string, unknown>) {
  if (!Array.isArray(data.files)) return ""
  return data.files
    .flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item.trim()]
      const next = record(item)
      if (!next) return []
      if (typeof next.path === "string" && next.path.trim()) return [next.path.trim()]
      if (typeof next.filePath === "string" && next.filePath.trim()) return [next.filePath.trim()]
      return []
    })
    .slice(0, 3)
    .join(", ")
}

function itemKey(input: Record<string, unknown>) {
  if (typeof input.itemId === "string" && input.itemId) return input.itemId
  if (typeof input.item_id === "string" && input.item_id) return input.item_id
  return ""
}

function callKey(input: Record<string, unknown>) {
  if (typeof input.callId === "string" && input.callId) return input.callId
  if (typeof input.call_id === "string" && input.call_id) return input.call_id
  return ""
}

function toolID(input: Record<string, unknown>) {
  const call = callKey(input)
  if (call) return call
  const item = itemKey(input)
  if (item) return item
  if (typeof input.id === "string" && input.id) return input.id
  return ""
}

function requestID(input: string) {
  const value = Number(input)
  if (Number.isFinite(value) && String(value) === input) return value
  return input
}
