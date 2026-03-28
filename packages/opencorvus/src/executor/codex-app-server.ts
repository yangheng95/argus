import z from "zod"
import { CodingCapabilities, CodingRunInput, CodingResumeInput, type CodingEventInfo, type CodingProvider } from "./compat"
import { record, text } from "./compat"
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
      customTools: true,
      stream: true,
      resume: true,
      interrupt: true,
      cwd: true,
      system: true,
    })
  }

  export function create(input: CodexAppServerClient | ((cwd?: string) => CodexAppServerClient)): CodingProvider {
    const factory = typeof input === "function" ? input : () => input
    const sessions = new Map<string, { client: CodexAppServerClient; threadID?: string; turnID?: string }>()
    return {
      name: "codex",
      capabilities,
      async *run(raw) {
        const input = CodingRunInput.parse(raw)
        const logicalID = provisionalID()
        const client = factory(input.cwd)
        sessions.set(logicalID, { client })
        await ensure(client)
        const thread = await client.threadStart(threadStart(input))
        const turn = await client.turnStart(turnStart(thread.thread.id, input))
        const current = { client, threadID: thread.thread.id, turnID: turn.turn.id }
        sessions.set(logicalID, current)
        sessions.set(sessionID(thread.thread.id, turn.turn.id), current)
        yield {
          type: "progress",
          phase: "init",
          summary: "thread.started",
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
          type: "progress",
          phase: "init",
          summary: "thread.resumed",
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
    yield {
      type: "progress",
      phase: "mcp_executing",
      summary: "mcp.progress",
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
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

  if (method === "thread/started" || method === "turn/started") {
    yield {
      type: "progress",
      phase: method === "thread/started" ? "init" : "responding",
      summary: method,
      meta: {
        thread_id: currentThread,
        turn_id: currentTurn,
        ...data,
      },
    }
    return
  }
  if (method === "thread/status/changed" || method === "thread/name/updated" || method === "model/rerouted" || method === "thread/compacted") {
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
        id: typeof item.id === "string" ? item.id : currentTurn,
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
      const itemId = typeof item.id === "string" ? item.id : currentTurn
      const toolName = type === "commandExecution" ? "Bash"
        : type === "fileChange" ? "FileEdit"
        : String(item.tool || "MCP")
      const cmd = type === "commandExecution" ? text(item.command ?? item.args?.[0] ?? "") : ""
      const output = text(item.output ?? item.contentItems ?? item.content ?? "")
      const status = typeof item.status === "string" ? item.status : ""
      const isDone = status === "completed" || status === "done" || !!output
      if (isDone) {
        yield {
          type: "tool_result" as const,
          id: itemId,
          output: output || cmd || `${toolName} completed`,
          meta: { thread_id: currentThread, turn_id: currentTurn, item_id: itemId, item_type: type },
        }
      } else {
        yield {
          type: "tool_call" as const,
          id: itemId,
          name: toolName,
          input: cmd || JSON.stringify(item),
          meta: { thread_id: currentThread, turn_id: currentTurn, item_id: itemId, item_type: type },
        }
      }
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

  // Unknown methods — protocol noise, do not yield
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
        id: String(data.callId || item.id),
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
  // Unknown request methods — do not yield
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

function requestID(input: string) {
  const value = Number(input)
  if (Number.isFinite(value) && String(value) === input) return value
  return input
}
