import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import { Identifier } from "../id/id"
import { LSP } from "../lsp"
import { Snapshot } from "@/snapshot"
import { fn } from "@/util/fn"
import { Database, NotFoundError, and, eq, desc, inArray } from "@/storage/db"
import { MessageTable, PartTable } from "./session.sql"
import { ProviderError } from "@/provider/error"
import { type SystemError } from "bun"
import type { Provider } from "@/provider/provider"
import { decodeDataUrlBase64Bytes, isDecodableText } from "./text-mime"
import { STATEFUL_SNAPSHOT_TOOL_NAMES } from "@/orchestrator/stateful-tool-names"
import { AttachmentStore } from "@/storage/attachment-store"
import { CompactionHandoff } from "./compaction-handoff"
import { ToolFailureCause, renderToolFailureCause } from "./tool-failure-cause"
import { normalizeToolInput } from "./tool-input-norm"
import { ModelImageInputTooLargeError, prepareModelImageInput } from "./model-image-input"
import { timelineOrderKey } from "@/timeline/order"

function replayToolInput(raw: unknown): Record<string, unknown> {
  const normalized = normalizeToolInput(raw)
  if (normalized.ok) return normalized.value
  // The persisted part keeps the raw invalid value for diagnostics. The model
  // replay path must still emit object-shaped tool arguments; the paired
  // tool-error result carries the exact validation failure back to the model.
  return {}
}

export namespace Message {
  export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
  export const AbortedError = NamedError.create("MessageAbortedError", z.object({ message: z.string() }))
  export const StructuredOutputError = NamedError.create(
    "StructuredOutputError",
    z.object({
      message: z.string(),
      retries: z.number(),
    }),
  )
  export const StructuredOutputPayloadError = NamedError.create(
    "StructuredOutputPayloadError",
    z.object({
      message: z.string(),
      reason: z.string(),
    }),
  )
  export const TerminalToolMissingError = NamedError.create(
    "TerminalToolMissingError",
    z.object({
      message: z.string(),
      toolName: z.string(),
      retries: z.number(),
    }),
  )
  export const AuthError = NamedError.create(
    "ProviderAuthError",
    z.object({
      providerID: z.string(),
      message: z.string(),
    }),
  )
  export const APIError = NamedError.create(
    "APIError",
    z.object({
      message: z.string(),
      statusCode: z.number().optional(),
      isRetryable: z.boolean(),
      responseHeaders: z.record(z.string(), z.string()).optional(),
      responseBody: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    }),
  )
  export type APIError = z.infer<typeof APIError.Schema>
  export const ContextOverflowError = NamedError.create(
    "ContextOverflowError",
    z.object({ message: z.string(), responseBody: z.string().optional() }),
  )
  /**
   * Predictive-compaction fired but compaction cannot rescue this turn â€”
   * either there is no message history to summarise (`assistantMsgCount=0`
   * and the user message itself fits) or the non-compressible prompt
   * (system prompt + tool schemas) is already at/over budget. Carries the
   * full breakdown so the operator can identify whether to drop tools, raise
   * the budget, or change the agent design (rule 26: surface the actual
   * cause, do not loop a useless action).
   * See structured-output systemic fix record Â§C.
   */
  export const PromptBudgetOverflowError = NamedError.create(
    "PromptBudgetOverflowError",
    z.object({
      message: z.string(),
      systemTokensEst: z.number(),
      messagePayloadChars: z.number(),
      toolSchemaChars: z.number(),
      compressibleMessageChars: z.number(),
      nonCompressiblePromptChars: z.number(),
      usableBudget: z.number(),
      limit: z.number(),
      toolNames: z.string(),
    }),
  )
  /**
   * Tool schemas alone overrun a configurable share of the model's input
   * budget. Compaction never touches tool definitions, so this is a
   * structural problem with the agent's tool surface (often Zod-rich
   * register/submit tools); fail-fast and refuse to retry.
   */
  export const ToolSchemaBudgetError = NamedError.create(
    "ToolSchemaBudgetError",
    z.object({
      message: z.string(),
      toolSchemaChars: z.number(),
      usableBudget: z.number(),
      ratio: z.number(),
      toolNames: z.string(),
    }),
  )

  export const OutputFormatText = z
    .object({
      type: z.literal("text"),
    })
    .meta({
      ref: "OutputFormatText",
    })

  export const OutputFormatJsonSchema = z
    .object({
      type: z.literal("json_schema"),
      schema: z.record(z.string(), z.any()).meta({ ref: "JSONSchema" }),
      retryCount: z.number().int().min(0).default(2),
    })
    .meta({
      ref: "OutputFormatJsonSchema",
    })

  export const Format = z.discriminatedUnion("type", [OutputFormatText, OutputFormatJsonSchema]).meta({
    ref: "OutputFormat",
  })
  export type OutputFormat = z.infer<typeof Format>

  const PartBase = z.object({
    id: z.string(),
    sessionID: z.string(),
    messageID: z.string(),
    orderKey: z.string().optional(),
  })

  export const SnapshotPart = PartBase.extend({
    type: z.literal("snapshot"),
    snapshot: z.string(),
  }).meta({
    ref: "SnapshotPart",
  })
  export type SnapshotPart = z.infer<typeof SnapshotPart>

  export const PatchPart = PartBase.extend({
    type: z.literal("patch"),
    hash: z.string(),
    files: z.string().array(),
  }).meta({
    ref: "PatchPart",
  })
  export type PatchPart = z.infer<typeof PatchPart>

