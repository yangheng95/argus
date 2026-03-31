import z from "zod"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { SessionCompaction } from "./compaction"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { ProviderTransform } from "../provider/transform"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { defer } from "../util/defer"
import { ToolRegistry } from "../tool/registry"
import { MCP } from "../mcp"
import { ulid } from "ulid"
import { NamedError } from "@opencorvus-ai/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { Truncate } from "@/tool/truncation"
import { MemoryInjection } from "@/memory/injection"
import { Scratchpad } from "@/memory/scratchpad"
import { TaskPlan } from "@/memory/task-plan"
import { messageControlOnly, textForBoth } from "./part-visibility"
import { SessionSummary } from "./summary"
import { SessionPromptState } from "./prompt-state"
import { Preference } from "@/preference"
import { muteAISdkWarnings } from "@/runtime/shims"

muteAISdkWarnings()

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export namespace SessionLoop {
  const { log, state, cancel, flushCallbacks, start, resume } = SessionPromptState

  function collectLoopState(msgs: Message.WithParts[]) {
    let lastUser: Message.User | undefined
    let lastAssistant: Message.Assistant | undefined
    let lastFinished: Message.Assistant | undefined
    const tasks: (Message.CompactionPart | Message.SubtaskPart)[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") lastUser = msg.info as Message.User
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as Message.Assistant
      if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
        lastFinished = msg.info as Message.Assistant
      if (lastUser && lastFinished) break
      if (!lastFinished) {
        tasks.push(...msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask"))
      }
    }
    if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
    return { lastUser, lastAssistant, lastFinished, tasks }
  }

  function shouldEnterStandby(input: { lastUser: Message.User; lastAssistant: Message.Assistant | undefined }) {
    return !!(
      input.lastAssistant?.finish &&
      !["tool-calls", "unknown"].includes(input.lastAssistant.finish) &&
      input.lastUser.id < input.lastAssistant.id
    )
  }

  async function enterStandby(input: { sessionID: string; abort: AbortSignal; afterID: string }) {
    SessionCompaction.prune({ sessionID: input.sessionID })
    log.info("entering standby", { sessionID: input.sessionID })
    SessionStatus.set(input.sessionID, { type: "idle" })
    await waitForUserMessage(input.sessionID, input.abort, input.afterID)
  }

  async function runSubtask(input: {
    task: Message.SubtaskPart
    model: Provider.Model
    lastUser: Message.User
    msgs: Message.WithParts[]
    session: Session.Info
    sessionID: string
    abort: AbortSignal
  }) {
    const taskTool = await TaskTool.init()
    const taskModel = input.task.model
      ? await Provider.getModel(input.task.model.providerID, input.task.model.modelID)
      : input.model
    const assistantMessage = (await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "assistant",
      parentID: input.lastUser.id,
      sessionID: input.sessionID,
      mode: input.task.agent,
      agent: input.task.agent,
      variant: input.lastUser.variant,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: taskModel.id,
      providerID: taskModel.providerID,
      time: {
        created: Date.now(),
      },
    })) as Message.Assistant
    const part = (await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistantMessage.id,
      sessionID: assistantMessage.sessionID,
      type: "tool",
      callID: ulid(),
      tool: TaskTool.id,
      state: {
        status: "running",
        input: {
          prompt: input.task.prompt,
          description: input.task.description,
          subagent_type: input.task.agent,
          command: input.task.command,
        },
        time: {
          start: Date.now(),
        },
      },
    })) as Message.ToolPart
    const args = {
      prompt: input.task.prompt,
      description: input.task.description,
      subagent_type: input.task.agent,
      command: input.task.command,
    }
    await Plugin.trigger(
      "tool.execute.before",
      {
        tool: "task",
        sessionID: input.sessionID,
        callID: part.id,
      },
      { args },
    )
    let fail: Error | undefined
    const taskAgent = await Agent.get(input.task.agent)
    const ctx: Tool.Context = {
      agent: input.task.agent,
      messageID: assistantMessage.id,
      sessionID: input.sessionID,
      abort: input.abort,
      callID: part.callID,
      extra: { bypassAgentCheck: true },
      messages: input.msgs,
      async metadata(next) {
        await Session.updatePart({
          ...part,
          type: "tool",
          state: {
            ...part.state,
            ...next,
          },
        } satisfies Message.ToolPart)
      },
      async ask(req) {
        await PermissionNext.ask({
          ...req,
          sessionID: input.sessionID,
          ruleset: PermissionNext.merge(taskAgent.permission, input.session.permission ?? []),
        })
      },
    }
    const result = await taskTool.execute(args, ctx).catch((error) => {
      fail = error
      log.error("subtask execution failed", {
        error,
        agent: input.task.agent,
        description: input.task.description,
      })
      return undefined
    })
    const attachments = result?.attachments?.map((attachment) => ({
      ...attachment,
      id: Identifier.ascending("part"),
      sessionID: input.sessionID,
      messageID: assistantMessage.id,
    }))
    await Plugin.trigger(
      "tool.execute.after",
      {
        tool: "task",
        sessionID: input.sessionID,
        callID: part.id,
        args,
      },
      result,
    )
    assistantMessage.finish = "tool-calls"
    assistantMessage.time.completed = Date.now()
    await Session.updateMessage(assistantMessage)
    if (result && part.state.status === "running") {
      await Session.updatePart({
        ...part,
        state: {
          status: "completed",
          input: part.state.input,
          title: result.title,
          metadata: result.metadata,
          output: result.output,
          attachments,
          time: {
            ...part.state.time,
            end: Date.now(),
          },
        },
      } satisfies Message.ToolPart)
    }
    if (!result) {
      await Session.updatePart({
        ...part,
        state: {
          status: "error",
          error: fail ? `Tool execution failed: ${fail.message}` : "Tool execution failed",
          time: {
            start: part.state.status === "running" ? part.state.time.start : Date.now(),
            end: Date.now(),
          },
          metadata: part.metadata,
          input: part.state.input,
        },
      } satisfies Message.ToolPart)
    }

    if (input.task.command) {
      const summaryUserMsg: Message.User = {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        role: "user",
        time: {
          created: Date.now(),
        },
        agent: input.lastUser.agent,
        model: input.lastUser.model,
      }
      await Session.updateMessage(summaryUserMsg)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: summaryUserMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies Message.TextPart)
    }
  }

  async function processTurn(input: {
    step: number
    sessionID: string
    session: Session.Info
    msgs: Message.WithParts[]
    lastUser: Message.User
    lastFinished: Message.Assistant | undefined
    model: Provider.Model
    abort: AbortSignal
  }) {
    let structured: unknown | undefined
    const agent = await Agent.get(input.lastUser.agent)
    const maxSteps = agent.steps ?? Infinity
    const isLastStep = input.step >= maxSteps
    const processor = SessionProcessor.create({
      assistantMessage: (await Session.updateMessage({
        id: Identifier.ascending("message"),
        parentID: input.lastUser.id,
        role: "assistant",
        mode: agent.name,
        agent: agent.name,
        variant: input.lastUser.variant,
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: input.model.id,
        providerID: input.model.providerID,
        time: {
          created: Date.now(),
        },
        sessionID: input.sessionID,
      })) as Message.Assistant,
      sessionID: input.sessionID,
      model: input.model,
      abort: input.abort,
    })
    using _ = defer(() => InstructionPrompt.clear(processor.message.id))

    const lastUserMsg = input.msgs.findLast((m) => m.info.role === "user")
    const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
    const tools = await resolveTools({
      agent,
      session: input.session,
      model: input.model,
      tools: input.lastUser.tools,
      processor,
      bypassAgentCheck,
      extra: input.lastUser.extra,
      messages: input.msgs,
    })
    if (input.lastUser.format?.type === "json_schema") {
      tools["StructuredOutput"] = createStructuredOutputTool({
        schema: input.lastUser.format.schema,
        onSuccess(output) {
          structured = output
        },
      })
    }

    if (input.step === 1) {
      SessionSummary.summarize({
        sessionID: input.sessionID,
        messageID: input.lastUser.id,
      })
    }

    if (input.step > 1 && input.lastFinished) {
      for (const msg of input.msgs) {
        if (msg.info.role !== "user" || msg.info.id <= input.lastFinished.id) continue
        for (const part of msg.parts) {
          if (part.type !== "text" || !textForBoth(part)) continue
          if (!part.text.trim()) continue
          part.text = [
            "<system-reminder>",
            "The user sent the following message:",
            part.text,
            "",
            "Please address this message and continue with your tasks.",
            "</system-reminder>",
          ].join("\n")
        }
      }
    }

    await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: input.msgs })

    const skillsSection = await SystemPrompt.skills(agent)
    const system = [
      ...(await SystemPrompt.environment(input.model)),
      ...(skillsSection ? [skillsSection] : []),
      ...(await InstructionPrompt.system()),
    ]
    const format = input.lastUser.format ?? { type: "text" }
    if (format.type === "json_schema") {
      system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
    }

    const preferenceSection = Preference.systemPromptSection({
      projectID: Instance.project.id,
      sessionID: input.sessionID,
    })
    if (preferenceSection) system.push(preferenceSection)
    const memoryQuery = (lastUserMsg?.parts ?? [])
      .filter((part): part is Message.TextPart => part.type === "text" && textForBoth(part))
      .map((part) => part.text)
      .join(" ")
      .trim()
    const memoryInstruction = await MemoryInjection.systemPromptSection({
      projectID: Instance.project.id,
      sessionID: input.sessionID,
      query: memoryQuery || input.session.title || input.lastUser.id,
    })
    if (memoryInstruction) system.push(memoryInstruction)
    const scratchpadSection = Scratchpad.systemPromptSection(input.sessionID)
    if (scratchpadSection) system.push(scratchpadSection)
    const taskPlanSection = TaskPlan.toMarkdown(input.sessionID)
    if (taskPlanSection) system.push(taskPlanSection)

    const modelMessages = [
      ...Message.toModelMessages(input.msgs, input.model),
      ...(isLastStep
        ? [
            {
              role: "assistant" as const,
              content: MAX_STEPS,
            },
          ]
        : []),
    ]

    {
      const systemChars = system.reduce((sum, s) => sum + s.length, 0)
      const systemTokensEst = Math.round(systemChars / 4)
      const toolCount = Object.keys(tools).length
      let userMsgCount = 0
      let assistantMsgCount = 0
      let totalContentChars = 0
      let imageCount = 0
      let toolCallCount = 0

      for (const msg of modelMessages) {
        if (msg.role === "user") userMsgCount++
        if (msg.role === "assistant") assistantMsgCount++

        if (typeof msg.content === "string") {
          totalContentChars += msg.content.length
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if ("text" in part && typeof part.text === "string") totalContentChars += part.text.length
            if ("type" in part && part.type === "image") imageCount++
            if ("type" in part && part.type === "tool-result") toolCallCount++
          }
        }
      }

      const contentTokensEst = Math.round(totalContentChars / 4)
      const imageTokensEst = imageCount * 1600
      log.info("context-diagnostics", {
        step: input.step,
        systemPromptParts: system.length,
        systemChars,
        systemTokensEst,
        toolCount,
        toolNames: Object.keys(tools).join(","),
        messageCount: modelMessages.length,
        userMsgCount,
        assistantMsgCount,
        totalContentChars,
        contentTokensEst,
        imageCount,
        imageTokensEst,
        toolCallCount,
        totalTokensEst: systemTokensEst + contentTokensEst + imageTokensEst,
      })
    }

    const result = await processor.process({
      user: input.lastUser,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      system,
      messages: modelMessages,
      tools,
      model: input.model,
      toolChoice: format.type === "json_schema" ? (input.model.capabilities.reasoning ? "auto" : "required") : undefined,
    })

    if (structured !== undefined) {
      processor.message.structured = structured
      processor.message.finish = processor.message.finish ?? "stop"
      await Session.updateMessage(processor.message)
      return "stop" as const
    }

    const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)
    if (modelFinished && !processor.message.error && format.type === "json_schema") {
      processor.message.error = new Message.StructuredOutputError({
        message: "Model did not produce structured output",
        retries: 0,
      }).toObject()
      await Session.updateMessage(processor.message)
      return "stop" as const
    }

    if (result === "stop") return "stop" as const
    if (result === "compact") {
      await SessionCompaction.create({
        sessionID: input.sessionID,
        agent: input.lastUser.agent,
        model: input.lastUser.model,
        auto: true,
      })
    }
    return "continue" as const
  }

  export const LoopInput = z.object({
    sessionID: Identifier.schema("session"),
    resume_existing: z.boolean().optional(),
  })
  export const loop = fn(LoopInput, async (input) => {
    const { sessionID, resume_existing } = input

    const abort = resume_existing ? resume(sessionID) : start(sessionID)
    if (!abort) {
      return new Promise<Message.WithParts>((resolve, reject) => {
        state()[sessionID].callbacks.push({ resolve, reject })
      })
    }

    const firstResult = new Promise<Message.WithParts>((resolve, reject) => {
      state()[sessionID].callbacks.push({ resolve, reject })
    })

    void (async () => {
      try {
        let step = 0
        const session = await Session.get(sessionID)
        while (true) {
          SessionStatus.set(sessionID, { type: "busy" })
          log.info("loop", { step, sessionID })
          if (abort.aborted) break
          const msgs = await Message.filterCompacted(Message.stream(sessionID))
          const { lastUser, lastAssistant, lastFinished, tasks } = collectLoopState(msgs)
          if (shouldEnterStandby({ lastUser, lastAssistant })) {
            if (!lastAssistant) break
            const lastResult = msgs.find((m) => m.info.id === lastAssistant.id)
            if (lastResult) flushCallbacks(sessionID, lastResult)

            await enterStandby({
              sessionID,
              abort,
              afterID: lastAssistant.id,
            })
            if (abort.aborted) break

            step = 0
            continue
          }

          step++
          if (step === 1)
            ensureTitle({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            })

          const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
            if (Provider.ModelNotFoundError.isInstance(e)) {
              const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
              Bus.publish(Session.Event.Error, {
                sessionID,
                error: new NamedError.Unknown({
                  message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
                }).toObject(),
              })
            }
            throw e
          })
          const task = tasks.pop()

          if (task?.type === "subtask") {
            await runSubtask({ task, model, lastUser, msgs, session, sessionID, abort })
            continue
          }

          if (task?.type === "compaction") {
            const result = await SessionCompaction.process({
              messages: msgs,
              parentID: lastUser.id,
              abort,
              sessionID,
              auto: task.auto,
            })
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            await SessionCompaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
            })
            continue
          }

          const turn = await processTurn({
            step,
            sessionID,
            session,
            msgs,
            lastUser,
            lastFinished,
            model,
            abort,
          })
          if (turn === "stop") break
          continue
        }
        SessionCompaction.prune({ sessionID })
        for await (const item of Message.stream(sessionID)) {
          if (item.info.role === "user") continue
          flushCallbacks(sessionID, item)
          break
        }
      } catch (e) {
        const s = state()[sessionID]
        if (s) {
          for (const q of s.callbacks) q.reject(e)
          s.callbacks = []
        }
      } finally {
        const s = state()[sessionID]
        if (s?.abort.signal === abort) cancel(sessionID)
      }
    })()

    return firstResult
  })

  function waitForUserMessage(sessionID: string, abort: AbortSignal, afterID: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (abort.aborted) {
        resolve()
        return
      }

      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        unsub()
        resolve()
      }

      const unsub = Bus.subscribe(Message.Event.Updated, (event) => {
        if (
          event.properties.info.role === "user" &&
          event.properties.info.sessionID === sessionID &&
          event.properties.info.id > afterID
        ) {
          settle()
        }
      })
      abort.addEventListener("abort", settle, { once: true })

      void (async () => {
        for await (const item of Message.stream(sessionID)) {
          if (item.info.id <= afterID) break
          if (item.info.role === "user") {
            settle()
            return
          }
        }
      })()
    })
  }

  export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    extra?: Record<string, unknown>
    messages: Message.WithParts[]
  }) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal!,
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: { ...(input.extra ?? {}), model: input.model, bypassAgentCheck: input.bypassAgentCheck },
      agent: input.agent.name,
      messages: input.messages,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await PermissionNext.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
        })
      },
    })

    for (const item of await ToolRegistry.tools(
      { modelID: input.model.api.id, providerID: input.model.providerID },
      input.agent,
    )) {
      if (input.tools !== undefined && !input.tools[item.id]) continue
      const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
      tools[item.id] = tool({
        id: item.id as any,
        description: item.description,
        inputSchema: jsonSchema(schema as any),
        async execute(args, options) {
          const ctx = context(args, options)
          await Plugin.trigger(
            "tool.execute.before",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
            },
            {
              args,
            },
          )
          const result = await item.execute(args, ctx)
          const output = {
            ...result,
            attachments: result.attachments?.map((attachment) => ({
              ...attachment,
              id: Identifier.ascending("part"),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
          }
          await Plugin.trigger(
            "tool.execute.after",
            {
              tool: item.id,
              sessionID: ctx.sessionID,
              callID: ctx.callID,
              args,
            },
            output,
          )
          return output
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue

      const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
      item.inputSchema = jsonSchema(transformed)
      item.execute = async (args, opts) => {
        const ctx = context(args, opts)

        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
          },
          {
            args,
          },
        )

        await ctx.ask({
          permission: key,
          metadata: {},
          patterns: ["*"],
          always: ["*"],
        })

        const result = await execute(args, opts)

        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: key,
            sessionID: ctx.sessionID,
            callID: opts.toolCallId,
            args,
          },
          result,
        )

        const textParts: string[] = []
        const attachments: Omit<Message.FilePart, "id" | "sessionID" | "messageID">[] = []

        for (const contentItem of result.content) {
          if (contentItem.type === "text") {
            textParts.push(contentItem.text)
          } else if (contentItem.type === "image") {
            attachments.push({
              type: "file",
              mime: contentItem.mimeType,
              url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
            })
          } else if (contentItem.type === "resource") {
            const { resource } = contentItem
            if (resource.text) {
              textParts.push(resource.text)
            }
            if (resource.blob) {
              attachments.push({
                type: "file",
                mime: resource.mimeType ?? "application/octet-stream",
                url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                filename: resource.uri,
              })
            }
          }
        }

        const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
        const metadata = {
          ...(result.metadata ?? {}),
          truncated: truncated.truncated,
          ...(truncated.truncated && { outputPath: truncated.outputPath }),
        }

        return {
          title: "",
          metadata,
          output: truncated.content,
          attachments: attachments.map((attachment) => ({
            ...attachment,
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
          content: result.content,
        }
      }
      tools[key] = item
    }

    return tools
  }

  export function createStructuredOutputTool(input: {
    schema: Record<string, any>
    onSuccess: (output: unknown) => void
  }): AITool {
    const { $schema, ...toolSchema } = input.schema

    return tool({
      id: "StructuredOutput" as any,
      description: STRUCTURED_OUTPUT_DESCRIPTION,
      inputSchema: jsonSchema(toolSchema as any),
      async execute(args) {
        input.onSuccess(args)
        return {
          output: "Structured output captured successfully.",
          title: "Structured Output",
          metadata: { valid: true },
        }
      },
      toModelOutput(result) {
        return {
          type: "text",
          value: result.output,
        }
      },
    })
  }

  async function ensureTitle(input: {
    session: Session.Info
    history: Message.WithParts[]
    providerID: string
    modelID: string
  }) {
    if (input.session.parentID) return
    if (!Session.isDefaultTitle(input.session.title)) return

    const firstRealUserIdx = input.history.findIndex((m) => m.info.role === "user" && !messageControlOnly(m.parts))
    if (firstRealUserIdx === -1) return

    const isFirst = input.history.filter((m) => m.info.role === "user" && !messageControlOnly(m.parts)).length === 1
    if (!isFirst) return

    const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
    const firstRealUser = contextMessages[firstRealUserIdx]

    const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as Message.SubtaskPart[]
    const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

    const agent = await Agent.get("title")
    if (!agent) return
    const model = await iife(async () => {
      if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
      return (
        (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
      )
    })
    const result = await LLM.stream({
      agent,
      user: firstRealUser.info as Message.User,
      system: [],
      small: true,
      tools: {},
      model,
      abort: new AbortController().signal,
      sessionID: input.session.id,
      retries: 2,
      messages: [
        {
          role: "user",
          content: "Generate a title for this conversation:\n",
        },
        ...(hasOnlySubtaskParts
          ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
          : Message.toModelMessages(contextMessages, model)),
      ],
    })
    const text = await result.text.catch((err) => log.error("failed to generate title", { error: err }))
    if (text) {
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return

      const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      return Session.setTitle({ sessionID: input.session.id, title })
    }
  }
}
