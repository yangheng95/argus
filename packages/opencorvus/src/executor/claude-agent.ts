import z from "zod"
import {
  query,
  type ElicitationRequest,
  type ElicitationResult,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk"
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
import { MCPServe } from "@/mcp/serve"
import { assertExecutorModel } from "./runtime-env"
import { gitCeilingEnvForWorktree } from "@/worktree/git-ceiling"
import { unwrapCommandQuotes } from "@/util/command"

export type ClaudeAgentHandle = {
  stream: AsyncIterable<Record<string, unknown>>
  interrupt(): Promise<void>
  close(): void
}

export type ClaudeAgentClient = {
  run(input: {
    prompt: string
    taskID?: string
    logicalSessionID?: string
    runtimeDir?: string
    worktreeDir?: string
    model?: string
    cwd?: string
    system?: string
    maxTurns?: number
    sessionID?: string
    /** The Claude-assigned UUID from a prior turn for the same logical
     *  session. The SDK's `resume:` option requires a real Claude UUID
     *  (or a session title); passing OpenCorvus's `ses_xxx` ID makes
     *  Claude exit 1 with "is not a UUID and does not match any session
     *  title". Undefined means "start a fresh Claude session". */
    resumeID?: string
    toolMode?: z.infer<typeof CodingRunInput>["toolMode"]
    sandbox?: z.infer<typeof CodingRunInput>["sandbox"]
    mcpServers?: Record<string, { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }>
    signal?: AbortSignal
    onApproval?(input: {
      id: string
      approval: string
      message?: string
      meta?: Record<string, unknown>
    }): Promise<PermissionResult>
    onInput?(input: {
      id: string
      questions: Record<string, unknown>[]
      meta?: Record<string, unknown>
    }): Promise<ElicitationResult>
  }): ClaudeAgentHandle
}

type SessionState = {
  logicalID: string
  query?: ClaudeAgentHandle
  actualID?: string
  approval: Map<string, Deferred<PermissionResult>>
  input: Map<string, Deferred<ElicitationResult>>
}

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
}

const sessions = new Map<string, SessionState>()

export namespace ClaudeAgentExecutor {
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

  export function create(client: ClaudeAgentClient): CodingProvider {
    return {
      name: "claude-code",
      capabilities,
      async *run(raw) {
        const input = CodingRunInput.parse(raw)
        yield* execute(client, input.sessionID ?? provisionalID(), input, raw.signal)
      },
      async *resume(raw) {
        const input = CodingResumeInput.parse(raw)
        yield* execute(client, input.sessionID, input, raw.signal)
      },
      async interrupt(sessionID: string) {
        const current = session(sessionID)
        if (!current?.query) return false
        await current.query.interrupt()
        return true
      },
      async respond(input) {
        const current = session(input.sessionID)
        if (!current) return false
        if (input.kind === "approval") {
          const pending = current.approval.get(input.requestID)
          if (!pending) return false
          current.approval.delete(input.requestID)
          pending.resolve(permissionResult(input.response))
          return true
        }
        const pending = current.input.get(input.requestID)
        if (!pending) return false
        current.input.delete(input.requestID)
        pending.resolve(elicitationResult(input.response, input.error))
        return true
      },
    }
  }

