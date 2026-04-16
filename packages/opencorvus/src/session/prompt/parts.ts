import path from "path"
import os from "os"
import fs from "fs/promises"
import { Filesystem } from "../../util/filesystem"
import { Identifier } from "../../id/id"
import { Message } from "../message"
import { Log } from "../../util/log"
import { Session } from ".."
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Instance } from "../../project/instance"
import { Bus } from "../../bus"
import { InstructionPrompt } from "../instruction"
import { Plugin } from "../../plugin"
import { MCP } from "../../mcp"
import { LSP } from "../../lsp"
import { ReadTool } from "../../tool/read"
import { FileTime } from "../../file/time"
import { ConfigMarkdown } from "../../config/markdown"
import { NamedError } from "@opencorvus-ai/util/error"
import { PermissionNext } from "@/permission/next"
import { Tool } from "@/tool/tool"
import { iife } from "@/util/iife"
import { defer } from "../../util/defer"
import { fileURLToPath, pathToFileURL } from "bun"
import { textForBoth } from "../part-visibility"
import { SessionPromptState } from "./state"
const { lastModel } = SessionPromptState
import type { PromptInput } from "./schema"
import { isDecodableText, decodeDataUrlText } from "../text-mime"

const log = Log.create({ service: "session.prompt" })

const BUILD_SWITCH = `<system-reminder>
Plan mode has ended. Read the implementation plan at {{plan}} before making edits.
Use that file as the execution source of truth unless the user overrides it.
</system-reminder>`

const PLAN_SWITCH_FROM_SPEC = `<system-reminder>
Spec mode has ended. Read the specification at {{spec}} before creating the implementation plan.
Use that file as the requirements source of truth unless the user overrides it.
All acceptance criteria in the spec must be fulfilled for the task to be accepted.
</system-reminder>`

const PLAN_REMINDER = `<system-reminder>
# Plan Mode - System Reminder

Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

---

## Plan File Info

{{plan_file_info}}

You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

**Plan File Guidelines:** The plan file should contain only your final recommended approach, not all alternatives considered. Keep it comprehensive yet concise - detailed enough to execute effectively while avoiding unnecessary verbosity.

---

## Enhanced Planning Workflow

### Phase 1: Initial Understanding

**Goal:** Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the Explore subagent type.

1. Understand the user's request thoroughly

2. **Launch up to 3 Explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase. Each agent can focus on different aspects:
   - Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns
   - Provide each agent with a specific search focus or area to explore
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - Use 1 agent when: the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change. Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Take into account any context you already have from the user's request or from the conversation so far when deciding how many agents to launch

3. Use \`question\` to clarify ambiguities in the user request up front.

### Phase 2: Planning

**Goal:** Turn exploration into an executable plan inside this session.

1. Use \`todowrite\` to keep a short step list updated as your understanding evolves.
2. Use \`planner\` to build a task tree and track status:
   - \`planner.add_task\` for the main phases and subtasks
   - \`planner.scratchpad_write\` / \`planner.scratchpad_append\` for findings, constraints, and rationale
   - \`planner.update_task\` as tasks become in-progress or completed
3. Capture exact file paths, test commands, risks, and open questions before finalizing the plan.

### Phase 3: Synthesis

**Goal:** Synthesize your findings and ensure the plan aligns with the user's intent.

1. Collect the exploration results and the task tree you built with \`planner\`
2. Re-read the critical files and acceptance criteria before finalizing your recommendation
3. Use \`question\` to ask the user about tradeoffs.

### Phase 4: Final Plan

Once you have all the information you need, ensure that the plan file has been updated with your synthesized recommendation including:
- Recommended approach with rationale
- Key insights from different perspectives
- Critical files that need modification

### Phase 5: Call \`plan_exit\`

At the very end of your turn, once you have asked the user questions and are happy with your final plan file, call \`plan_exit\` to indicate that planning is done.

This is critical - your turn should only end with either asking the user a question or calling \`plan_exit\`. Do not stop unless it's for these 2 reasons.

---

**NOTE:** At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`

