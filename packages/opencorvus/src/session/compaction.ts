import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { Message } from "./message"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { EffectiveConfig } from "@/config/effective"
import { MemoryFlush } from "@/memory/flush"
import { resolveAgentModel } from "@/agent/model"
import { ContextBudget } from "./context-budget"
import { CompactionHandoff } from "./compaction-handoff"
import { renderToolFailureCause } from "./tool-failure-cause"
import { InstructionPrompt } from "./instruction"
import { TaskPlan } from "@/memory/task-plan"
import { Scratchpad } from "@/memory/scratchpad"
import { Snapshot } from "@/snapshot"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import type { ModelMessage, StopCondition, ToolSet } from "ai"
import { SessionLoop } from "./loop"
import { Todo } from "./todo"
import { SessionControl } from "./control"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const TRANSCRIPT_FIELD_MAX_CHARS = 30_000
  const DISPATCH_ANCHOR_REFERENCE_MAX_CHARS = 4_000
  type Turn = {
    start: number
    end: number
    id: string
  }

  type Tail = {
    start: number
    id: string
  }

  type SelectedCompactionInput = {
    anchor_id?: string
    head: Message.WithParts[]
    tail_start_id?: string
  }

  type CompletedCompaction = {
    userIndex: number
    assistantIndex: number
    handoff: CompactionHandoff.Info
  }

  export type DispatchAnchorReference = {
    id: string
    text: string
  }

  export async function isOverflow(input: {
    tokens: Message.Assistant["tokens"]
    model: Provider.Model
    sessionID?: string
  }) {
    const config = input.sessionID
      ? await EffectiveConfig.effective({ sessionID: input.sessionID })
      : await Config.get()
    return ContextBudget.isUsageOverflow({ config, tokens: input.tokens, model: input.model })
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  function userText(message: Message.WithParts) {
    return message.parts
      .filter((part): part is Message.TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
  }

  function compactTranscriptField(text: string, maxChars = TRANSCRIPT_FIELD_MAX_CHARS) {
    if (text.length <= maxChars) return text
    const head = Math.max(0, Math.floor(maxChars * 0.7))
    const tail = Math.max(0, maxChars - head)
    return [
      text.slice(0, head).trimEnd(),
      `[omitted ${text.length - maxChars} chars from compaction transcript]`,
      text.slice(text.length - tail).trimStart(),
    ].join("\n")
  }

  function renderDispatchAnchorReference(input: DispatchAnchorReference) {
    return [
      "The dispatch anchor user message below is preserved outside the compacted range and remains visible after compaction by anchor_id.",
      "Do not copy it into userMessages[]; userMessages[] covers only post-anchor user turns from the compacted history.",
      "<dispatch-anchor-reference>",
      `message_id: ${input.id}`,
      `characters: ${input.text.length}`,
      "<dispatch-anchor-excerpt>",
      compactTranscriptField(input.text, DISPATCH_ANCHOR_REFERENCE_MAX_CHARS),
      "</dispatch-anchor-excerpt>",
      "</dispatch-anchor-reference>",
    ].join("\n")
  }

  function escapeTranscriptText(text: string) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  }

  function transcriptText(text: string) {
    return escapeTranscriptText(compactTranscriptField(text))
  }

  function jsonForTranscript(value: unknown) {
    try {
      return transcriptText(JSON.stringify(value))
    } catch {
      return transcriptText(String(value))
    }
  }

  function assistantErrorText(error: unknown) {
    try {
      return transcriptText(JSON.stringify(error))
    } catch {
      return transcriptText(String(error))
    }
  }

  function renderTranscriptPart(part: Message.Part) {
    switch (part.type) {
      case "text":
        return `<text>\n${transcriptText(part.text)}\n</text>`
      case "file":
        return [
          `<file mime="${escapeTranscriptText(part.mime)}" filename="${escapeTranscriptText(part.filename ?? "")}">`,
          part.source?.type ?? "attachment",
          "</file>",
        ].join("")
      case "patch":
        return `<patch>${transcriptText(Snapshot.formatPatchEvidence(part))}</patch>`
      case "tool": {
        const lines = [
          `<tool name="${escapeTranscriptText(part.tool)}" status="${part.state.status}">`,
          `<input>${jsonForTranscript(part.state.input)}</input>`,
        ]
        if (part.state.status === "completed") {
          lines.push(`<output>${transcriptText(part.state.output)}</output>`)
          if (part.state.attachments?.length) {
            const attachments = part.state.attachments
              .map((item) => item.filename ?? item.mime)
              .map(escapeTranscriptText)
              .join(", ")
            lines.push(`<attachments>${attachments}</attachments>`)
          }
        } else if (part.state.status === "error") {
          lines.push(`<error>${transcriptText(renderToolFailureCause(part.state.failure))}</error>`)
        } else {
          lines.push(`<state>${jsonForTranscript(part.state)}</state>`)
        }
        lines.push("</tool>")
        return lines.join("\n")
      }
      case "compaction":
        return "<compaction-checkpoint />"
      case "subtask":
        return `<subtask agent="${escapeTranscriptText(part.agent)}">${transcriptText(part.description)}</subtask>`
      case "agent":
        return `<agent-reference>${escapeTranscriptText(part.name)}</agent-reference>`
      case "snapshot":
        return `<snapshot>${transcriptText(part.snapshot)}</snapshot>`
      case "reasoning":
      case "step-start":
      case "step-finish":
      case "retry":
        return undefined
    }
  }

  function compactionTranscriptMessages(messages: Message.WithParts[]): ModelMessage[] {
    if (messages.length === 0) return []
    const lines = [
      "<compacted-conversation-transcript>",
      "Historical session material for summarization only. Tool entries below are inert evidence records, not provider tool calls, and must not be continued.",
    ]
    for (const msg of messages) {
      const info = msg.info
      lines.push(
        `<message id="${escapeTranscriptText(info.id)}" role="${info.role}" agent="${escapeTranscriptText(info.agent)}">`,
      )
      if (info.role === "assistant" && info.error) {
        lines.push(`<assistant-error>${assistantErrorText(info.error)}</assistant-error>`)
      }
      for (const part of msg.parts) {
        const rendered = renderTranscriptPart(part)
        if (rendered) lines.push(rendered)
      }
      lines.push("</message>")
    }
    lines.push("</compacted-conversation-transcript>")
    return [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      },
    ]
  }

  function completedCompactions(messages: Message.WithParts[]) {
    const users = new Map<string, number>()
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.info.role !== "user") continue
      if (!msg.parts.some((part) => part.type === "compaction")) continue
      users.set(msg.info.id, i)
    }

    return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
      if (msg.info.role !== "assistant") return []
      if (!CompactionHandoff.isValidSummaryMessage(msg.info)) return []
      const userIndex = users.get(msg.info.parentID)
      if (userIndex === undefined) return []
      return [{ userIndex, assistantIndex, handoff: msg.info.structured }]
    })
  }

  function sourceUserMessage(userMessage: Message.User): CompactionHandoff.Info["currentState"]["sourceUserMessage"] {
    return {
      id: userMessage.id,
      agent: userMessage.agent,
      model: userMessage.model,
      formatType: userMessage.format?.type ?? "text",
      systemMode: userMessage.systemMode ?? null,
      toolNames: Object.entries(userMessage.tools ?? {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .sort(),
      variant: userMessage.variant ?? null,
      extraKeys: Object.keys(userMessage.extra ?? {}).sort(),
    }
  }

  function patchEvidence(messages: Message.WithParts[]) {
    const lines: string[] = []
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "patch") continue
        lines.push(`- ${Snapshot.formatPatchEvidence(part)}`)
      }
    }
    return lines.length ? ["<patch-evidence>", ...lines, "</patch-evidence>"].join("\n") : undefined
  }

  function selectedHeadEvidenceRequirements(input: {
    messages: Message.WithParts[]
    instructionPaths: string[]
    sourceUserMessageID: string
    todos?: Todo.Info[]
    previousHandoff?: CompactionHandoff.Info
    summarizePatchEvidence?: typeof Snapshot.patchEvidenceSummary
  }): CompactionHandoff.EvidenceRequirements {
    let userMessages = false
    let richContext = input.previousHandoff !== undefined
    const patchFiles = new Set<string>()
    const errorNames = new Set<string>()
    const summarizePatchEvidence = input.summarizePatchEvidence ?? Snapshot.patchEvidenceSummary
    for (const msg of input.messages) {
      if (msg.info.role === "user") {
        userMessages ||= msg.parts.some((part) => part.type === "text" && part.text.trim().length > 0)
      }
      if (msg.info.role === "assistant" && msg.info.error) errorNames.add(msg.info.error.name)
      for (const part of msg.parts) {
        if (
          (part.type === "text" && part.text.trim().length > 0) ||
          part.type === "tool" ||
          part.type === "patch" ||
          part.type === "snapshot" ||
          part.type === "file"
        ) {
          richContext = true
        }
        if (part.type === "patch") {
          const summary = summarizePatchEvidence(part)
          for (const file of summary.filesPreviewHead) patchFiles.add(file)
          for (const file of summary.filesPreviewTail) patchFiles.add(file)
        }
        if (part.type === "tool" && part.state.status === "error") errorNames.add(`${part.tool} tool error`)
      }
    }
    return {
      sourceUserMessageID: input.sourceUserMessageID,
      instructionPaths: input.instructionPaths,
      patchFiles: [...patchFiles],
      errorNames: [...errorNames],
      todos: input.todos ?? [],
      userMessages,
      richContext,
      fileEvidence: patchFiles.size > 0,
      errorsAndBlockers: errorNames.size > 0,
      acceptanceCriteria: userMessages || (input.previousHandoff?.acceptanceCriteria.length ?? 0) > 0,
      previousHandoff: input.previousHandoff
        ? {
            acceptanceCriteria: input.previousHandoff.acceptanceCriteria,
            workingContext: input.previousHandoff.workingContext,
            chronology: input.previousHandoff.chronology.map((item) => item.event),
            decisions: input.previousHandoff.decisions.map((item) => item.decision),
            evidence: input.previousHandoff.evidence.map((item) => item.value),
            files: input.previousHandoff.files.map((item) => item.path),
            testsAndCommands: input.previousHandoff.testsAndCommands.map((item) => item.command),
            errorsAndBlockers: input.previousHandoff.errorsAndBlockers.map((item) => item.issue),
            userMessages: input.previousHandoff.userMessages,
            nextActions: input.previousHandoff.nextActions,
            openRisks: input.previousHandoff.openRisks,
          }
        : undefined,
    }
  }

  function activeBuildContractsForSession(sessionID: string): CompactionHandoff.Info["activeBuildContracts"] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.kind, "build_session_contract"),
            sql`json_extract(${EngineArtifactTable.payload}, '$.session_id') = ${sessionID}`,
          ),
        )
        .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
        .limit(8)
        .all(),
    )
    return rows.map((row) => {
      const payload = row.payload as Record<string, any>
      return {
        sessionID: String(payload.session_id ?? sessionID),
        goalID: String(payload.goal_id),
        goalRunID: String(payload.goal_run_id),
        artifactID: row.id,
        sourceArtifactIDs: Array.isArray(payload.source_artifact_ids)
          ? payload.source_artifact_ids.filter(
              (item: unknown): item is string => typeof item === "string" && item.length > 0,
            )
          : [],
        digest: String(payload.digest),
      }
    })
  }

  async function runtimeContext(input: {
    sessionID: string
    userMessage: Message.User
    selectedHead: Message.WithParts[]
    previousHandoff?: CompactionHandoff.Info
    focus?: string
  }) {
    const instructionPaths = Array.from(await InstructionPrompt.systemPaths())
    const taskPlan = TaskPlan.toMarkdown(input.sessionID)
    const todos = Todo.get(input.sessionID)
    const scratchpad = Scratchpad.get(input.sessionID)
    const patches = patchEvidence(input.selectedHead)
    const activeBuildContracts = activeBuildContractsForSession(input.sessionID)
    const evidenceRequirements = selectedHeadEvidenceRequirements({
      messages: input.selectedHead,
      instructionPaths,
      sourceUserMessageID: input.userMessage.id,
      todos,
      previousHandoff: input.previousHandoff,
    })
    const requiredEvidence = CompactionHandoff.renderRequiredEvidence(evidenceRequirements)
    const text = [
      "<handoff-runtime-state>",
      "Authoritative instruction files. Do not copy their full contents into the handoff; list these paths in durableInstructionSources.",
      ...instructionPaths.map((p) => `- ${p}`),
      "",
      "Source user message contract:",
      JSON.stringify(sourceUserMessage(input.userMessage), null, 2),
      "",
      "Active build-session contracts for this session. Copy these exact ids into activeBuildContracts; they are the durable source for build retry context after compaction:",
      JSON.stringify(activeBuildContracts, null, 2),
      "",
      "Current todos. Copy this JSON array exactly into CompactionHandoff.todos; preserve item order, content, status, and priority:",
      JSON.stringify(todos, null, 2),
      input.focus ? ["", "Manual compaction focus:", input.focus].join("\n") : "",
      taskPlan ? ["", "Current task plan:", taskPlan].join("\n") : "",
      scratchpad.trim()
        ? [
            "",
            `Scratchpad is present with ${scratchpad.length} characters. Record scratchpad-present evidence; do not copy the scratchpad content.`,
          ].join("\n")
        : "",
      ["", requiredEvidence].join("\n"),
      patches ? ["", patches].join("\n") : "",
      "</handoff-runtime-state>",
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n")
    return {
      text,
      evidenceRequirements,
    }
  }

  export function buildPrompt(input: {
    previousSummary?: string
    previousHandoff?: CompactionHandoff.Info
    context: string[]
    runtime: string
    dispatchAnchor?: DispatchAnchorReference
  }) {
    const dispatchAnchorBlock = input.dispatchAnchor ? renderDispatchAnchorReference(input.dispatchAnchor) : undefined
    const previousHandoff = input.previousHandoff ? JSON.stringify(input.previousHandoff, null, 2) : undefined
    const anchor = previousHandoff
      ? [
          "Update the anchored structured handoff below using the conversation history above.",
          "Preserve still-true details, remove stale details, and merge in the new facts.",
          "The prior handoff is authoritative structured data; rendered Markdown summaries are display-only and must not be treated as the merge source.",
          "<previous-structured-handoff>",
          previousHandoff,
          "</previous-structured-handoff>",
        ].join("\n")
      : input.previousSummary
        ? [
            "Update the anchored summary below using the conversation history above.",
            "Preserve still-true details, remove stale details, and merge in the new facts.",
            "<previous-summary>",
            input.previousSummary,
            "</previous-summary>",
          ].join("\n")
        : "Create a new anchored summary from the conversation history above."
    return [
      dispatchAnchorBlock,
      anchor,
      CompactionHandoff.MODEL_OUTPUT_INSTRUCTIONS,
      "CompactionHandoff schema:",
      CompactionHandoff.JSON_SCHEMA_DESCRIPTION,
      input.runtime,
      ...input.context,
    ]
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .join("\n\n")
  }

  export function requestBudget(input: { messages: ModelMessage[]; config: Config.Info; model: Provider.Model }) {
    const estimatedTokens = Token.estimate(JSON.stringify(input.messages))
    const usableBudget = ContextBudget.usable({ config: input.config, model: input.model })
    return {
      estimatedTokens,
      usableBudget,
      exceeds: input.model.limit.context > 0 && estimatedTokens > usableBudget,
    }
  }

  export function handoffOutputFormat() {
    return {
      type: "json_schema" as const,
      schema: z.toJSONSchema(CompactionHandoff.Schema) as Record<string, any>,
      retryCount: 2,
    }
  }

  export function structuredHandoffStopCondition(input: {
    isCaptured: () => boolean
    retryCount: number
  }): StopCondition<ToolSet> {
    const maxAttempts = Math.max(1, input.retryCount + 1)
    return ({ steps }) => input.isCaptured() || steps.length >= maxAttempts
  }

  export function validateHandoffPayload(
    output: unknown,
    requirements: CompactionHandoff.EvidenceRequirements,
  ): { success: true; data: CompactionHandoff.Info } | { success: false; error: string } {
    const parsed = CompactionHandoff.Schema.safeParse(output)
    if (!parsed.success) {
      return { success: false, error: z.prettifyError(parsed.error) }
    }
    const evidence = CompactionHandoff.validateMinimumEvidence(parsed.data, requirements)
    if (!evidence.success) {
      return { success: false, error: evidence.error }
    }
    return { success: true, data: parsed.data }
  }

  function turns(messages: Message.WithParts[]) {
    const result: Turn[] = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      // Turn boundaries follow real conversation starts and assistant step starts,
      // which keeps long dispatcher-owned build sessions compactable without a kind branch.
      const isUserBoundary = msg.info.role === "user" && !msg.parts.some((part) => part.type === "compaction")
      const isAssistantStepBoundary =
        msg.info.role === "assistant" && msg.parts.some((part) => part.type === "step-start")
      if (!isUserBoundary && !isAssistantStepBoundary) continue
      result.push({
        start: i,
        end: messages.length,
        id: msg.info.id,
      })
    }
    for (let i = 0; i < result.length - 1; i++) {
      result[i].end = result[i + 1].start
    }
    return result
  }

  async function estimate(input: { messages: Message.WithParts[]; model: Provider.Model }) {
    const msgs = compactionTranscriptMessages(input.messages)
    return Token.estimate(JSON.stringify(msgs))
  }

  async function selectCompactionInput(input: {
    messages: Message.WithParts[]
    config: Config.Info
    model: Provider.Model
  }): Promise<SelectedCompactionInput> {
    const limit = input.config.compaction?.tail_turns ?? ContextBudget.DEFAULT_TAIL_TURNS
    const firstUserIdx = input.messages.findIndex(
      (msg) => msg.info.role === "user" && !msg.parts.some((part) => part.type === "compaction"),
    )
    if (firstUserIdx < 0) return { head: [] }
    const anchor_id = input.messages[firstUserIdx].info.id
    if (limit <= 0) {
      const head = input.messages.slice(firstUserIdx + 1)
      return head.length ? { anchor_id, head } : { head: [] }
    }
    const budget = ContextBudget.preserveRecent({ config: input.config, model: input.model })
    const all = turns(input.messages)
    if (!all.length) return { head: [] }
    const recent = all.slice(-limit)
    const sizes = [] as number[]
    for (const turn of recent) {
      sizes.push(
        await estimate({
          messages: input.messages.slice(turn.start, turn.end),
          model: input.model,
        }),
      )
    }

    let total = 0
    let keep: Tail | undefined
    for (let i = recent.length - 1; i >= 0; i--) {
      const turn = recent[i]!
      const size = sizes[i]!
      if (total + size <= budget) {
        total += size
        const boundary = input.messages[turn.start]
        if (boundary?.info.role === "user") {
          keep = { start: turn.start, id: turn.id }
        }
        continue
      }
      if (!keep) log.info("tail fallback", { budget, size, total })
      break
    }

    if (!keep) {
      if (recent[0] && recent[0].start <= firstUserIdx + 1) return { head: [] }
      const head = input.messages.slice(firstUserIdx + 1)
      return head.length ? { anchor_id, head } : { head: [] }
    }
    if (keep.start <= firstUserIdx + 1) return { head: [] }
    return {
      anchor_id,
      head: input.messages.slice(firstUserIdx + 1, keep.start),
      tail_start_id: keep.id,
    }
  }

  function latestCompactionPruneRange(messages: Message.WithParts[]) {
    const latest = completedCompactions(messages).at(-1)
    if (!latest) return undefined
    const marker = messages[latest.userIndex]
    const markerPart = marker?.parts.find((part): part is Message.CompactionPart => part.type === "compaction")
    if (!marker || !markerPart) return undefined
    const anchorIndex = markerPart.anchor_id
      ? messages.findIndex((message) => message.info.id === markerPart.anchor_id)
      : messages.findIndex(
          (message) => message.info.role === "user" && !message.parts.some((part) => part.type === "compaction"),
        )
    if (anchorIndex < 0) return undefined
    const tailIndex = markerPart.tail_start_id
      ? messages.findIndex((message) => message.info.id === markerPart.tail_start_id)
      : -1
    if (markerPart.tail_start_id) {
      const tailMessage = tailIndex >= 0 ? messages[tailIndex] : undefined
      if (!tailMessage || tailMessage.info.role !== "user") return undefined
    }
    const markerOnAnchor = markerPart.anchor_id === marker.info.id
    const endIndex = tailIndex >= 0 ? tailIndex : markerOnAnchor ? latest.assistantIndex : latest.userIndex
    if (endIndex <= anchorIndex + 1) return undefined
    return {
      startIndex: anchorIndex + 1,
      endIndex,
      summaryID: messages[latest.assistantIndex]?.info.id,
      markerID: marker.info.id,
      tailID: markerPart.tail_start_id,
      anchorID: markerPart.anchor_id,
    }
  }

  function prunableToolParts(messages: Message.WithParts[]): Message.ToolPart[] {
    const range = latestCompactionPruneRange(messages)
    if (!range) return []
    let total = 0
    let pruned = 0
    const toPrune: Message.ToolPart[] = []
    for (let msgIndex = range.endIndex - 1; msgIndex >= range.startIndex; msgIndex--) {
      const msg = messages[msgIndex]
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type !== "tool") continue
        if (part.state.status !== "completed") continue
        if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
        if (part.state.time.compacted) continue
        const estimate = Token.estimate(part.state.output)
        total += estimate
        if (total > PRUNE_PROTECT) {
          pruned += estimate
          toPrune.push(part)
        }
      }
    }
    return pruned > PRUNE_MINIMUM ? toPrune : []
  }

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    const range = latestCompactionPruneRange(msgs)
    if (!range) {
      log.info("skipping prune because no structured compaction boundary covers old tool output", {
        sessionID: input.sessionID,
      })
      return
    }
    const toPrune = prunableToolParts(msgs)
    log.info("found prunable compacted-history tool outputs", {
      count: toPrune.length,
      summaryID: range.summaryID,
      markerID: range.markerID,
      anchorID: range.anchorID,
      tailID: range.tailID,
    })
    for (const part of toPrune) {
      if (part.state.status === "completed") {
        part.state.time.compacted = Date.now()
        await Session.updatePart(part)
      }
    }
    if (toPrune.length > 0) log.info("pruned", { count: toPrune.length })
  }

  export async function process(input: {
    parentID: string
    messages: Message.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
    overflow?: boolean
    focus?: string
    model?: {
      providerID: string
      modelID: string
    }
  }) {
    const parent = input.messages.findLast((m) => m.info.id === input.parentID)
    if (!parent || parent.info.role !== "user") {
      throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
    }
    const userMessage = parent.info as Message.User
    const compactionPart = parent.parts.find((part): part is Message.CompactionPart => part.type === "compaction")
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    const agent = await Agent.get("compaction", { config })
    const model = input.model
      ? await Provider.getModel(input.model.providerID, input.model.modelID, { config })
      : await resolveAgentModel(agent.name, { sessionID: input.sessionID })
    const history =
      compactionPart && input.messages.at(-1)?.info.id === input.parentID ? input.messages.slice(0, -1) : input.messages
    const prior = completedCompactions(history)
    const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
    const selected = await selectCompactionInput({
      messages: history.filter((_, index) => !hidden.has(index)),
      config,
      model,
    })
    if (selected.head.length === 0) {
      log.info("skipping compaction because no post-anchor head is compactable", {
        sessionID: input.sessionID,
        parentID: input.parentID,
      })
      return "stop"
    }
    const dispatchAnchorMessage = selected.anchor_id
      ? history.find((msg) => msg.info.id === selected.anchor_id)
      : undefined
    const dispatchAnchor = dispatchAnchorMessage
      ? {
          id: dispatchAnchorMessage.info.id,
          text: userText(dispatchAnchorMessage),
        }
      : undefined

    const msg = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      agent: "compaction",
      variant: userMessage.variant,
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        total: 0,
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as Message.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Plugins may inject extra evidence context; OpenCorvus owns the handoff schema and prompt contract.
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [] as string[] },
    )
    const runtime = await runtimeContext({
      sessionID: input.sessionID,
      userMessage,
      selectedHead: selected.head,
      previousHandoff: prior.at(-1)?.handoff,
      focus: input.focus ?? compactionPart?.focus,
    })
    const promptText = buildPrompt({
      previousHandoff: prior.at(-1)?.handoff,
      context: compacting.context,
      runtime: runtime.text,
      dispatchAnchor,
    })
    const providerMessages: ModelMessage[] = [
      ...compactionTranscriptMessages(selected.head),
      {
        role: "user",
        content: [
          {
            type: "text",
            text: promptText,
          },
        ],
      },
    ]
    const format = handoffOutputFormat()
    const budget = requestBudget({ messages: providerMessages, config, model })
    if (budget.exceeds) {
      processor.message.error = new Message.ContextOverflowError({
        message: `Compaction request exceeds model context budget before provider call: estimated ${budget.estimatedTokens} tokens, usable budget ${budget.usableBudget}.`,
      }).toObject()
      processor.message.finish = "error"
      await Session.updateMessage(processor.message)
      return "stop"
    }
    let structured: CompactionHandoff.Info | undefined
    const tools = {
      StructuredOutput: SessionLoop.prepareProviderTool({
        name: "StructuredOutput",
        source: "structured",
        model,
        tool: SessionLoop.createStructuredOutputTool({
          schema: format.schema,
          validate(output) {
            const parsed = validateHandoffPayload(output, runtime.evidenceRequirements)
            return parsed.success ? undefined : parsed.error
          },
          onSuccess(output) {
            const parsed = validateHandoffPayload(output, runtime.evidenceRequirements)
            if (!parsed.success) throw new Error(parsed.error)
            structured = parsed.data
          },
        }),
      }),
    }
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools,
      system: [],
      messages: providerMessages,
      model,
      toolChoice: SessionLoop.structuredOutputToolChoice(format, model),
      stopWhen: structuredHandoffStopCondition({
        isCaptured: () => structured !== undefined,
        retryCount: format.retryCount,
      }),
    })

    if (result === "compact") {
      processor.message.error = new Message.ContextOverflowError({
        message:
          "Session too large to compact: the compaction request exceeded the model context limit even after removing media attachments and truncating tool outputs.",
      }).toObject()
      processor.message.finish = "error"
      await Session.updateMessage(processor.message)
      return "stop"
    }

    if (processor.message.error) return "stop"
    if (!structured) {
      const toolErrors = (await Message.parts(processor.message.id)).flatMap((part) =>
        part.type === "tool" && part.state.status === "error"
          ? [`${part.tool}: ${renderToolFailureCause(part.state.failure)}`]
          : [],
      )
      const reason = toolErrors.length
        ? toolErrors.join("\n")
        : "Model ended the compaction turn without calling StructuredOutput."
      processor.message.error = new Message.StructuredOutputPayloadError({
        message: "Compaction handoff did not match the required structured contract.",
        reason,
      }).toObject()
      processor.message.finish = "error"
      await Session.updateMessage(processor.message)
      return "stop"
    }

    const rendered = CompactionHandoff.renderMarkdown(structured)
    processor.message.structured = structured
    processor.message.finish = processor.message.finish ?? "stop"
    await Session.updateMessage(processor.message)
    const textParts = (await Message.parts(processor.message.id)).filter(
      (part): part is Message.TextPart => part.type === "text",
    )
    if (textParts[0]) {
      await Session.updatePart({ ...textParts[0], text: rendered })
      for (const extra of textParts.slice(1)) {
        await Session.removePart({
          sessionID: extra.sessionID,
          messageID: extra.messageID,
          partID: extra.id,
        })
      }
    } else {
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: processor.message.id,
        sessionID: input.sessionID,
        type: "text",
        text: rendered,
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      } satisfies Message.TextPart)
    }

    if (compactionPart) {
      await Session.updatePart({
        ...compactionPart,
        auto: input.auto,
        overflow: input.overflow ?? compactionPart.overflow,
        focus: input.focus ?? compactionPart.focus,
        tail_start_id: selected.tail_start_id,
        anchor_id: selected.anchor_id,
      })
    } else {
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMessage.id,
        sessionID: input.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        focus: input.focus,
        tail_start_id: selected.tail_start_id,
        anchor_id: selected.anchor_id,
      } satisfies Message.CompactionPart)
    }

    Bus.publish(Event.Compacted, { sessionID: input.sessionID })

    // Flush compaction summary to persistent memory (async, non-blocking)
    MemoryFlush.flush({ sessionID: input.sessionID, messageID: processor.message.id }).catch((err) =>
      log.warn("memory flush after compaction failed", { sessionID: input.sessionID, err }),
    )

    return input.auto ? "continue" : "stop"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      source: Message.User,
      model: z
        .object({
          providerID: z.string(),
          modelID: z.string(),
        })
        .optional(),
      auto: z.boolean(),
      overflow: z.boolean().optional(),
      focus: z.string().optional(),
    }),
    async (input) => {
      if (input.source.sessionID !== input.sessionID) {
        throw new Error(
          `Compaction source message ${input.source.id} belongs to session ${input.source.sessionID}, not ${input.sessionID}`,
        )
      }
      const session = await Session.get(input.sessionID)
      if (input.auto) {
        const autoCompaction = SessionLoop.automaticCompactionDecision({
          session,
          source: input.source,
        })
        if (!autoCompaction.decision.enabled) {
          const cause =
            autoCompaction.error instanceof Error && autoCompaction.error.message.length > 0
              ? `: ${autoCompaction.error.message}`
              : ""
          throw new Error(
            `Automatic compaction is disabled for workflow session kind ${session.kind} ` +
              `(reason=${autoCompaction.decision.reason})${cause}`,
          )
        }
      }
      SessionControl.create({
        sessionID: input.sessionID,
        kind: input.auto ? "compaction_request" : "manual_summarize",
        payload: {
          source_user_message_id: input.source.id,
          model: input.model,
          overflow: input.overflow === true,
          focus: input.focus,
        },
      })
    },
  )

  export const TestHooks = {
    selectCompactionInput,
    selectedHeadEvidenceRequirements,
    runtimeContext,
    compactionTranscriptMessages,
    structuredHandoffStopCondition,
    latestCompactionPruneRange,
    prunableToolParts,
  }
}