  export function createSdk(executablePath?: string): CodingProvider {
    return create({
      run(input) {
        if (input.model) assertExecutorModel("claude-code", input.model)
        // Read-only planning runs (no tools, read-only sandbox) force "plan" mode
        // regardless of OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE override.
        const mode = input.toolMode === "none" && input.sandbox === "read-only" ? "plan" : permissionMode()
        const allowed = input.toolMode === "none" ? [] : split(process.env.OPENCORVUS_EXECUTOR_CLAUDE_ALLOWED_TOOLS)
        const systemAppend = [
          input.system,
          input.toolMode === "none" ? undefined : MCPServe.codingExecutorPromptSection(),
        ]
          .filter((item): item is string => Boolean(item))
          .join("\n\n")

        const handle = query({
          prompt: input.prompt,
          options: {
            ...(executablePath ? { pathToClaudeCodeExecutable: unwrapCommandQuotes(executablePath) } : {}),
            cwd: input.cwd,
            model: input.model,
            // Only pass `resume` when we actually have a Claude UUID from a
            // prior turn for this logical session. Passing OpenCorvus's
            // logical `ses_xxx` ID here makes the SDK reject the spawn with
            // "is not a UUID and does not match any session title" — the
            // logical ID is not a Claude session identifier.
            ...(input.resumeID ? { resume: input.resumeID } : {}),
            systemPrompt: systemAppend
              ? {
                  type: "preset",
                  preset: "claude_code",
                  append: systemAppend,
                }
              : undefined,
            maxTurns: input.maxTurns,
            settingSources: ["user", "project", "local"],
            includePartialMessages: true,
            permissionMode: mode,
            allowDangerouslySkipPermissions: mode === "bypassPermissions",
            effort: effort(),
            maxBudgetUsd: maxBudget(),
            env: {
              ...claudeSdkEnv(),
              ...gitCeilingEnvForWorktree(input.cwd),
              ...codingRuntimeEnv(input),
            },
            mcpServers: input.toolMode === "none" ? undefined : opencorvusMcpServers(input),
            allowedTools: allowed,
            disallowedTools: split(process.env.OPENCORVUS_EXECUTOR_CLAUDE_DISALLOWED_TOOLS),
            abortController: abortController(input.signal),
            canUseTool: async (toolName, toolInput, options) => {
              if (input.toolMode === "none") {
                return {
                  behavior: "deny",
                  message: "Planning runs are read-only and cannot execute tools.",
                } satisfies PermissionResult
              }
              if (!input.onApproval) {
                return {
                  behavior: "allow",
                }
              }
              return input.onApproval({
                id: `permission:${options.toolUseID}`,
                approval: "can_use_tool",
                message: options.decisionReason || toolName,
                meta: {
                  adapter: ToolAdapterRegistry.classify(toolName)?.id ?? "approval",
                  tool_kind: ToolAdapterRegistry.classify(toolName)?.kind ?? "approval",
                  tool_name: toolName,
                  input: toolInput,
                  blocked_path: options.blockedPath,
                  suggestions: options.suggestions,
                  tool_use_id: options.toolUseID,
                  agent_id: options.agentID,
                },
              })
            },
            onElicitation: async (request: ElicitationRequest) => {
              if (!input.onInput) {
                return {
                  action: "decline",
                } as ElicitationResult
              }
              return input.onInput({
                id: `elicitation:${request.elicitationId || crypto.randomUUID()}`,
                questions: [
                  {
                    id: request.elicitationId || crypto.randomUUID(),
                    header: request.serverName,
                    question: request.message,
                    mode: request.mode,
                    url: request.url,
                    requested_schema: request.requestedSchema,
                  },
                ],
                meta: {
                  adapter: "request_user_input",
                  tool_kind: "input",
                  server_name: request.serverName,
                  elicitation_id: request.elicitationId,
                  mode: request.mode,
                  url: request.url,
                  requested_schema: request.requestedSchema,
                },
              })
            },
          },
        })
        return {
          stream: handle as AsyncIterable<Record<string, unknown>>,
          interrupt: () => handle.interrupt(),
          close: () => handle.close(),
        }
      },
    })
  }
}

function opencorvusMcpServers(input: z.infer<typeof CodingRunInput> | z.infer<typeof CodingResumeInput>) {
  const mcp = MCPServe.command(input.cwd ?? process.cwd())
  const env = codingRuntimeEnv(input)
  return {
    [mcp.name]: {
      type: "stdio" as const,
      command: mcp.command,
      args: mcp.args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
  }
}

export function claudeSdkEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = { ...source }
  const baseURL = env.ANTHROPIC_BASE_URL?.trim()
  if (baseURL) env.ANTHROPIC_BASE_URL = baseURL.replace(/\/v1\/?$/, "")
  return env
}

async function* execute(
  client: ClaudeAgentClient,
  logicalID: string,
  input: z.infer<typeof CodingRunInput> | z.infer<typeof CodingResumeInput>,
  signal?: AbortSignal,
) {
  const current = ensureSession(logicalID)
  const queue: CodingEventInfo[] = []
  let wake: (() => void) | undefined
  let done = false
  const push = (...events: CodingEventInfo[]) => {
    if (events.length === 0) return
    queue.push(...events)
    wake?.()
  }

  const run = client.run({
    prompt: input.prompt,
    taskID: input.taskID,
    logicalSessionID: input.logicalSessionID,
    runtimeDir: input.runtimeDir,
    worktreeDir: input.worktreeDir,
    model: input.model,
    cwd: input.cwd,
    system: input.system,
    maxTurns: input.maxTurns,
    sessionID: "sessionID" in input ? input.sessionID : undefined,
    // Claude's resume hint is the SDK-assigned UUID we captured from a
    // previous turn (set by updateSession on the first `session_id` in
    // the stream). Undefined on a fresh logical session so the SDK
    // starts a new Claude session instead of trying to resume one that
    // doesn't exist.
    resumeID: current.actualID,
    toolMode: input.toolMode,
    sandbox: input.sandbox,
    signal,
    onApproval: async (item) => {
      const deferred = createDeferred<PermissionResult>()
      current.approval.set(item.id, deferred)
      push({
        type: "approval_request",
        id: item.id,
        approval: item.approval,
        message: item.message,
        meta: item.meta,
      })
      return deferred.promise
    },
    onInput: async (item) => {
      const deferred = createDeferred<ElicitationResult>()
      current.input.set(item.id, deferred)
      push({
        type: "input_request",
        id: item.id,
        questions: item.questions,
        meta: item.meta,
      })
      return deferred.promise
    },
  })

  current.query = run
  ;(async () => {
    try {
      for await (const message of run.stream) {
        updateSession(current, message)
        push(...mapMessage(current, message))
      }
    } catch (error) {
      push({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      done = true
      wake?.()
    }
  })()

  try {
    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        yield queue.shift()!
      }
      if (done) break
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = undefined
    }
  } finally {
    run.close()
    releaseSession(current)
  }
}