const SPEC_REMINDER = `<system-reminder>
# Spec Mode - System Reminder

Spec mode is active. The user indicated that they want you to write a specification BEFORE planning or implementing. You MUST NOT make any edits (with the exception of the spec file mentioned below), run any non-readonly tools, or otherwise make any changes to the system. This supersedes any other instructions you have received.

---

## Spec File Info

{{spec_file_info}}

You should build your spec incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

**Spec File Guidelines:** The spec should contain concrete, verifiable acceptance criteria. Each criterion must be specific enough for automated verification. The spec is the source of truth for task acceptance - ALL criteria must pass before the task can be considered complete.

---

## Enhanced Specification Workflow

### Phase 1: Initial Understanding

**Goal:** Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the Explore subagent type.

1. Understand the user's request thoroughly

2. **Launch up to 3 Explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase. Each agent can focus on different aspects:
   - Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns
   - Use the minimum number of agents necessary (usually just 1)

3. Use \`question\` to clarify ambiguities in the user request up front.

### Phase 2: Requirements Gathering

**Goal:** Enumerate all requirements, constraints, and acceptance criteria.

1. Identify functional requirements - what the system must do
2. Identify non-functional requirements - performance, security, compatibility constraints
3. Define acceptance criteria as concrete, verifiable statements (e.g. "Build passes", "Test X asserts Y", "API returns Z")
4. Identify what is explicitly out of scope
5. Note assumptions that need validation

### Phase 3: Specification Writing

**Goal:** Write a structured spec document with these sections:

1. **Summary** - One paragraph overview
2. **Problem** - What problem this solves and why
3. **Requirements** - Numbered list of functional requirements
4. **Acceptance Criteria** - Numbered list of concrete, verifiable criteria (this is the critical section - spec_check will evaluate against these)
5. **Constraints** - Technical, compatibility, or process constraints
6. **Out of Scope** - What is explicitly excluded
7. **Open Questions** - Anything that needs user input

### Phase 4: Call \`spec_exit\`

Once you have asked the user questions and are happy with your final spec file, call \`spec_exit\` to transition to plan mode.

This is critical - your turn should only end with either asking the user a question or calling \`spec_exit\`. Do not stop unless it's for these 2 reasons.

---

**NOTE:** At any point in this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well-researched specification with clear acceptance criteria before planning begins.
</system-reminder>`

export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
  const parts: PromptInput["parts"] = [
    {
      type: "text",
      text: template,
    },
  ]
  const files = ConfigMarkdown.files(template)
  const seen = new Set<string>()
  await Promise.all(
    files.map(async (match) => {
      const name = match[1]
      if (seen.has(name)) return
      seen.add(name)
      const filepath = name.startsWith("~/")
        ? path.join(os.homedir(), name.slice(2))
        : path.resolve(Instance.worktree, name)

      const stats = await fs.stat(filepath).catch(() => undefined)
      if (!stats) {
        const agent = await Agent.get(name)
        if (agent) {
          parts.push({
            type: "agent",
            name: agent.name,
          })
        }
        return
      }

      if (stats.isDirectory()) {
        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: "application/x-directory",
        })
        return
      }

      parts.push({
        type: "file",
        url: pathToFileURL(filepath).href,
        filename: name,
        mime: "text/plain",
      })
    }),
  )
  return parts
}

