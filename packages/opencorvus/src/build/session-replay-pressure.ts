import { desc, eq } from "@/storage/db"
import { Database } from "@/storage/db"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ContextBudget } from "@/session/context-budget"
import { MessageTable, PartTable } from "@/session/session.sql"

export namespace BuildSessionReplayPressure {
  export interface Summary {
    sessionID: string
    messageCount: number
    partCount: number
    messageJsonChars: number
    partJsonChars: number
    textPartChars: number
    reasoningChars: number
    toolInputChars: number
    toolOutputChars: number
    completedToolParts: number
    uncompactedToolParts: number
    latestAssistantInputTokens?: number
    latestAssistantTotalTokens?: number
    replayTokensEstimate: number
  }

  export interface Limit {
    tokenLimit: number
    source: "config" | "model_output_window"
  }

  export interface Evaluation {
    summary: Summary
    limit: Limit
    contextUnavailableReason?: string
  }

  function jsonChars(value: unknown): number {
    return JSON.stringify(value ?? null).length
  }

  function textLength(value: unknown): number {
    return typeof value === "string" ? value.length : 0
  }

  function positiveNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
  }

  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
  }

  function assistantTokens(value: unknown): Record<string, unknown> | undefined {
    if (!record(value) || value.role !== "assistant" || !record(value.tokens)) return undefined
    return value.tokens
  }

  function textPartText(value: unknown, type: "text" | "reasoning"): string | undefined {
    if (!record(value) || value.type !== type || typeof value.text !== "string") return undefined
    return value.text
  }

  function toolState(value: unknown): Record<string, unknown> | undefined {
    if (!record(value) || value.type !== "tool" || !record(value.state)) return undefined
    return value.state
  }

  function toolStateTime(value: Record<string, unknown>): Record<string, unknown> | undefined {
    return record(value.time) ? value.time : undefined
  }

  export function retryReplayTokenLimit(input: { config: Config.Info; model: Provider.Model }): Limit {
    const configured = positiveNumber(input.config.agent?.build?.retry_replay_token_limit)
    if (configured) return { tokenLimit: Math.floor(configured), source: "config" }

    const usable = ContextBudget.usable(input)
    const outputWindow = ProviderTransform.maxOutputTokens(input.model)
    const minimumUsefulReplay = ContextBudget.MAX_PRESERVE_RECENT_TOKENS * 4
    const derived = Math.max(minimumUsefulReplay, outputWindow)
    const tokenLimit = usable > 0 ? Math.min(usable, derived) : derived
    return { tokenLimit: Math.max(1, Math.floor(tokenLimit)), source: "model_output_window" }
  }

  export function summarize(sessionID: string): Summary {
    const messageRows = Database.use((db) =>
      db
        .select({ data: MessageTable.data })
        .from(MessageTable)
        .where(eq(MessageTable.session_id, sessionID))
        .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
        .all(),
    )
    const partRows = Database.use((db) =>
      db.select({ data: PartTable.data }).from(PartTable).where(eq(PartTable.session_id, sessionID)).all(),
    )

    let latestAssistantInputTokens: number | undefined
    let latestAssistantTotalTokens: number | undefined
    let messageJsonChars = 0
    for (const row of messageRows) {
      messageJsonChars += jsonChars(row.data)
      if (latestAssistantInputTokens !== undefined) continue
      const tokens = assistantTokens(row.data)
      if (!tokens) continue
      latestAssistantInputTokens = positiveNumber(tokens?.input)
      latestAssistantTotalTokens = positiveNumber(tokens?.total)
    }

    let partJsonChars = 0
    let textPartChars = 0
    let reasoningChars = 0
    let toolInputChars = 0
    let toolOutputChars = 0
    let completedToolParts = 0
    let uncompactedToolParts = 0

    for (const row of partRows) {
      const data = row.data
      partJsonChars += jsonChars(data)
      textPartChars += textLength(textPartText(data, "text"))
      reasoningChars += textLength(textPartText(data, "reasoning"))
      const state = toolState(data)
      if (state?.status === "completed") {
        completedToolParts += 1
        toolOutputChars += textLength(state.output)
        toolInputChars += jsonChars(state.input)
        if (!toolStateTime(state)?.compacted) {
          uncompactedToolParts += 1
        }
      } else if (state?.status === "error") {
        toolInputChars += jsonChars(state.input)
        if (!toolStateTime(state)?.compacted) {
          uncompactedToolParts += 1
        }
      }
    }

    const replayCharsEstimate = textPartChars + reasoningChars + toolInputChars + toolOutputChars
    const replayTokensEstimate = Math.max(
      latestAssistantInputTokens ?? 0,
      Math.ceil(replayCharsEstimate / 4),
    )

    return {
      sessionID,
      messageCount: messageRows.length,
      partCount: partRows.length,
      messageJsonChars,
      partJsonChars,
      textPartChars,
      reasoningChars,
      toolInputChars,
      toolOutputChars,
      completedToolParts,
      uncompactedToolParts,
      latestAssistantInputTokens,
      latestAssistantTotalTokens,
      replayTokensEstimate,
    }
  }

  export function evaluate(input: { sessionID: string; config: Config.Info; model: Provider.Model }): Evaluation {
    const summary = summarize(input.sessionID)
    const limit = retryReplayTokenLimit(input)
    const contextUnavailableReason =
      summary.replayTokensEstimate >= limit.tokenLimit
        ? [
            "prior_session_replay_pressure",
            `estimate=${summary.replayTokensEstimate}`,
            `limit=${limit.tokenLimit}`,
            `limit_source=${limit.source}`,
            `latest_input=${summary.latestAssistantInputTokens ?? "unknown"}`,
            `tool_output_chars=${summary.toolOutputChars}`,
            `tool_input_chars=${summary.toolInputChars}`,
            `uncompacted_tools=${summary.uncompactedToolParts}`,
          ].join(":")
        : undefined
    return { summary, limit, contextUnavailableReason }
  }
}