function mapMessage(current: SessionState, message: Record<string, unknown>): CodingEventInfo[] {
  const type = typeof message.type === "string" ? message.type : ""
  const sessionID =
    typeof message.session_id === "string" ? message.session_id : (current.actualID ?? current.logicalID)

  if (type === "assistant") {
    return fromAssistant(sessionID, record(message.message))
  }
  if (type === "user") {
    return fromUser(sessionID, record(message.message), message.tool_use_result)
  }
  if (type === "stream_event") {
    return fromStreamEvent(sessionID, record(message.event))
  }
  if (type === "result") {
    const usage = {
      inputTokens: number(record(message.usage)?.input_tokens),
      outputTokens: number(record(message.usage)?.output_tokens),
      totalTokens: totalTokens(record(message.usage)),
      costUSD: number(message.total_cost_usd),
    }
    if (message.subtype === "success") {
      return [
        {
          type: "usage",
          ...usage,
          meta: {
            session_id: sessionID,
          },
        },
        {
          type: "done",
          sessionID,
          output: text(message.result),
          costUSD: number(message.total_cost_usd),
          turns: number(message.num_turns),
          meta: {
            usage: record(message.usage),
            structured_output: message.structured_output,
            stop_reason: message.stop_reason,
            permission_denials: message.permission_denials,
          },
        },
      ]
    }
    return [
      {
        type: "usage",
        ...usage,
        meta: {
          session_id: sessionID,
        },
      },
      {
        type: "error",
        message: text(
          (Array.isArray(message.errors) ? message.errors.join("\n") : "") || message.subtype || "Claude query failed",
        ),
        meta: {
          session_id: sessionID,
          subtype: message.subtype,
        },
      },
    ]
  }
  if (type === "system") {
    const subtype = typeof message.subtype === "string" ? message.subtype : "system"
    return [
      {
        type: "progress",
        phase: subtype,
        summary: subtype,
        meta: {
          session_id: sessionID,
          ...message,
        },
      },
    ]
  }
  if (type === "tool_progress") {
    return [
      {
        type: "progress",
        phase: "tool_executing",
        summary: "tool_progress",
        meta: {
          session_id: sessionID,
          ...message,
        },
      },
    ]
  }
  if (
    type === "tool_use_summary" ||
    type === "prompt_suggestion" ||
    type === "rate_limit_event" ||
    type === "auth_status"
  ) {
    return []
  }
  return []
}

function fromAssistant(sessionID: string, message?: Record<string, unknown>): CodingEventInfo[] {
  if (!message || !Array.isArray(message.content)) return []
  const out: CodingEventInfo[] = []
  for (const part of message.content) {
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
      const adapter = ToolAdapterRegistry.classify(name)
      out.push({
        type: "tool_call",
        id,
        name,
        input: text(next.input),
        meta: {
          adapter: adapter?.id,
          tool_kind: adapter?.kind,
        },
      })
    }
  }
  if (out.length === 0) {
    out.push({
      type: "progress",
      phase: "responding",
    })
  }
  return out
}

function fromUser(sessionID: string, message?: Record<string, unknown>, toolUseResult?: unknown): CodingEventInfo[] {
  const out: CodingEventInfo[] = []
  // tool_use_result noise — tool results come through tool_result type
  if (toolUseResult !== undefined) {
    // do not emit — results flow through individual tool_result events
  }
  if (!message || !Array.isArray(message.content)) return out
  for (const part of message.content) {
    const next = record(part)
    if (!next || next.type !== "tool_result") continue
    const id = typeof next.tool_use_id === "string" ? next.tool_use_id : ""
    if (!id) continue
    out.push({
      type: "tool_result",
      id,
      output: text(next.content),
    })
  }
  return out
}