export async function createUserMessage(input: PromptInput) {
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))

  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  const full =
    !input.variant && agent.variant
      ? await Provider.getModel(model.providerID, model.modelID).catch(() => undefined)
      : undefined
  const variant = input.variant ?? (agent.variant && full?.variants?.[agent.variant] ? agent.variant : undefined)

  const info: Message.Info = {
    id: input.messageID ?? Identifier.ascending("message"),
    role: "user",
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    tools: input.tools,
    agent: agent.name,
    model,
    system: input.system,
    format: input.format,
    variant,
    extra: input.extra,
  }
  using _ = defer(() => InstructionPrompt.clear(info.id))

  type Draft<T> = T extends Message.Part ? Omit<T, "id"> & { id?: string } : never
  const assign = (part: Draft<Message.Part>): Message.Part => ({
    ...part,
    id: part.id ?? Identifier.ascending("part"),
  })

  const reminders = await iife(async (): Promise<Draft<Message.Part>[]> => {
    const session = await Session.get(input.sessionID)
    const msgs = await Session.messages({ sessionID: input.sessionID, limit: 8 })
    const last = msgs.at(-1)?.info

    if (agent.name === "spec") {
      if (last?.agent === "spec") return []
      const spec = Session.spec(session)
      const specExists = await Bun.file(spec).exists()
      await fs.mkdir(path.dirname(spec), { recursive: true })
      return [{
        messageID: info.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        kind: "control",
        source: "system",
        text: SPEC_REMINDER.replace(
          "{{spec_file_info}}",
          specExists
            ? `A spec file already exists at \`${spec}\`. You can read it and make incremental edits using the Write or Edit tool.`
            : `No spec file exists yet. You should create your spec at \`${spec}\` using the Write tool.`,
        ),
      }]
    }

    if (agent.name === "plan") {
      if (last?.agent === "plan") return []
      const parts: Draft<Message.Part>[] = []

      // If transitioning from spec mode, inject spec context
      if (last?.agent === "spec") {
        const spec = Session.spec(session)
        const specExists = await Bun.file(spec).exists()
        if (specExists) {
          parts.push({
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            kind: "control",
            source: "system",
            text: PLAN_SWITCH_FROM_SPEC.replace("{{spec}}", spec),
          })
        }
      }

      const plan = Session.plan(session)
      const exists = await Bun.file(plan).exists()
      await fs.mkdir(path.dirname(plan), { recursive: true })
      parts.push({
        messageID: info.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        kind: "control",
        source: "system",
        text: PLAN_REMINDER.replace(
          "{{plan_file_info}}",
          exists
            ? `A plan file already exists at \`${plan}\`. You can read it and make incremental edits using the Write or Edit tool.`
            : `No plan file exists yet. You should create your plan at \`${plan}\` using the Write tool.`,
        ),
      })
      return parts
    }

    if (last?.agent === "spec") {
      const spec = Session.spec(session)
      const specExists = await Bun.file(spec).exists()
      if (specExists) {
        return [{
          messageID: info.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          kind: "control",
          source: "system",
          text: PLAN_SWITCH_FROM_SPEC.replace("{{spec}}", spec),
        }]
      }
    }

    if (last?.agent !== "plan") return []
    const plan = Session.plan(session)
    const exists = await Bun.file(plan).exists()
    if (!exists) return []
    return [{
      messageID: info.id,
      sessionID: input.sessionID,
      type: "text",
      synthetic: true,
      kind: "control",
      source: "system",
      text: BUILD_SWITCH.replace("{{plan}}", plan),
    }]
  })

  const parts = [
    ...reminders,
    ...(await Promise.all(
      input.parts.map(async (part): Promise<Draft<Message.Part>[]> => {
        if (part.type === "file") {
          // before checking the protocol we check if this is an mcp resource because it needs special handling
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })

            const pieces: Draft<Message.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]

            try {
              const resourceContent = await MCP.readResource(clientName, uri)
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : [resourceContent.contents]

              for (const content of contents) {
                if ("text" in content && content.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: content.text as string,
                  })
                } else if ("blob" in content && content.blob) {
                  const mimeType = "mimeType" in content ? content.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mimeType}]`,
                  })
                }
              }

              pieces.push({
                ...part,
                messageID: info.id,
                sessionID: input.sessionID,
              })
            } catch (error: unknown) {
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }

            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (isDecodableText(part.mime, part.filename)) {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrlText(part.url),
                  },
                  {
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }
              break
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const s = Filesystem.stat(filepath)

              if (s?.isDirectory()) {
                part.mime = "application/x-directory"
              }

              if (part.mime === "text/plain") {
                let offset: number | undefined = undefined
                let limit: number | undefined = undefined
                const range = {
                  start: url.searchParams.get("start"),
                  end: url.searchParams.get("end"),
                }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = await LSP.documentSymbol(filePathURI).catch(() => [])
                    for (const symbol of symbols) {
                      let range: LSP.Range | undefined
                      if ("range" in symbol) {
                        range = symbol.range
                      } else if ("location" in symbol) {
                        range = symbol.location.range
                      }
                      if (range?.start?.line && range.start.line === start) {
                        start = range.start.line
                        end = range.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) {
                    limit = end - (offset - 1)
                  }
                }
                const args = { filePath: filepath, offset, limit }

                const pieces: Draft<Message.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]

                await ReadTool.init()
                  .then(async (t) => {
                    const model = await Provider.getModel(info.model.providerID, info.model.modelID)
                    const readCtx: Tool.Context = {
                      sessionID: input.sessionID,
                      abort: new AbortController().signal,
                      agent: input.agent!,
                      messageID: info.id,
                      extra: { bypassCwdCheck: true, model },
                      messages: [],
                      metadata: async () => {},
                      ask: async () => {},
                    }
                    const result = await t.execute(args, readCtx)
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: result.output,
                    })
                    if (result.attachments?.length) {
                      pieces.push(
                        ...result.attachments.map((attachment) => ({
                          ...attachment,
                          synthetic: true,
                          filename: attachment.filename ?? part.filename,
                          messageID: info.id,
                          sessionID: input.sessionID,
                        })),
                      )
                    } else {
                      pieces.push({
                        ...part,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })
                    }
                  })
                  .catch((error) => {
                    log.error("failed to read file", { error })
                    const message = error instanceof Error ? error.message : error.toString()
                    Bus.publish(Session.Event.Error, {
                      sessionID: input.sessionID,
                      error: new NamedError.Unknown({
                        message,
                      }).toObject(),
                    })
                    pieces.push({
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    })
                  })

                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { filePath: filepath }
                const listCtx: Tool.Context = {
                  sessionID: input.sessionID,
                  abort: new AbortController().signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true },
                  messages: [],
                  metadata: async () => {},
                  ask: async () => {},
                }
                const result = await ReadTool.init().then((t) => t.execute(args, listCtx))
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  },
                  {
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  },
                ]
              }

              FileTime.read(input.sessionID, filepath)
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                  synthetic: true,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url: `data:${part.mime};base64,` + (await Filesystem.readBytes(filepath)).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = PermissionNext.evaluate("task", part.name, agent.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            {
              ...part,
              messageID: info.id,
              sessionID: input.sessionID,
            },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [
          {
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
        ]
      }),
    )).flat(),
  ].map(assign)

  await Plugin.trigger(
    "chat.message",
    {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      messageID: input.messageID,
      variant: input.variant,
    },
    {
      message: info,
      parts,
    },
  )

  // Save message row silently first (FK target for parts), then write all
  // parts, then publish the message.updated event.  This guarantees the
  // persistent loop sees the full message (with parts) when it wakes up.
  await Session.saveMessage(info)
  for (const part of parts) {
    await Session.updatePart(part)
  }
  await Session.updateMessage(info)

  return {
    info,
    parts,
  }
}
