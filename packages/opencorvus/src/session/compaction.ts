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
import { MemoryFlush } from "@/memory/flush"
import { resolveModelRef } from "@/agent/model"
import { ContextBudget } from "./context-budget"

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

  const COMPACTION_TOOL_OUTPUT_MAX_CHARS = 2_000
  const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

  type Turn = {
    start: number
    end: number
    id: string
  }

  type Tail = {
    start: number
    id: string
  }

  type CompletedCompaction = {
    userIndex: number
    assistantIndex: number
    summary: string | undefined
  }

  export async function isOverflow(input: { tokens: Message.Assistant["tokens"]; model: Provider.Model }) {
    const config = await Config.get()
    return ContextBudget.isUsageOverflow({ config, tokens: input.tokens, model: input.model })
  }

  export const PRUNE_MINIMUM = 20_000
  export const PRUNE_PROTECT = 40_000

  const PRUNE_PROTECTED_TOOLS = ["skill"]

  function summaryText(message: Message.WithParts) {
    const text = message.parts
      .filter((part): part is Message.TextPart => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim()
    return text || undefined
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
      if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
      const userIndex = users.get(msg.info.parentID)
      if (userIndex === undefined) return []
      return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
    })
  }

  function buildPrompt(input: { previousSummary?: string; context: string[] }) {
    const anchor = input.previousSummary
      ? [
          "Update the anchored summary below using the conversation history above.",
          "Preserve still-true details, remove stale details, and merge in the new facts.",
          "<previous-summary>",
          input.previousSummary,
          "</previous-summary>",
        ].join("\n")
      : "Create a new anchored summary from the conversation history above."
    return [anchor, SUMMARY_TEMPLATE, ...input.context].join("\n\n")
  }

  function turns(messages: Message.WithParts[]) {
    const result: Turn[] = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.info.role !== "user") continue
      if (msg.parts.some((part) => part.type === "compaction")) continue
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
    const msgs = await Message.toModelMessages(input.messages, input.model, {
      stripMedia: true,
      toolOutputMaxChars: COMPACTION_TOOL_OUTPUT_MAX_CHARS,
    })
    return Token.estimate(JSON.stringify(msgs))
  }

  async function splitTurn(input: {
    messages: Message.WithParts[]
    turn: Turn
    model: Provider.Model
    budget: number
  }) {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = await estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start]!.info.id,
      } satisfies Tail
    }
    return undefined
  }

  async function selectCompactionInput(input: {
    messages: Message.WithParts[]
    config: Config.Info
    model: Provider.Model
  }) {
    const limit = input.config.compaction?.tail_turns ?? ContextBudget.DEFAULT_TAIL_TURNS
    if (limit <= 0) return { head: input.messages, tail_start_id: undefined as string | undefined }
    const budget = ContextBudget.preserveRecent({ config: input.config, model: input.model })
    const all = turns(input.messages)
    if (!all.length) return { head: input.messages, tail_start_id: undefined as string | undefined }
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
        keep = { start: turn.start, id: turn.id }
        continue
      }
      const split = await splitTurn({
        messages: input.messages,
        turn,
        model: input.model,
        budget: budget - total,
      })
      if (split) keep = split
      else if (!keep) log.info("tail fallback", { budget, size, total })
      break
    }

    if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined as string | undefined }
    return {
      head: input.messages.slice(0, keep.start),
      tail_start_id: keep.id,
    }
  }

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  export async function prune(input: { sessionID: string }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = await Session.messages({ sessionID: input.sessionID })
    let total = 0
    let pruned = 0
    const toPrune: Message.ToolPart[] = []
    let turns = 0

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) break loop
            const estimate = Token.estimate(part.state.output)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              toPrune.push(part)
            }
          }
      }
    }
    log.info("found", { pruned, total })
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          await Session.updatePart(part)
        }
      }
      log.info("pruned", { count: toPrune.length })
    }
  }

  export async function process(input: {
    parentID: string
    messages: Message.WithParts[]
    sessionID: string
    abort: AbortSignal
    auto: boolean
  }) {
    const parent = input.messages.findLast((m) => m.info.id === input.parentID)
    if (!parent || parent.info.role !== "user") {
      throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
    }
    const userMessage = parent.info as Message.User
    const compactionPart = parent.parts.find((part): part is Message.CompactionPart => part.type === "compaction")
    const agent = await Agent.get("compaction")
    const userModel = await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
    const model = await resolveModelRef(agent.model, userModel)
    const config = await Config.get()
    const history = compactionPart && input.messages.at(-1)?.info.id === input.parentID
      ? input.messages.slice(0, -1)
      : input.messages
    const prior = completedCompactions(history)
    const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
    const selected = await selectCompactionInput({
      messages: history.filter((_, index) => !hidden.has(index)),
      config,
      model,
    })

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
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const promptText =
      compacting.prompt ?? buildPrompt({ previousSummary: prior.at(-1)?.summary, context: compacting.context })
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...(await Message.toModelMessages(selected.head, model, {
          stripMedia: true,
          toolOutputMaxChars: COMPACTION_TOOL_OUTPUT_MAX_CHARS,
        })),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
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

    if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
      await Session.updatePart({
        ...compactionPart,
        tail_start_id: selected.tail_start_id,
      })
    }

    if (processor.message.error) return "stop"
    Bus.publish(Event.Compacted, { sessionID: input.sessionID })

    // Flush compaction summary to persistent memory (async, non-blocking)
    MemoryFlush.flush(input.sessionID).catch((err) =>
      log.warn("memory flush after compaction failed", { sessionID: input.sessionID, err }),
    )

    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      agent: z.string(),
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      auto: z.boolean(),
      overflow: z.boolean().optional(),
    }),
    async (input) => {
      const msg = await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
    },
  )
}