function fromStreamEvent(sessionID: string, event?: Record<string, unknown>): CodingEventInfo[] {
  if (!event) return []
  const type = typeof event.type === "string" ? event.type : ""
  if (type === "content_block_delta") {
    const delta = record(event.delta)
    if (!delta) return []
    if (delta.type === "text_delta") {
      const value = text(delta.text)
      if (!value) return []
      return [{ type: "text_delta", text: value }]
    }
    if (delta.type === "thinking_delta") {
      const value = text(delta.thinking)
      if (!value) return []
      return [
        {
          type: "reasoning_delta",
          text: value,
          meta: {
            session_id: sessionID,
            index: event.index,
          },
        },
      ]
    }
  }
  // tool_use blocks are NOT emitted from stream events. Anthropic's streaming
  // protocol seeds each tool_use's input as `{}` at content_block_start and
  // streams the real input via input_json_delta until content_block_stop. If
  // we emit on start, downstream sees a tool_call with input "{}" (the
  // observed "empty bash invocation") and then a second tool_call with the
  // full input from the assistant envelope — same id, two events, breaking
  // any in-flight counter and (combined with the empty-env MCP regression)
  // wedging the executor's done-detection loop forever. Single source: emit
  // tool_call exclusively from the assistant envelope (fromAssistant), which
  // arrives with the complete input. text_delta / thinking_delta still
  // stream below for live rendering.
  if (type === "content_block_start" || type === "content_block_stop") return []
  if (type === "message_start" || type === "message_stop" || type === "message_delta") return []
  // Unknown stream events — protocol noise, do not yield
  return []
}

function updateSession(current: SessionState, message: Record<string, unknown>) {
  const sessionID = typeof message.session_id === "string" ? message.session_id : undefined
  if (!sessionID) return
  current.actualID = sessionID
  if (!sessions.has(sessionID)) sessions.set(sessionID, current)
}

function ensureSession(logicalID: string) {
  const existing = sessions.get(logicalID)
  if (existing) return existing
  const created: SessionState = {
    logicalID,
    approval: new Map(),
    input: new Map(),
  }
  sessions.set(logicalID, created)
  return created
}

function releaseSession(current: SessionState) {
  sessions.delete(current.logicalID)
  if (current.actualID) sessions.delete(current.actualID)
}

function session(id?: string) {
  if (!id) return
  return sessions.get(id)
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function permissionResult(input?: Record<string, unknown>): PermissionResult {
  const decision = input?.decision
  if (decision === "accept" || decision === "acceptForSession") {
    return {
      behavior: "allow",
    }
  }
  return {
    behavior: "deny",
    message: typeof input?.message === "string" && input.message ? input.message : "Rejected by operator",
  }
}

function elicitationResult(input?: Record<string, unknown>, error?: Record<string, unknown>): ElicitationResult {
  if (error) {
    return {
      action: "decline",
    } as ElicitationResult
  }
  const content = input?.content
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return {
      action: "accept",
      content,
    } as ElicitationResult
  }
  return {
    action: "accept",
    content: {},
  } as ElicitationResult
}

function totalTokens(input?: Record<string, unknown>) {
  const values = [
    number(input?.input_tokens),
    number(input?.output_tokens),
    number(input?.cache_read_input_tokens),
    number(input?.cache_creation_input_tokens),
  ].filter((item) => item !== undefined)
  if (values.length === 0) return undefined
  return values.reduce((sum, item) => sum + item!, 0)
}

function number(input: unknown) {
  const next = Number(input)
  if (!Number.isFinite(next) || next < 0) return undefined
  return next
}

function split(input?: string) {
  return String(input || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function provisionalID() {
  return `claude-sdk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function permissionMode() {
  const raw = process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE?.trim()
  if (!raw) return "bypassPermissions" as const
  if (["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"].includes(raw)) {
    return raw as "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
  }
  return "bypassPermissions" as const
}

function effort() {
  const raw = process.env.OPENCORVUS_EXECUTOR_CLAUDE_EFFORT?.trim()
  if (!raw) return undefined
  if (["low", "medium", "high", "max"].includes(raw)) {
    return raw as "low" | "medium" | "high" | "max"
  }
}

function maxBudget() {
  const raw = Number(process.env.OPENCORVUS_EXECUTOR_CLAUDE_MAX_BUDGET_USD)
  if (!Number.isFinite(raw) || raw <= 0) return undefined
  return raw
}

function abortController(signal?: AbortSignal) {
  const controller = new AbortController()
  if (!signal) return controller
  if (signal.aborted) controller.abort(signal.reason)
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  return controller
}