  export const TextPart = PartBase.extend({
    type: z.literal("text"),
    text: z.string(),
    kind: z.enum(["user_content", "control", "context"]).optional(),
    source: z.enum(["user", "system", "evaluator", "goal_evidence", "task_tool"]).optional(),
    time: z
      .object({
        start: z.number(),
        end: z.number().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
    .strict()
    .meta({
      ref: "TextPart",
    })
  export type TextPart = z.infer<typeof TextPart>

  export const ReasoningPart = PartBase.extend({
    type: z.literal("reasoning"),
    text: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number().optional(),
    }),
  }).meta({
    ref: "ReasoningPart",
  })
  export type ReasoningPart = z.infer<typeof ReasoningPart>

  export const PartErrorIssue = z
    .object({
      path: z.string(),
      message: z.string(),
    })
    .meta({
      ref: "PartErrorIssue",
    })
  export type PartErrorIssue = z.infer<typeof PartErrorIssue>

  export const PartErrorPart = PartBase.extend({
    type: z.literal("part-error"),
    title: z.string(),
    message: z.string(),
    issues: z.array(PartErrorIssue),
    originalType: z.string().optional(),
    originalTool: z.string().optional(),
  }).meta({
    ref: "PartErrorPart",
  })
  export type PartErrorPart = z.infer<typeof PartErrorPart>

  const FilePartSourceBase = z.object({
    text: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .meta({
        ref: "FilePartSourceText",
      }),
  })

  export const FileSource = FilePartSourceBase.extend({
    type: z.literal("file"),
    path: z.string(),
  }).meta({
    ref: "FileSource",
  })

  export const SymbolSource = FilePartSourceBase.extend({
    type: z.literal("symbol"),
    path: z.string(),
    range: LSP.Range,
    name: z.string(),
    kind: z.number().int(),
  }).meta({
    ref: "SymbolSource",
  })

  export const ResourceSource = FilePartSourceBase.extend({
    type: z.literal("resource"),
    clientName: z.string(),
    uri: z.string(),
  }).meta({
    ref: "ResourceSource",
  })

  export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource]).meta({
    ref: "FilePartSource",
  })

  export const FilePart = PartBase.extend({
    type: z.literal("file"),
    mime: z.string(),
    filename: z.string().optional(),
    url: z.string(),
    source: FilePartSource.optional(),
  }).meta({
    ref: "FilePart",
  })
  export type FilePart = z.infer<typeof FilePart>

  export const AgentPart = PartBase.extend({
    type: z.literal("agent"),
    name: z.string(),
    source: z
      .object({
        value: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      })
      .optional(),
  }).meta({
    ref: "AgentPart",
  })
  export type AgentPart = z.infer<typeof AgentPart>

  export const CompactionPart = PartBase.extend({
    type: z.literal("compaction"),
    auto: z.boolean(),
    overflow: z.boolean().optional(),
    tail_start_id: z.string().optional(),
    anchor_id: z.string().optional(),
    focus: z.string().optional(),
  }).meta({
    ref: "CompactionPart",
  })
  export type CompactionPart = z.infer<typeof CompactionPart>

  export const SubtaskPart = PartBase.extend({
    type: z.literal("subtask"),
    prompt: z.string(),
    description: z.string(),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string().optional(),
  }).meta({
    ref: "SubtaskPart",
  })
  export type SubtaskPart = z.infer<typeof SubtaskPart>

  export const RetryPart = PartBase.extend({
    type: z.literal("retry"),
    attempt: z.number(),
    error: APIError.Schema,
    time: z.object({
      created: z.number(),
    }),
  }).meta({
    ref: "RetryPart",
  })
  export type RetryPart = z.infer<typeof RetryPart>

  export const StepStartPart = PartBase.extend({
    type: z.literal("step-start"),
    snapshot: z.string().optional(),
  }).meta({
    ref: "StepStartPart",
  })
  export type StepStartPart = z.infer<typeof StepStartPart>

  export const TokenUsage = z
    .object({
      total: z.number(),
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    })
    .meta({
      ref: "TokenUsage",
    })
  export type TokenUsage = z.infer<typeof TokenUsage>

  export const StepFinishPart = PartBase.extend({
    type: z.literal("step-finish"),
    reason: z.string(),
    snapshot: z.string().optional(),
    cost: z.number(),
    tokens: TokenUsage,
  }).meta({
    ref: "StepFinishPart",
  })
  export type StepFinishPart = z.infer<typeof StepFinishPart>

  export const ToolStatePending = z
    .object({
      status: z.literal("pending"),
      input: z.unknown(),
      raw: z.string(),
      time: z.object({
        start: z.number(),
      }),
    })
    .meta({
      ref: "ToolStatePending",
    })

  export type ToolStatePending = z.infer<typeof ToolStatePending>

