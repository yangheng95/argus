import type {
  Event,
  createOpenCorvusClient,
  Project,
  Model,
  Provider,
  PermissionRequest,
  UserMessage,
  Message,
  Part,
  Auth,
  Config,
} from "@opencorvus-ai/sdk"
import type { Hono } from "hono"

import type { BunShell } from "./shell"
import { type ToolDefinition } from "./tool"

export * from "./tool"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type PluginInput = {
  client: ReturnType<typeof createOpenCorvusClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

export type PluginServiceRegistration = {
  id: string
  app: Hono
}

export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOuathResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}

export type AuthOuathResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
  | {
      method: "code"
      callback(code: string): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
)

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  service?: () => Promise<PluginServiceRegistration | PluginServiceRegistration[] | void>
  config?: (input: Config) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  auth?: AuthHook
  /**
   * Called when a new message is received
   */
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  "permission.ask"?: (input: PermissionRequest, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: {
      system: string[]
    },
  ) => Promise<void>
  /**
   * Called before session compaction starts. Allows plugins to append
   * evidence context to the host-owned compaction prompt.
   *
   * - `context`: Additional context strings appended to the default prompt
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[] },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
  /**
   * Modify tool definitions (description and parameters) sent to LLM
   */
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
  /**
   * Register custom evaluation checks. Plugin pushes checks into `output.checks`.
   */
  "evaluation.checks"?: (
    input: {
      taskID?: string
      runID?: string
      request?: string
      config: Record<string, unknown>
    },
    output: {
      checks: Array<{
        name: string
        mode: "soft" | "strict"
        run: (ctx: {
          request?: string
          acceptance: { summary: string; diffs?: any[] }
        }) => Promise<{
          status: "passed" | "failed" | "skipped"
          evidence: string
          artifacts?: Array<{ kind: string; label: string; payload: Record<string, any> }>
        }>
      }>
    },
  ) => Promise<void>
  /**
   * Post-process evaluation results (e.g. send notifications, persist to external systems).
   */
  "evaluation.result"?: (
    input: {
      taskID?: string
      runID?: string
      request?: string
    },
    output: {
      status: string
      verdict: string
      summary: string
      checks: any[]
      artifacts: any[]
    },
  ) => Promise<void>
  /**
   * Provide structured evaluation analysis without invoking the default evaluator model.
   */
  "evaluation.analysis"?: (
    input: {
      task: {
        title: string
        request: string
        sessionID?: string
      }
      goals: Array<{
        description: string
        criteria: string
        priority: "blocking" | "advisory"
        check_selector?: string[]
      }>
      acceptance: {
        summary: string
        changedFiles: string[]
        diffs?: Array<{ file: string; diff?: string }>
      }
      checkResults: Array<{
        name: string
        status: "passed" | "failed" | "skipped"
        evidence?: string
      }>
    },
    output: {
      analysis?: {
        verdict: "accepted" | "rejected" | "inconclusive"
        classification: "transient" | "environment" | "input" | "permission" | "evaluation" | "strategy" | "unknown"
        summary: string
        goal_statuses: Array<{
          goal_index: number
          status: "passed" | "failed" | "inconclusive"
          evidence: string
          reasoning: string
        }>
        replan_guidance?: {
          root_cause: string
          what_failed: string
          suggested_strategy: string
          avoid_approaches: string[]
        } | null
      }
    },
  ) => Promise<void>
  /**
   * Called after acceptance is persisted. Plugins can trigger deployment, doc generation, etc.
   */
  "acceptance.ready"?: (
    input: {
      taskID: string
      runID: string
      acceptanceID: string
      acceptance: { summary: string; changedFiles: string[]; diffs: any[] }
    },
    output: {
      actions: Array<{ name: string; status: string; summary: string; artifacts?: any[] }>
    },
  ) => Promise<void>
}
