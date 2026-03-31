import z from "zod"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Log } from "../util/log"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { SessionCompaction } from "./compaction"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import { defer } from "../util/defer"
import { ulid } from "ulid"
import { NamedError } from "@opencorvus-ai/util/error"
import { fn } from "@/util/fn"
import { SessionProcessor } from "./processor"
import { TaskTool } from "@/tool/task"
import { Tool } from "@/tool/tool"
import { PermissionNext } from "@/permission/next"
import { SessionStatus } from "./status"
import { MemoryInjection } from "@/memory/injection"
import { Scratchpad } from "@/memory/scratchpad"
import { TaskPlan } from "@/memory/task-plan"
import { messageControlOnly, textForBoth } from "./part-visibility"
import { SessionSummary } from "./summary"
import { installRuntimeShims } from "@/runtime/shims"
import {
  createStructuredOutputTool as createSessionStructuredOutputTool,
  STRUCTURED_OUTPUT_SYSTEM_PROMPT,
} from "./structured-output"
import { resolveTools as resolveSessionTools } from "./tool-resolver"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { promptState, startSession, resumeSession, cancelSession, flushCallbacks } from "./prompt-state"
import { ensureTitle } from "./prompt-title"

const log = Log.create({ service: "session.prompt" })

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
    // Add synthetic user message to prevent certain reasoning models from erroring
    // If we create assistant messages w/ out user ones following mid loop thinking signatures
    // will be missing and it can cause errors for models like gemini for example
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
  const tools = await resolveSessionTools({
    agent,
    session: input.session,
    model: input.model,
    tools: input.lastUser.tools,
    processor,
    bypassAgentCheck,
    messages: input.msgs,
    extra: input.lastUser.extra,
  })
  if (input.lastUser.format?.type === "json_schema") {
    tools["StructuredOutput"] = createSessionStructuredOutputTool({
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
  })

  if (structured !== undefined) {
    processor.message.structured = structured
    processor.message.finish = processor.message.finish ?? "stop"
    await Session.updateMessage(processor.message)
    return "stop" as const
  }

  const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)
  if (modelFinished && format.type === "json_schema") {
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

/**
 * Block until a new user message arrives for this session, or abort fires.
 *
 * Uses the "subscribe then check" pattern to avoid the race where a Bus event
 * fires between entering standby and registering the subscription:
 *   1. Subscribe to future Bus events
 *   2. Check the DB for messages that already arrived
 */
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

    // 1. Subscribe to future events first
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

    // 2. Then check DB for messages that may have arrived before subscription
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

export const LoopInput = z.object({
  sessionID: Identifier.schema("session"),
  resume_existing: z.boolean().optional(),
})

export const loop = fn(LoopInput, async (input) => {
  installRuntimeShims()
  const { sessionID, resume_existing } = input

  const abort = resume_existing ? resumeSession(sessionID) : startSession(sessionID)
  if (!abort) {
    return new Promise<Message.WithParts>((resolve, reject) => {
      promptState()[sessionID].callbacks.push({ resolve, reject })
    })
  }

  // First caller also uses callback — loop runs in background and resolves it
  const firstResult = new Promise<Message.WithParts>((resolve, reject) => {
    promptState()[sessionID].callbacks.push({ resolve, reject })
  })

  // Persistent loop: processes tasks, enters standby between them, resolves
  // callbacks at each task completion so prompt() callers get their results.
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
          // Task complete — deliver result to waiting prompt() callers
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

        // pending compaction
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

        // context overflow, needs compaction
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
      // Loop exited (abort or fatal break) — flush remaining callbacks
      SessionCompaction.prune({ sessionID })
      for await (const item of Message.stream(sessionID)) {
        if (item.info.role === "user") continue
        flushCallbacks(sessionID, item)
        break
      }
    } catch (e) {
      // Reject all pending callbacks on fatal error
      const s = promptState()[sessionID]
      if (s) {
        for (const q of s.callbacks) q.reject(e)
        s.callbacks = []
      }
    } finally {
      // Only clean up if we still own this session (not taken over by a new loop)
      const s = promptState()[sessionID]
      if (s?.abort.signal === abort) cancelSession(sessionID)
    }
  })()

  return firstResult
})