  export const ToolStateRunning = z
    .object({
      status: z.literal("running"),
      input: z.unknown(),
      title: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
      }),
    })
    .meta({
      ref: "ToolStateRunning",
    })
  export type ToolStateRunning = z.infer<typeof ToolStateRunning>

  export const ToolStateCompleted = z
    .object({
      status: z.literal("completed"),
      input: z.unknown(),
      output: z.string(),
      title: z.string(),
      metadata: z.record(z.string(), z.any()),
      time: z.object({
        start: z.number(),
        end: z.number(),
        compacted: z.number().optional(),
      }),
      attachments: FilePart.array().optional(),
    })
    .refine((state) => state.time.end > state.time.start, {
      message: "tool terminal end time must be later than start time",
      path: ["time", "end"],
    })
    .meta({
      ref: "ToolStateCompleted",
    })
  export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

  export const ToolStateError = z
    .object({
      status: z.literal("error"),
      input: z.unknown(),
      failure: ToolFailureCause,
      metadata: z.record(z.string(), z.any()).optional(),
      time: z.object({
        start: z.number(),
        end: z.number(),
      }),
    })
    .refine((state) => state.time.end > state.time.start, {
      message: "tool terminal end time must be later than start time",
      path: ["time", "end"],
    })
    .meta({
      ref: "ToolStateError",
    })
  export type ToolStateError = z.infer<typeof ToolStateError>

  export const ToolState = z
    .discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
    .meta({
      ref: "ToolState",
    })

  export const ToolPart = PartBase.extend({
    type: z.literal("tool"),
    callID: z.string(),
    tool: z.string(),
    state: ToolState,
    metadata: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "ToolPart",
  })
  export type ToolPart = z.infer<typeof ToolPart>

  const Base = z.object({
    id: z.string(),
    sessionID: z.string(),
    orderKey: z.string().optional(),
  })

  export const User = Base.extend({
    role: z.literal("user"),
    time: z.object({
      created: z.number(),
    }),
    format: Format.optional(),
    summary: z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
      })
      .optional(),
    agent: z.string(),
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }),
    system: z.string().optional(),
    systemMode: z.enum(["append_to_agent", "complete"]).optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    variant: z.string().optional(),
    extra: z.record(z.string(), z.any()).optional(),
  }).meta({
    ref: "UserMessage",
  })
  export type User = z.infer<typeof User>

  export const Part = z
    .discriminatedUnion("type", [
      TextPart,
      PartErrorPart,
      SubtaskPart,
      ReasoningPart,
      FilePart,
      ToolPart,
      StepStartPart,
      StepFinishPart,
      SnapshotPart,
      PatchPart,
      AgentPart,
      RetryPart,
      CompactionPart,
    ])
    .meta({
      ref: "Part",
    })
  export type Part = z.infer<typeof Part>

  export const VisiblePart = z
    .discriminatedUnion("type", [
      TextPart.extend({ orderKey: z.string().min(1) }),
      PartErrorPart.extend({ orderKey: z.string().min(1) }),
      SubtaskPart.extend({ orderKey: z.string().min(1) }),
      ReasoningPart.extend({ orderKey: z.string().min(1) }),
      FilePart.extend({ orderKey: z.string().min(1) }),
      ToolPart.extend({ orderKey: z.string().min(1) }),
      StepStartPart.extend({ orderKey: z.string().min(1) }),
      StepFinishPart.extend({ orderKey: z.string().min(1) }),
      SnapshotPart.extend({ orderKey: z.string().min(1) }),
      PatchPart.extend({ orderKey: z.string().min(1) }),
      AgentPart.extend({ orderKey: z.string().min(1) }),
      RetryPart.extend({ orderKey: z.string().min(1) }),
      CompactionPart.extend({ orderKey: z.string().min(1) }),
    ])
    .meta({
      ref: "VisibleMessagePart",
    })
  export type VisiblePart = z.infer<typeof VisiblePart>

  export const Assistant = Base.extend({
    role: z.literal("assistant"),
    time: z.object({
      created: z.number(),
      completed: z.number().optional(),
    }),
    error: z
      .discriminatedUnion("name", [
        AuthError.Schema,
        NamedError.Unknown.Schema,
        OutputLengthError.Schema,
        AbortedError.Schema,
        StructuredOutputError.Schema,
        StructuredOutputPayloadError.Schema,
        TerminalToolMissingError.Schema,
        Snapshot.SnapshotIntegrityError.Schema,
        Snapshot.SnapshotEmptyTreeError.Schema,
        ContextOverflowError.Schema,
        PromptBudgetOverflowError.Schema,
        ToolSchemaBudgetError.Schema,
        ModelImageInputTooLargeError.Schema,
        APIError.Schema,
      ])
      .optional(),
    parentID: z.string(),
    modelID: z.string(),
    providerID: z.string(),
    agent: z.string(),
    path: z.object({
      cwd: z.string(),
      root: z.string(),
    }),
    summary: z.boolean().optional(),
    cost: z.number(),
    tokens: TokenUsage,
    structured: z.any().optional(),
    variant: z.string().optional(),
    finish: z.string().optional(),
  }).meta({
    ref: "AssistantMessage",
  })
  export type Assistant = z.infer<typeof Assistant>

  export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
    ref: "Message",
  })
  export type Info = z.infer<typeof Info>

  export const VisibleInfo = z
    .discriminatedUnion("role", [
      User.extend({ orderKey: z.string().min(1) }),
      Assistant.extend({ orderKey: z.string().min(1) }),
    ])
    .meta({
      ref: "VisibleMessage",
    })
  export type VisibleInfo = z.infer<typeof VisibleInfo>

  export const Event = {
    Updated: BusEvent.define(
      "message.updated",
      z.object({
        info: VisibleInfo,
      }),
      { tier: 3 },
    ),
    Removed: BusEvent.define(
      "message.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
      }),
      { tier: 3 },
    ),
    PartUpdated: BusEvent.define(
      "message.part.updated",
      z.object({
        orderKey: z.string().min(1),
        part: VisiblePart,
      }),
      { tier: 3 },
    ),
    PartDelta: BusEvent.define(
      "message.part.delta",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        partID: z.string(),
        field: z.string(),
        delta: z.string(),
      }),
      { tier: 3 },
    ),
    PartRemoved: BusEvent.define(
      "message.part.removed",
      z.object({
        sessionID: z.string(),
        messageID: z.string(),
        partID: z.string(),
      }),
      { tier: 3 },
    ),
  }

  export const WithParts = z.object({
    info: Info,
    parts: z.array(Part),
  })
  export type WithParts = z.infer<typeof WithParts>

  export const VisibleWithParts = z
    .object({
      info: VisibleInfo,
      parts: z.array(VisiblePart),
    })
    .meta({
      ref: "VisibleMessageWithParts",
    })
  export type VisibleWithParts = z.infer<typeof VisibleWithParts>

  /**
   * Tools whose output is a snapshot of current task state (no side effects,
   * no delta value once superseded). Older calls' outputs are projected to a
   * short "superseded" note when a later call to the same tool exists in the
   * same session â€” this prevents tool results from piling up in the prompt
   * as the orchestrator reads state every turn. DB rows are NOT modified;
   * projection runs only at prompt-assembly time so UI / audit keeps full
   * fidelity.
   *
   * The source-of-truth for membership is `STATEFUL_SNAPSHOT_TOOL_NAMES` in
   * `orchestrator/tools.ts`, co-located with the tool definitions so adding
   * or renaming a stateful tool forces the developer to look at this list.
   * We import it (rather than re-declaring) so the two cannot drift apart.
   */
  export const STATEFUL_SNAPSHOT_TOOLS: ReadonlySet<string> = new Set(STATEFUL_SNAPSHOT_TOOL_NAMES)

  export interface ToModelMessagesOptions {
    stripMedia?: boolean
    toolOutputMaxChars?: number
    preserveAssistantErrors?: boolean
    omitAssistantReasoning?: boolean
  }

  function compactToolOutput(text: string, maxChars: number | undefined): string {
    if (!maxChars || maxChars <= 0 || text.length <= maxChars) return text
    const head = Math.max(0, Math.floor(maxChars * 0.7))
    const tail = Math.max(0, maxChars - head)
    return [
      text.slice(0, head).trimEnd(),
      `[Tool output truncated for compaction: ${text.length} chars total, ${text.length - maxChars} chars omitted]`,
      text.slice(text.length - tail).trimStart(),
    ].join("\n")
  }

  function assistantErrorText(error: unknown): string {
    const serialized = (() => {
      try {
        return JSON.stringify(error)
      } catch {
        return String(error)
      }
    })()
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>
      const name = typeof record.name === "string" ? record.name : "AssistantError"
      const message = typeof record.message === "string" ? record.message : serialized
      const status = typeof record.statusCode === "number" ? ` status=${record.statusCode}` : ""
      return `[Assistant error preserved for compaction: ${name}${status}: ${message}]\n${serialized}`
    }
    return `[Assistant error preserved for compaction: ${serialized}]`
  }

  export async function toModelMessages(
    input: WithParts[],
    model: Provider.Model,
    options: ToModelMessagesOptions = {},
  ): Promise<ModelMessage[]> {
    const result: UIMessage[] = []
    const toolNames = new Set<string>()

    // Pre-pass: for each stateful-snapshot tool, find the callID of its
    // latest invocation. Any earlier invocation's output will be projected
    // to a short "[superseded by later call]" note below, keeping only the
    // live snapshot's full text in the prompt. Walking in reverse lets us
    // short-circuit once we have the latest for every tool we've seen.
    // Both completed and error states are treated as "a call happened" â€”
    // an older error result is just as obsolete as an older success once a
    // newer call exists, and leaving it in the prompt encourages the model
    // to reason about stale failures.
    const latestStatefulCallIDs = new Set<string>()
    const seenStatefulTools = new Set<string>()
    for (let i = input.length - 1; i >= 0; i--) {
      const msg = input[i]
      for (let j = msg.parts.length - 1; j >= 0; j--) {
        const p = msg.parts[j]
        if (
          p.type === "tool" &&
          STATEFUL_SNAPSHOT_TOOLS.has(p.tool) &&
          (p.state.status === "completed" || p.state.status === "error") &&
          !seenStatefulTools.has(p.tool)
        ) {
          seenStatefulTools.add(p.tool)
          latestStatefulCallIDs.add(p.callID)
        }
      }
    }
    // Track media from tool results that need to be injected as user messages
    // for providers that don't support media in tool results.
    //
    // OpenAI-compatible APIs only support string content in tool results, so we need
    // to extract media and inject as user messages. Other SDKs (anthropic, google,
    // bedrock) handle type: "content" with media parts natively.
    //
    // Only apply this workaround if the model actually supports image input -
    // otherwise there's no point extracting images.
    const supportsMediaInToolResults = (() => {
      if (model.api.npm === "@ai-sdk/anthropic") return true
      if (model.api.npm === "@ai-sdk/openai") return true
      if (model.api.npm === "@ai-sdk/amazon-bedrock") return true
      if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
      if (model.api.npm === "@ai-sdk/google") {
        const id = model.api.id.toLowerCase()
        return id.includes("gemini-3") && !id.includes("gemini-2")
      }
      return false
    })()

    // AI SDK v6 invokes tool.toModelOutput with an args object
    // ({ toolCallId, input, output }), not a raw output. v5 passed `output`
    // directly. Reading the wrapped argument as if it were the output gave
    // outputObject.text === undefined for every tool result, which the v6
    // ToolModelOutput zod schema rejected ("expected string, received
    // undefined" at value[0].text), surfacing as
    // `Invalid prompt: The messages do not match the ModelMessage[] schema`
    // and a hard orchestrator retry loop.
    // Attachment URL â†’ base64 string for AI-SDK `image-data` content.
    //
    // Two URL shapes are accepted:
    //  1. `/attachment/<projectID>/<sha>.<ext>` ref â€” the canonical form
    //     post-2026-05-11 (attachment-store single-source contract).
    //     Bytes are read from `AttachmentStore` on demand and base64-encoded
    //     here, so `part.data` stores small refs instead of MB of inline
    //     base64. This is the OOM fix; the disk read is amortized across all
    //     subsequent turns that consume the same tool result.
    //  2. `data:<mime>;base64,<payload>` â€” legacy form for tool results
    //     produced before the migration. Pre-existing rows resolve through
    //     this branch until the migration script rewrites them; the
    //     Session.updatePart guard prevents new rows from taking this shape.
    //
    // Returns undefined when the URL is neither â€” the caller skips that
    // attachment rather than crashing the tool result.
    const sourceLabel = (attachment: { filename?: string; url: string }) =>
      attachment.filename ?? (attachment.url.startsWith("data:") ? "inline image data URL" : attachment.url)

    const dataUrlBytes = (url: string, context: string): Buffer | undefined => {
      if (!url.startsWith("data:")) return undefined
      return decodeDataUrlBase64Bytes(url, context)
    }

    const prepareModelBoundImage = async (
      attachment: { mime: string; url: string; filename?: string },
      bytes: Buffer,
    ) => {
      return await prepareModelImageInput({
        mime: attachment.mime,
        bytes,
        source: sourceLabel(attachment),
      })
    }

    const modelBoundFilePart = async (part: {
      mime: string
      url: string
      filename?: string
    }): Promise<{ url: string; note?: string }> => {
      const located = AttachmentStore.nameFromUrl(part.url)
      if (located) {
        const bytes = await AttachmentStore.read(located.projectID, located.name)
        const prepared = await prepareModelBoundImage(part, bytes)
        return {
          url: `data:${prepared.mime};base64,${prepared.bytes.toString("base64")}`,
          ...(prepared.note ? { note: prepared.note } : {}),
        }
      }
      const bytes = dataUrlBytes(part.url, `Message.toModelInput file part ${part.filename ?? part.mime}`)
      if (bytes !== undefined) {
        const prepared = await prepareModelBoundImage(part, bytes)
        return {
          url: `data:${prepared.mime};base64,${prepared.bytes.toString("base64")}`,
          ...(prepared.note ? { note: prepared.note } : {}),
        }
      }
      return { url: part.url }
    }

    const attachmentToBase64 = async (attachment: {
      mime: string
      url: string
      filename?: string
    }): Promise<{ mime: string; data: string; note?: string } | undefined> => {
      const bytes = dataUrlBytes(
        attachment.url,
        `Message.toModelOutput tool-result attachment ${attachment.filename ?? attachment.mime}`,
      )
      if (bytes !== undefined) {
        const prepared = await prepareModelBoundImage(attachment, bytes)
        return {
          mime: prepared.mime,
          data: prepared.bytes.toString("base64"),
          ...(prepared.note ? { note: prepared.note } : {}),
        }
      }
      const located = AttachmentStore.nameFromUrl(attachment.url)
      if (!located) return undefined
      const attachmentBytes = await AttachmentStore.read(located.projectID, located.name).catch((error) => {
        throw new Error(
          `Failed to read tool-result attachment ${attachment.url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        )
      })
      const prepared = await prepareModelBoundImage(attachment, attachmentBytes)
      return {
        mime: prepared.mime,
        data: prepared.bytes.toString("base64"),
        ...(prepared.note ? { note: prepared.note } : {}),
      }
    }

    const userFilePart = async (part: Message.FilePart): Promise<{ url: string; note?: string }> => {
      return await modelBoundFilePart(part)
    }

    // AI SDK v6 invokes tool.toModelOutput with an args object
    // ({ toolCallId, input, output }), not a raw output. v5 passed `output`
    // directly. Reading the wrapped argument as if it were the output gave
    // outputObject.text === undefined for every tool result, which the v6
    // ToolModelOutput zod schema rejected ("expected string, received
    // undefined" at value[0].text), surfacing as
    // `Invalid prompt: The messages do not match the ModelMessage[] schema`
    // and a hard orchestrator retry loop.
    //
    // toModelOutput is awaited by the AI SDK (see
    // node_modules/ai/dist/index.js: `await tool2.toModelOutput(...)`),
    // so reading attachment bytes from disk on demand is safe.
    const toModelOutput = async (args: { toolCallId: string; input: unknown; output: unknown }) => {
      const { output } = args
      if (typeof output === "string") {
        return { type: "text", value: output }
      }

      if (typeof output === "object" && output !== null) {
        const outputObject = output as {
          text?: string
          attachments?: Array<{ mime: string; url: string }>
        }

        const rawAttachments = outputObject.attachments ?? []
        const resolved = await Promise.all(rawAttachments.map(attachmentToBase64))
        const attachmentParts = resolved
          .filter((entry): entry is { mime: string; data: string; note?: string } => entry !== undefined)
          .map((entry) => ({
            type: "image-data" as const,
            mediaType: entry.mime,
            data: entry.data,
          }))
        const cropNotes = resolved
          .map((entry) => entry?.note)
          .filter((note): note is string => typeof note === "string" && note.length > 0)

        // ToolModelOutput.content also rejects a `text` part with undefined or
        // empty text (screenshot-only outputs) â€” drop the text part when the
        // tool produced no caption. Use `image-data` (v6 preferred) over the
        // deprecated `media` discriminator for base64 image attachments.
        const text = [
          typeof outputObject.text === "string" && outputObject.text.length > 0 ? outputObject.text : "",
          ...cropNotes,
        ]
          .filter((item) => item.length > 0)
          .join("\n\n")
        const textPart = text.length > 0 ? [{ type: "text" as const, text }] : []
        const value = [...textPart, ...attachmentParts]
        if (value.length === 0) return { type: "json", value: outputObject as never }
        return { type: "content", value }
      }

      return { type: "json", value: output as never }
    }

    function appendCompactionHandoffToLastUser(text: string) {
      const handoff = ["<compaction-handoff>", text, "</compaction-handoff>"].join("\n")
      for (let i = result.length - 1; i >= 0; i--) {
        const msg = result[i]
        if (msg.role !== "user") continue
        const firstText = msg.parts.find(
          (part): part is { type: "text"; text: string } =>
            typeof part === "object" &&
            part !== null &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
        )
        if (firstText) {
          firstText.text = `${firstText.text}\n\n${handoff}`
        } else {
          msg.parts.unshift({ type: "text", text: handoff })
        }
        return
      }
      result.push({
        id: Identifier.ascending("message"),
        role: "user",
        parts: [{ type: "text", text: handoff }],
      })
    }

    for (const msg of input) {
      if (msg.parts.length === 0) continue

      if (msg.info.role === "user") {
        const userMessage: UIMessage = {
          id: msg.info.id,
          role: "user",
          parts: [],
        }
        result.push(userMessage)
        for (const part of msg.parts) {
          if (part.type === "text")
            userMessage.parts.push({
              type: "text",
              text: part.text,
            })
          // Text files are decoded into text parts upstream; skip them here.
          // Binary file parts are only forwarded when the target model declares
          // the capability to handle them â€” otherwise the AI SDK / provider
          // conversion layer throws UnsupportedFunctionalityError at runtime.
          if (
            part.type === "file" &&
            !isDecodableText(part.mime, part.filename) &&
            part.mime !== "application/x-directory"
          ) {
            if (options.stripMedia) {
              userMessage.parts.push({
                type: "text",
                text: `[Attached ${part.mime}: ${part.filename ?? "file"} omitted from compaction context]`,
              })
              continue
            }
            const isImage = part.mime.startsWith("image/")
            const isPdf = part.mime === "application/pdf"
            const capable = (isImage && model.capabilities.input.image) || (isPdf && model.capabilities.input.pdf)
            if (capable) {
              const file = await userFilePart(part)
              userMessage.parts.push({
                type: "file",
                url: file.url,
                mediaType: part.mime,
                filename: part.filename,
              })
              if (file.note) userMessage.parts.push({ type: "text", text: file.note })
            }
          }

          if (part.type === "compaction" || part.type === "subtask") continue
        }
      }

      if (msg.info.role === "assistant") {
        if (CompactionHandoff.isValidSummaryMessage(msg.info)) {
          appendCompactionHandoffToLastUser(CompactionHandoff.renderMarkdown(msg.info.structured))
          continue
        }

        const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
        const media: Array<{ mime: string; url: string; filename?: string }> = []

        const shouldSkipErroredAssistant =
          msg.info.error &&
          !(
            Message.AbortedError.isInstance(msg.info.error) &&
            msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
          )
        if (shouldSkipErroredAssistant && !options.preserveAssistantErrors) {
          continue
        }
        const assistantMessage: UIMessage = {
          id: msg.info.id,
          role: "assistant",
          parts: [],
        }
        if (msg.info.error && options.preserveAssistantErrors) {
          assistantMessage.parts.push({
            type: "text",
            text: assistantErrorText(msg.info.error),
          })
        }
        for (const part of msg.parts) {
          if (part.type === "text")
            assistantMessage.parts.push({
              type: "text",
              text: part.text,
              ...(differentModel ? {} : { providerMetadata: part.metadata }),
            })
          if (part.type === "step-start")
            assistantMessage.parts.push({
              type: "step-start",
            })
          if (part.type === "tool") {
            toolNames.add(part.tool)
            if (part.state.status === "completed") {
              let outputText: string
              const isSupersededStatefulSnapshot =
                STATEFUL_SNAPSHOT_TOOLS.has(part.tool) && !latestStatefulCallIDs.has(part.callID)
              if (part.state.time.compacted) {
                outputText = "[Old tool result content cleared]"
              } else if (isSupersededStatefulSnapshot) {
                outputText = `[${part.tool} snapshot superseded by a later call in this session]`
              } else {
                outputText = compactToolOutput(part.state.output, options.toolOutputMaxChars)
              }
              const attachments =
                part.state.time.compacted || isSupersededStatefulSnapshot || options.stripMedia
                  ? []
                  : (part.state.attachments ?? [])

              // For providers that don't support media in tool results, extract media files
              // (images, PDFs) to be sent as a separate user message
              const isMediaAttachment = (a: { mime: string }) =>
                a.mime.startsWith("image/") || a.mime === "application/pdf"
              const mediaAttachments = attachments.filter(isMediaAttachment)
              const nonMediaAttachments = attachments.filter((a) => !isMediaAttachment(a))
              if (!supportsMediaInToolResults && mediaAttachments.length > 0) {
                media.push(...mediaAttachments)
              }
              const finalAttachments = supportsMediaInToolResults ? attachments : nonMediaAttachments

              const output =
                finalAttachments.length > 0
                  ? {
                      text: outputText,
                      attachments: finalAttachments,
                    }
                  : outputText

              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: replayToolInput(part.state.input),
                output,
                ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
              })
            }
            if (part.state.status === "error") {
              const isSupersededStatefulError =
                STATEFUL_SNAPSHOT_TOOLS.has(part.tool) && !latestStatefulCallIDs.has(part.callID)
              const errorText = isSupersededStatefulError
                ? `[${part.tool} error superseded by a later call in this session]`
                : renderToolFailureCause(part.state.failure)
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: replayToolInput(part.state.input),
                errorText,
                ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
              })
            }
          }
          if (part.type === "reasoning" && !options.omitAssistantReasoning) {
            assistantMessage.parts.push({
              type: "reasoning",
              text: part.text,
              ...(differentModel ? {} : { providerMetadata: part.metadata }),
            })
          }
          if (part.type === "patch") {
            // Wrap with <patch>...</patch> XML tag (same shape as the
            // compaction transcript at session/compaction.ts:145) so the
            // breadcrumb reads as a structural protocol element. The
            // earlier `[...]` prose-style marker was easy for the model
            // to mimic — it would echo `[Patch evidence: ...]` back as
            // its own assistant text, which then persisted and surfaced
            // as raw text in the overlay UI (overlay only chips
            // structured patch parts, not text parts containing the
            // marker). Pair this with the system-prompt clause forbidding
            // restatement of <patch> evidence.
            assistantMessage.parts.push({
              type: "text",
              text: `<patch>${Snapshot.formatPatchEvidence(part)}</patch>`,
            })
          }
        }
        // Structural validity check for provider replay. The chat-completion
        // contract (OpenAI / DeepSeek / vLLM / etc.) requires every assistant
        // message to carry `content` or `tool_calls`. When a stream early-dies
        // â€” provider truncates the response after opening a reasoning block,
        // socket dies, model returns nothing â€” the persisted assistant turn
        // ends up with only [step-start, reasoning("")] and `finish=null,
        // error=null`. Replaying it serialises to {role:"assistant",
        // content:"", tool_calls:undefined}; the provider rejects with HTTP
        // 4xx. Before restart recovery became passive, `monitorRuns` kept
        // replaying the same broken history, burning a deterministic retry storm
        // (orchestrator-stream-error artifact loop, 2026-05-08, see
        // stream early-death retry-fuse contract).
        // step-start is dropped by the global filter below; reasoning alone
        // is not visible content for chat-completion providers, so neither
        // counts toward "message has something the provider can read".
        const hasProviderVisibleContent = assistantMessage.parts.some(
          (part) =>
            (part.type === "text" && typeof part.text === "string" && part.text.length > 0) ||
            (typeof part.type === "string" && part.type.startsWith("tool-")),
        )
        if (assistantMessage.parts.length > 0 && hasProviderVisibleContent) {
          result.push(assistantMessage)
          // Inject pending media as a user message for providers that don't support
          // media (images, PDFs) in tool results
          if (media.length > 0) {
            const mediaParts = (
              await Promise.all(
                media.map(async (attachment) => {
                  const file = await modelBoundFilePart(attachment)
                  return [
                    {
                      type: "file" as const,
                      url: file.url,
                      mediaType: attachment.mime,
                      filename: attachment.filename,
                    },
                    ...(file.note ? [{ type: "text" as const, text: file.note }] : []),
                  ]
                }),
              )
            ).flat()
            result.push({
              id: Identifier.ascending("message"),
              role: "user",
              parts: [{ type: "text" as const, text: "Attached image(s) from tool result:" }, ...mediaParts],
            })
          }
        }
      }
    }

    const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

    // Reasoning blocks intentionally pass through unchanged. An earlier
    // attempt stripped reasoning from every assistant message except the
    // last to "save context" â€” that miscarried (rule 14: æ€€ç–‘è‡ªå·±ï¼Œæ²¡
    // æ•°æ®æ”¯æ’‘å°±æ˜¯èƒ¡è¯´):
    //   1. Stripping reasoning from messages BEFORE the cache breakpoint
    //      (provider/transform.ts:applyCaching marks system[0], system[-1],
    //      messages[-2], messages[-1]) changes the cache-prefix bytes
    //      every turn â€” every request would cache-miss and pay full input
    //      price for the entire history. Anthropic 5-min cache hit is
    //      0.1Ã— input price; cache write is 1.25Ã— â€” even a 50%-reasoning
    //      history costs ~80% MORE under the strip strategy than under
    //      pass-through with cache hits.
    //   2. Anthropic's thinking + tool_use protocol requires the
    //      immediately-prior assistant's thinking blocks to remain when
    //      the current request is a tool_result follow-up; "last assistant"
    //      in our store may not coincide with that protocol position.
    // Net: pass-through wins on cost AND correctness. Don't strip.

    return await convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
        tools,
      },
    )
  }

  function persistedPartCorruption(row: typeof PartTable.$inferSelect, error: z.ZodError): Message.PartErrorPart {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join(".") || "<root>",
      message: issue.message,
    }))
    const issueText = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
    const data: Record<string, unknown> =
      row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}
    return {
      id: row.id,
      sessionID: row.session_id,
      messageID: row.message_id,
      orderKey: timelineOrderKey({
        domain: "part",
        time: row.time_created,
        id: row.id,
      }),
      type: "part-error",
      title: "Persisted message part is corrupt",
      message: `Persisted part ${row.id} violates Message.VisiblePart: ${issueText}`,
      issues,
      ...(typeof data.type === "string" ? { originalType: data.type } : {}),
      ...(typeof data.tool === "string" ? { originalTool: data.tool } : {}),
    }
  }

  function persistedPart(row: typeof PartTable.$inferSelect): Message.Part {
    const part = {
      ...row.data,
      id: row.id,
      sessionID: row.session_id,
      messageID: row.message_id,
      orderKey: timelineOrderKey({
        domain: "part",
        time: row.time_created,
        id: row.id,
      }),
    }
    const parsed = VisiblePart.safeParse(part)
    if (!parsed.success) {
      return persistedPartCorruption(row, parsed.error)
    }
    return parsed.data
  }

  export const stream = fn(Identifier.schema("session"), async function* (sessionID) {
    const size = 50
    let offset = 0
    while (true) {
      const rows = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.session_id, sessionID))
          .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
          .limit(size)
          .offset(offset)
          .all(),
      )
      if (rows.length === 0) break

      const ids = rows.map((row) => row.id)
      const partsByMessage = new Map<string, Message.Part[]>()
      if (ids.length > 0) {
        const partRows = Database.use((db) =>
          db
            .select()
            .from(PartTable)
            .where(inArray(PartTable.message_id, ids))
            .orderBy(PartTable.message_id, PartTable.id)
            .all(),
        )
        for (const row of partRows) {
          const part = persistedPart(row)
          const list = partsByMessage.get(row.message_id)
          if (list) list.push(part)
          else partsByMessage.set(row.message_id, [part])
        }
      }

      for (const row of rows) {
        const info = { ...row.data, id: row.id, sessionID: row.session_id } as Message.Info
        yield {
          info,
          parts: partsByMessage.get(row.id) ?? [],
        }
      }

      offset += rows.length
      if (rows.length < size) break
    }
  })

  export const latestAcrossSessions = fn(
    z.object({
      sessionIDs: z.array(Identifier.schema("session")),
      limit: z.number().int().positive(),
    }),
    async (input) => {
      const sessionIDs = [...new Set(input.sessionIDs)]
      if (sessionIDs.length === 0) return [] as Message.WithParts[]
      const rows = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(inArray(MessageTable.session_id, sessionIDs))
          .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
          .limit(input.limit)
          .all(),
      )
      const ids = rows.map((row) => row.id)
      const partsByMessage = new Map<string, Message.Part[]>()
      if (ids.length > 0) {
        const partRows = Database.use((db) =>
          db
            .select()
            .from(PartTable)
            .where(inArray(PartTable.message_id, ids))
            .orderBy(PartTable.message_id, PartTable.id)
            .all(),
        )
        for (const row of partRows) {
          const part = persistedPart(row)
          const list = partsByMessage.get(row.message_id)
          if (list) list.push(part)
          else partsByMessage.set(row.message_id, [part])
        }
      }
      return rows
        .map((row) => ({
          info: { ...row.data, id: row.id, sessionID: row.session_id } as Message.Info,
          parts: partsByMessage.get(row.id) ?? [],
        }))
        .reverse()
    },
  )

  export const parts = fn(Identifier.schema("message"), async (message_id) => {
    const rows = Database.use((db) =>
      db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all(),
    )
    return rows.map(persistedPart)
  })

  export const get = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
    }),
    async (input): Promise<WithParts> => {
      const row = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
          .get(),
      )
      if (!row) throw new NotFoundError({ message: `Message not found: ${input.messageID}` })
      const info = { ...row.data, id: row.id, sessionID: row.session_id } as Message.Info
      return {
        info,
        parts: await parts(input.messageID),
      }
    },
  )

  export async function filterCompacted(stream: AsyncIterable<Message.WithParts>) {
    const result = [] as Message.WithParts[]
    const completed = new Set<string>()
    let retain:
      | {
          tailID?: string
          anchorID?: string
          afterCompactionIndex: number
          tailSatisfied: boolean
        }
      | undefined
    for await (const msg of stream) {
      if (retain) {
        if (!retain.tailSatisfied) {
          result.push(msg)
          if (msg.info.id === retain.tailID) {
            if (msg.info.role !== "user") {
              result.splice(retain.afterCompactionIndex)
              retain = undefined
              break
            }
            retain.tailSatisfied = true
            if (!retain.anchorID || msg.info.id === retain.anchorID) {
              retain = undefined
              break
            }
          }
          continue
        }
        if (retain.anchorID && msg.info.id === retain.anchorID) {
          result.push(msg)
          retain = undefined
          break
        }
        continue
      }
      result.push(msg)
      if (msg.info.role === "user" && completed.has(msg.info.id)) {
        const part = msg.parts.find((item): item is Message.CompactionPart => item.type === "compaction")
        if (!part) continue
        if (part.anchor_id === msg.info.id) {
          const markerIndex = result.length - 1
          const summaryIndex = result.findIndex(
            (candidate) =>
              candidate.info.role === "assistant" &&
              candidate.info.parentID === msg.info.id &&
              CompactionHandoff.isValidSummaryMessage(candidate.info),
          )
          if (summaryIndex < 0) break
          const newer = result.slice(0, summaryIndex)
          const summary = result[summaryIndex]!
          if (part.tail_start_id) {
            const tailIndex = result.findIndex((candidate) => candidate.info.id === part.tail_start_id)
            const tail = tailIndex >= 0 ? result[tailIndex] : undefined
            if (tail && tail.info.role === "user" && tailIndex > summaryIndex && tailIndex < markerIndex) {
              const tailBlock = result.slice(summaryIndex + 1, tailIndex + 1)
              result.splice(0, result.length, ...newer, ...tailBlock, summary, msg)
              break
            }
          }
          result.splice(0, result.length, ...newer, summary, msg)
          break
        }
        if (!part.tail_start_id && !part.anchor_id) break
        retain = {
          tailID: part.tail_start_id,
          anchorID: part.anchor_id,
          afterCompactionIndex: result.length,
          tailSatisfied: !part.tail_start_id,
        }
        if (!part.tail_start_id && !part.anchor_id) break
        continue
      }
      if (msg.info.role === "assistant" && CompactionHandoff.isValidSummaryMessage(msg.info))
        completed.add(msg.info.parentID)
    }
    if (retain && !retain.tailSatisfied) result.splice(retain.afterCompactionIndex)
    result.reverse()
    const markerIndex = result.findIndex((msg) =>
      msg.parts.some((part): part is Message.CompactionPart => part.type === "compaction" && !!part.anchor_id),
    )
    if (markerIndex >= 0) {
      const marker = result[markerIndex]
      const part = marker.parts.find((item): item is Message.CompactionPart => item.type === "compaction")
      const anchorIndex = part?.anchor_id ? result.findIndex((msg) => msg.info.id === part.anchor_id) : -1
      if (anchorIndex >= 0 && markerIndex > anchorIndex + 1) {
        let markerBlockEnd = markerIndex + 1
        while (markerBlockEnd < result.length) {
          const candidate = result[markerBlockEnd]
          if (candidate.info.role !== "assistant") break
          if (candidate.info.parentID !== marker.info.id) break
          if (!CompactionHandoff.isValidSummaryMessage(candidate.info)) break
          markerBlockEnd++
        }
        const markerBlock = result.splice(markerIndex, markerBlockEnd - markerIndex)
        result.splice(anchorIndex + 1, 0, ...markerBlock)
      }
    }
    return result
  }

  export function fromError(e: unknown, ctx: { providerID: string }) {
    switch (true) {
      case e instanceof DOMException && e.name === "AbortError":
        return new Message.AbortedError(
          { message: e.message },
          {
            cause: e,
          },
        ).toObject()
      case Message.OutputLengthError.isInstance(e):
        return e
      case Message.StructuredOutputPayloadError.isInstance(e):
        return e.toObject()
      case ModelImageInputTooLargeError.isInstance(e):
        return e.toObject()
      case Snapshot.SnapshotEmptyTreeError.isInstance(e):
        return e.toObject()
      case Snapshot.SnapshotIntegrityError.isInstance(e):
        return e.toObject()
      case LoadAPIKeyError.isInstance(e):
        return new Message.AuthError(
          {
            providerID: ctx.providerID,
            message: e.message,
          },
          { cause: e },
        ).toObject()
      case (e as SystemError)?.code === "ECONNRESET":
        return new Message.APIError(
          {
            message: "Connection reset by server",
            isRetryable: true,
            metadata: {
              code: (e as SystemError).code ?? "",
              syscall: (e as SystemError).syscall ?? "",
              message: (e as SystemError).message ?? "",
            },
          },
          { cause: e },
        ).toObject()
      case APICallError.isInstance(e):
        const parsed = ProviderError.parseAPICallError({
          providerID: ctx.providerID,
          error: e,
        })
        if (parsed.type === "context_overflow") {
          return new Message.ContextOverflowError(
            {
              message: parsed.message,
              responseBody: parsed.responseBody,
            },
            { cause: e },
          ).toObject()
        }

        return new Message.APIError(
          {
            message: parsed.message,
            statusCode: parsed.statusCode,
            isRetryable: parsed.isRetryable,
            responseHeaders: parsed.responseHeaders,
            responseBody: parsed.responseBody,
            metadata: parsed.metadata,
          },
          { cause: e },
        ).toObject()
      case e instanceof Error && /LLM stream stalled|stream inactivity/i.test(e.message):
        return new Message.APIError(
          {
            message: e.message,
            isRetryable: true,
          },
          { cause: e },
        ).toObject()
      case e instanceof Error:
        return new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
      default:
        try {
          const parsed = ProviderError.parseStreamError(e)
          if (parsed) {
            if (parsed.type === "context_overflow") {
              return new Message.ContextOverflowError(
                {
                  message: parsed.message,
                  responseBody: parsed.responseBody,
                },
                { cause: e },
              ).toObject()
            }
            return new Message.APIError(
              {
                message: parsed.message,
                isRetryable: parsed.isRetryable,
                responseBody: parsed.responseBody,
              },
              {
                cause: e,
              },
            ).toObject()
          }
        } catch {}
        return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
    }
  }
}
