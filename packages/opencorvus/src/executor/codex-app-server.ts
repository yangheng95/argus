import z from "zod"
import { Log } from "@/util/log"
import {
  CodingCapabilities,
  CodingRunInput,
  CodingResumeInput,
  codingRuntimeEnv,
  type CodingEventInfo,
  type CodingProvider,
} from "./contract"
import { record, text } from "./contract"
import { ToolAdapterRegistry } from "./protocol"

const log = Log.create({ service: "executor.codex-app-server" })

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
  turnInterrupt(input: { threadId: string; turnId: string }): Promise<unknown>
  respond?(input: { id: RequestID; result?: Record<string, unknown>; error?: Record<string, unknown> }): Promise<void>
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

  export function create(
    input: CodexAppServerClient | ((input: z.infer<typeof CodingRunInput>) => CodexAppServerClient),
  ): CodingProvider {
    const factory = typeof input === "function" ? input : () => input
    const sessions = new Map<string, { client: CodexAppServerClient; threadID?: string; turnID?: string }>()
    return {
      name: "codex",
      capabilities,
      async *run(raw) {
        const input = CodingRunInput.parse(raw)
        const logicalID = input.sessionID ?? provisionalID()
        const client = factory(input)
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
        const client = factory(input)
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
    yield* request(item, client)
  }
}

function terminal(threadID: string, turnID: string, method: string, params?: Record<string, unknown>) {
  const data = params ?? {}
  const currentThread = typeof data.threadId === "string" ? data.threadId : threadID
  const currentTurn =
    typeof data.turnId === "string"
      ? data.turnId
      : typeof record(data.turn)?.id === "string"
        ? String(record(data.turn)?.id)
        : turnID
  if (currentThread !== threadID || currentTurn !== turnID) return false
  return method === "turn/completed" || method === "error"
}

function* notification(
  threadID: string,
  turnID: string,
  method: string,
  params?: Record<string, unknown>,
): Generator<CodingEventInfo> {
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
    const todos = codexPlanTodos(data.plan)
    if (todos) {
      yield* codexPlanToolEvents({
        threadID: currentThread,
        turnID: currentTurn,
        itemID: typeof data.itemId === "string" ? data.itemId : undefined,
        todos,
        raw: data,
      })
      return
    }
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
    // Codex emits this notification on every diff write; the payload is
    // frequently empty (no delta, no summary). Suppressing the synthetic
    // "Diff updated" placeholder removes the noisy chat card spam — the real
    // file changes still surface via item/fileChange tool_call/tool_result.
    const summary = text(data.delta || data.summary || "")
    if (!summary) return
    yield {
      type: "diff_delta",
      summary,
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
      message: codexErrorMessage(data),
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
  if (
    method === "thread/status/changed" ||
    method === "thread/name/updated" ||
    method === "model/rerouted" ||
    method === "thread/compacted"
  ) {
    return
  }

  // Codex 0.125 in app-server protocol delivers tool-call lifecycle as
  // OpenAI raw response items inside `rawResponseItem/completed`
  // notifications. Log the inner item shape so we can decide whether the
  // tool_call/tool_result pair must be decoded from `function_call` /
  // `function_call_output` / `local_shell_call` ResponseItem variants.
  // See codex `app-server generate-ts` ResponseItem.
  if (method === "rawResponseItem/completed") {
    const item = record(data.item)
    if (item) {
      log.info("codex rawResponseItem", {
        type: typeof item.type === "string" ? item.type : "(unknown)",
        callID: typeof item.call_id === "string" ? item.call_id : undefined,
        name: typeof item.name === "string" ? item.name : undefined,
        status: typeof item.status === "string" ? item.status : undefined,
        itemJSON: JSON.stringify(item).slice(0, 2000),
      })
    }
    // Do not yield yet — diagnostic only. Once we know the variants codex
    // 0.125 uses for Bash and similar, add a proper decoder here.
    return
  }

  // Pair a `tool_call` event with the `tool_result` that lands on
  // `item/completed`. Codex 0.125 emits `item/started` for command/file
  // change/MCP tool items before they execute (no prior approval JSON-RPC
  // request when the bypass flag is on), and goes straight to
  // `item/completed` with status=completed afterwards. Without an explicit
  // `item/started` handler we used to emit only the tool_result, so the
  // build agent flagged it as `tool_result ... arrived without a prior
  // tool_call`. The id MUST match what the matching `item/completed` will
  // use (see the commandExecution / fileChange / mcpToolCall branch below)
  // so the tool_call/tool_result pair correlates inside build/agent.ts
  // `tools` map.
  if (method === "item/started") {
    const item = record(data.item)
    if (!item) {
      log.info("codex item/started missing item field", { method, paramKeys: Object.keys(data) })
      return
    }
    const type = typeof item.type === "string" ? item.type : ""
    log.info("codex item/started", {
      type,
      itemId: typeof item.id === "string" ? item.id : undefined,
      tool: typeof item.tool === "string" ? item.tool : undefined,
      command: typeof item.command === "string" ? item.command.slice(0, 200) : undefined,
      itemJSON: JSON.stringify(item).slice(0, 1500),
    })
    if (type === "commandExecution" || type === "fileChange" || type === "mcpToolCall") {
      const itemId = typeof item.id === "string" ? item.id : currentTurn
      const toolName =
        type === "commandExecution" ? "Bash" : type === "fileChange" ? "FileEdit" : String(item.tool || "MCP")
      const cmd = type === "commandExecution" ? text(item.command ?? item.args?.[0] ?? "") : ""
      yield {
        type: "tool_call",
        id: itemId,
        name: toolName,
        input: cmd || (codingInput(item.arguments ?? item.input) ?? JSON.stringify(item)),
        meta: { thread_id: currentThread, turn_id: currentTurn, item_id: itemId, item_type: type },
      }
    }
    return
  }

  if (method === "item/completed") {
    const item = record(data.item)
    if (!item) return
    log.info("codex item/completed", {
      type: typeof item.type === "string" ? item.type : "(unknown)",
      itemId: typeof item.id === "string" ? item.id : undefined,
      status: typeof item.status === "string" ? item.status : undefined,
      itemJSON: JSON.stringify(item).slice(0, 1500),
    })
    void item
    const type = typeof item.type === "string" ? item.type : ""
    if (type === "dynamicToolCall") {
      const itemID = typeof item.id === "string" ? item.id : currentTurn
      const callID = toolCallID(item.callId, itemID)
      const toolName = String(item.tool || "tool")
      const adapter = ToolAdapterRegistry.classify(String(item.tool || ""))
      const input: string | Record<string, unknown> = codingInput(item.arguments ?? item.input) ?? {}
      yield {
        type: "tool_result",
        id: callID,
        name: toolName,
        input,
        output: text(item.contentItems ?? item),
        meta: {
          item_id: itemID,
          call_id: callID,
          tool_name: toolName,
          adapter: adapter?.id,
          tool_kind: adapter?.kind,
        },
      }
      return
    }
    if (type === "commandExecution" || type === "fileChange" || type === "mcpToolCall") {
      // The matching `tool_call` was emitted on `item/started` above. Here
      // we only ever emit the `tool_result` that closes the lifecycle. The
      // id must equal the started-event itemId so build/agent.ts's `tools`
      // map matches the pair. Codex 0.125's bypass-flag dispatch can land
      // `item/completed` with status="completed" almost immediately after
      // `item/started`, which is fine: both events still flow through the
      // same handler in order.
      const itemId = typeof item.id === "string" ? item.id : currentTurn
      const toolName =
        type === "commandExecution" ? "Bash" : type === "fileChange" ? "FileEdit" : String(item.tool || "MCP")
      const cmd = type === "commandExecution" ? text(item.command ?? item.args?.[0] ?? "") : ""
      const output = text(item.output ?? item.contentItems ?? item.content ?? "")
      const input: string | Record<string, unknown> =
        type === "commandExecution" ? { command: cmd } : (codingInput(item.arguments ?? item.input) ?? item)
      yield {
        type: "tool_result" as const,
        id: itemId,
        name: toolName,
        input,
        output: output || cmd || `${toolName} completed`,
        meta: { thread_id: currentThread, turn_id: currentTurn, item_id: itemId, item_type: type },
      }
      return
    }
    if (type === "plan") {
      const todos = codexPlanTodos(item.plan)
      if (todos) {
        yield* codexPlanToolEvents({
          threadID: currentThread,
          turnID: currentTurn,
          itemID: typeof item.id === "string" ? item.id : undefined,
          todos,
          raw: item,
        })
        return
      }
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

  // Unknown methods — protocol noise typically, but log at debug so we can
  // catch any new event types that should map to user-visible signals.
  log.info("codex inbound notification unmapped", {
    method,
    threadID: currentThread,
    turnID: currentTurn,
    paramKeys: Object.keys(data),
  })
}

async function* request(
  item: Extract<CodexInbound, { type: "request" }>,
  client: CodexAppServerClient,
): AsyncGenerator<CodingEventInfo> {
  const data = item.params ?? {}
  void client
  // Trace every JSON-RPC request from codex so we can identify any new
  // approval/elicitation method names introduced in newer codex CLIs.
  // Without this, an unknown method silently falls through and codex hangs
  // waiting for a response — which is exactly what happened on the
  // 2026-04-28 codex 0.125 dispatch run when the build agent stalled with
  // "tool_call ended without a matching tool_result". Keep at info level
  // until codex protocol churn settles. Full params dump so we can see the
  // exact response shape codex 0.125 expects (e.g. tool-input-elicitation
  // schema vs free-text question).
  log.info("codex inbound request", {
    method: item.method,
    requestID: item.id,
    paramsJSON: JSON.stringify(data).slice(0, 4000),
  })
  if (
    item.method === "item/tool/requestUserInput" ||
    item.method === "toolRequestUserInput" ||
    item.method === "mcpServer/elicitation/request"
  ) {
    yield {
      type: "input_request",
      id: String(item.id),
      questions: Array.isArray(data.questions)
        ? data.questions.flatMap((question) => {
            const next = record(question)
            return next ? [next] : []
          })
        : [
            {
              id: String(item.id),
              header: typeof data.serverName === "string" ? data.serverName : "Input",
              question: text(data.message || "Additional input required"),
              mode: data.mode,
              url: data.url,
              requested_schema: data.requestedSchema,
            },
          ],
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
      const callID = toolCallID(data.callId, item.id)
      yield {
        type: "tool_call",
        id: callID,
        name,
        input: text(data.arguments),
        meta: {
          adapter: adapter?.id,
          tool_kind: adapter?.kind,
          call_id: callID,
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
  // Unknown request methods — codex will hang waiting for a response. Log
  // loudly so we can identify newly-added methods and route them. Do NOT
  // attempt to silently auto-accept here — a wrong response shape would be
  // worse than a stall surfaced by the build-agent watchdog.
  log.warn("codex inbound request unhandled — codex will hang for a reply", {
    method: item.method,
    requestID: item.id,
    params: data,
  })
}

type NormalizedTodo = {
  content: string
  status: string
  priority?: string
}

function codexPlanTodos(plan: unknown): NormalizedTodo[] | null {
  if (!Array.isArray(plan)) return null
  const todos = plan.flatMap((entry) => {
    const item = record(entry)
    const content = typeof item?.step === "string" ? item.step.trim() : ""
    if (!content) return []
    const priority = typeof item?.priority === "string" && item.priority.trim() ? item.priority.trim() : undefined
    return [
      {
        content,
        status: codexPlanStatus(item?.status),
        ...(priority ? { priority } : {}),
      },
    ]
  })
  return todos.length > 0 ? todos : null
}

function codexPlanStatus(input: unknown): string {
  const key = String(input || "pending")
    .replace(/[-_\s]/g, "")
    .toLowerCase()
  const values: Record<string, string> = {
    pending: "pending",
    inprogress: "in_progress",
    completed: "completed",
  }
  return values[key] ?? "pending"
}

function* codexPlanToolEvents(input: {
  threadID: string
  turnID: string
  itemID?: string
  todos: NormalizedTodo[]
  raw: Record<string, unknown>
}): Generator<CodingEventInfo> {
  const callID = input.itemID ?? codexPlanCallID(input.turnID, input.todos)
  const toolInput = { todos: input.todos }
  const meta = {
    thread_id: input.threadID,
    turn_id: input.turnID,
    item_id: input.itemID,
    adapter: "codex_plan",
    tool_kind: "plan",
    raw: input.raw,
  }
  yield {
    type: "tool_call",
    id: callID,
    name: "update_plan",
    input: toolInput,
    meta,
  }
  yield {
    type: "tool_result",
    id: callID,
    name: "update_plan",
    input: toolInput,
    output: JSON.stringify(input.todos, null, 2),
    meta: {
      ...meta,
      todos: input.todos,
    },
  }
}

function codexPlanCallID(turnID: string, todos: NormalizedTodo[]): string {
  const raw = JSON.stringify(todos)
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0
  }
  return `${turnID}:codex-plan:${hash.toString(36)}`
}

function threadStart(input: z.input<typeof CodingRunInput>) {
  const next = CodingRunInput.parse(input)
  return {
    model: next.model,
    metadata: codingRuntimeEnv(next),
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
    metadata: codingRuntimeEnv(next),
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
    metadata: codingRuntimeEnv(next),
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

function toolCallID(value: unknown, generated: unknown) {
  const callID = typeof value === "string" ? value.trim() : ""
  if (callID) return callID
  return String(generated)
}

function codingInput(value: unknown): string | Record<string, unknown> | undefined {
  if (typeof value === "string") return value
  return record(value)
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
  // Default to full access. The codex app-server uses whatever `sandbox`
  // value we send in `threadStart` and IGNORES config-file overrides at
  // the thread level — so a conservative client-side default (the previous
  // "workspace-write") silently re-imposed the sandbox even when bootstrap
  // passed `-c sandbox_mode="danger-full-access"`. Caught on bench
  // _session-20260429-084449.out (round-5): developer prompt still
  // reported workspace-write, blocking 127.0.0.1 ports with EACCES.
  // Benchmark runs are externally sandboxed (per-goal worktrees + ephemeral
  // home), so the safety surface is the host, not codex's per-call gates.
  return "danger-full-access"
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

function codexErrorMessage(input: Record<string, unknown>) {
  const direct = text(input.message || input.detail)
  if (direct) return direct
  const error = record(input.error)
  const nested = text(error?.message || error?.detail)
  if (!nested) return "Codex app server error"
  try {
    const parsed = JSON.parse(nested) as Record<string, unknown>
    return text(parsed.detail || parsed.message) || nested
  } catch {
    return nested
  }
}

function requestID(input: string) {
  const value = Number(input)
  if (Number.isFinite(value) && String(value) === input) return value
  return input
}
