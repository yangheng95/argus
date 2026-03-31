import path from "path"
import os from "os"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Log } from "../util/log"
import { Session } from "."
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { InstructionPrompt } from "./instruction"
import { Plugin } from "../plugin"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { ReadTool } from "../tool/read"
import { FileTime } from "../file/time"
import { ConfigMarkdown } from "../config/markdown"
import { NamedError } from "@opencorvus-ai/util/error"
import { PermissionNext } from "@/permission/next"
import { Tool } from "@/tool/tool"
import { iife } from "@/util/iife"
import { defer } from "../util/defer"
import { fileURLToPath, pathToFileURL } from "bun"
import { textForBoth } from "./part-visibility"
import PLAN_REMINDER from "../session/prompt/plan-reminder-anthropic.txt"
import SPEC_REMINDER from "../session/prompt/spec-reminder-anthropic.txt"
import { lastModel } from "./prompt-state"
import type { PromptInput } from "./prompt-schema"
import { isDecodableText, decodeDataUrlText } from "./text-mime"

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
