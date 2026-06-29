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
import { resolveAgentModelRef } from "../../agent/model"
import { Instance } from "../../project/instance"
import { InstructionPrompt } from "../instruction"
import { Plugin } from "../../plugin"
import { MCP } from "../../mcp"
import { LSP } from "../../lsp"
import { ReadTool } from "../../tool/read"
import { FileTime } from "../../file/time"
import { ConfigMarkdown } from "../../config/markdown"
import { EffectiveConfig } from "../../config/effective"
import type { Config } from "../../config/config"
import { PermissionNext } from "@/permission/next"
import { Tool } from "@/tool/tool"
import { iife } from "@/util/iife"
import { defer } from "../../util/defer"
import { fileURLToPath, pathToFileURL } from "bun"
import type { PromptInput } from "./schema"
import { isDecodableText, decodeDataUrlBase64Bytes, decodeDataUrlText, decodeRawBase64Payload } from "../text-mime"
import { AttachmentStore } from "@/storage/attachment-store"
import { setSessionTitleFromFirstUserMessage } from "../first-message-title"

const log = Log.create({ service: "session.prompt" })

function hostFileContextLabel(args: Record<string, unknown>) {
  return `Host-provided file context (not a model tool call): ${JSON.stringify(args)}`
}

function parseFileRangeLine(value: string, name: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`file range ${name} must be a positive integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`file range ${name} must be a safe integer`)
  }
  return parsed
}

export async function resolvePromptParts(
  template: string,
  opts?: { config?: Config.Info },
): Promise<PromptInput["parts"]> {
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
        const agent = await Agent.get(name, opts?.config ? { config: opts.config } : undefined)
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
  const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
  const agentName = input.agent ?? (await Agent.defaultAgent({ config }))
  if (agentName === "build" && input.systemMode !== "complete") {
    throw new Error(
      'The workflow build agent requires systemMode="complete"; use agent "coding" for direct coding assistant sessions.',
    )
  }
  const agent = await Agent.get(agentName, { config })
  if (!agent) throw new Error(`Unknown agent: ${agentName}`)

  // Single model resolver (spec §13.1): explicit > session overlay > base.
  const model = await resolveAgentModelRef(agentName, { explicitModel: input.model, sessionID: input.sessionID })
  const full =
    !input.variant && agent.variant
      ? await Provider.getModel(model.providerID, model.modelID, { config }).catch((error) => {
          log.warn("optional agent variant lookup failed", {
            sessionID: input.sessionID,
            agent: agent.name,
            providerID: model.providerID,
            modelID: model.modelID,
            error,
          })
          if (Provider.ModelNotFoundError.isInstance(error)) {
            return undefined
          }
          throw error
        })
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
    systemMode: input.systemMode,
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

  // Legacy spec/plan mode reminders were removed with the spec/plan agents
  // and spec_enter / plan_enter / *_exit tools. Nothing else injects into
  // this slot today, so we skip straight to the user-supplied parts.
  const parts = [
    ...(
      await Promise.all(
        input.parts.map(async (part): Promise<Draft<Message.Part>[]> => {
          if (part.type === "file") {
            // before checking the protocol we check if this is an mcp resource because it needs special handling
            if (part.source?.type === "resource") {
              const { clientName, uri } = part.source
              const resourceSource = {
                type: "resource" as const,
                clientName,
                uri,
                text: part.source.text ?? { value: uri, start: 0, end: uri.length },
              }
              log.info("mcp resource", { clientName, uri, mime: part.mime })

              const pieces: Draft<Message.Part>[] = [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  text: `Reading MCP resource: ${part.filename} (${uri})`,
                },
              ]

              const resourceContent = await MCP.readResource(clientName, uri)
              if (!resourceContent) {
                throw new Error(`Resource not found: ${clientName}/${uri}`)
              }

              const contents = Array.isArray(resourceContent.contents)
                ? resourceContent.contents
                : resourceContent.contents
                  ? [resourceContent.contents]
                  : []
              let materializedResourceContent = false

              for (const content of contents) {
                if (!content || typeof content !== "object") {
                  throw new Error(`MCP resource content for ${clientName}/${uri} must be an object`)
                }
                if ("text" in content && typeof content.text === "string" && content.text.length > 0) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    text: content.text as string,
                  })
                  materializedResourceContent = true
                } else if ("blob" in content && content.blob) {
                  if (typeof content.blob !== "string") {
                    throw new Error(`MCP resource blob for ${clientName}/${uri} must be a base64 string`)
                  }
                  const mimeType =
                    "mimeType" in content && typeof content.mimeType === "string" && content.mimeType
                      ? content.mimeType
                      : part.mime
                  const fileRef = await AttachmentStore.write(
                    Instance.project.id,
                    decodeRawBase64Payload(content.blob, `MCP resource blob for ${clientName}/${uri}`),
                    mimeType,
                    part.filename,
                  )
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    text: `[Binary content: ${mimeType}]`,
                  })
                  pieces.push({
                    ...part,
                    messageID: info.id,
                    sessionID: input.sessionID,
                    url: fileRef.url,
                    mime: fileRef.mime,
                    filename: fileRef.filename ?? part.filename,
                    source: resourceSource,
                  })
                  materializedResourceContent = true
                }
              }

              if (!materializedResourceContent) {
                throw new Error(`MCP resource ${clientName}/${uri} did not return usable text or blob content`)
              }

              return pieces
            }
            const url = new URL(part.url)
            switch (url.protocol) {
              case "data:": {
                const bytes = decodeDataUrlBase64Bytes(
                  part.url,
                  `SessionPrompt.createUserMessage data URL file part ${part.filename ?? part.mime}`,
                )
                const fileRef = await AttachmentStore.write(Instance.project.id, bytes, part.mime, part.filename)
                const persistedPart: Draft<Message.Part> = {
                  ...part,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  url: fileRef.url,
                  mime: fileRef.mime,
                }
                if (isDecodableText(part.mime, part.filename)) {
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      text: hostFileContextLabel({ filePath: part.filename }),
                    },
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      text: decodeDataUrlText(part.url),
                    },
                    persistedPart,
                  ]
                }
                return [persistedPart]
              }
              case "file:": {
                log.info("file", { mime: part.mime })
                const filepath = fileURLToPath(part.url)
                const s = Filesystem.stat(filepath)

                if (s?.isDirectory()) {
                  part.mime = "application/x-directory"
                }

                if (Filesystem.isTextLikeMime(part.mime)) {
                  part.mime = "text/plain"
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
                    let start = parseFileRangeLine(range.start, "start")
                    let end = range.end != null ? parseFileRangeLine(range.end, "end") : undefined
                    if (end !== undefined && end < start) {
                      throw new Error("file range end must be greater than or equal to start")
                    }
                    if (start === end) {
                      const symbols = await LSP.documentSymbol(filePathURI)
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
                    offset = start
                    if (end !== undefined) {
                      limit = end - (offset - 1)
                    }
                  }
                  const args = { filePath: filepath, offset, limit }

                  const pieces: Draft<Message.Part>[] = [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      text: hostFileContextLabel(args),
                    },
                  ]

                  const t = await ReadTool.init()
                  const model = await Provider.getModel(info.model.providerID, info.model.modelID, { config })
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
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((attachment) => ({
                        ...attachment,
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
                      text: hostFileContextLabel(args),
                    },
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
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
                // Read tool binary content used to land in part.url as a
                // raw `data:<mime>;base64,...` string, which trips the
                // Session.updatePart inline-base64 guard
                // (specs/acceptance-attachment-store-single-source-2026-05-11.md).
                // Route through AttachmentStore so the persisted url is a
                // canonical ref and the bytes round-trip via toModelOutput's
                // ref → base64 reader at LLM call time.
                const fileRef = await AttachmentStore.writeFromPath(
                  Instance.project.id,
                  filepath,
                  part.mime,
                  part.filename!,
                )
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    text: hostFileContextLabel({ filePath: filepath }),
                  },
                  {
                    id: part.id,
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    url: fileRef.url,
                    mime: fileRef.mime,
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
      )
    ).flat(),
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

  // Persist the message atomically so no observer can ever see a header-only
  // message if the process dies between the message row and its parts.
  const persisted = await Session.persistMessage({
    info,
    parts,
  })
  await setSessionTitleFromFirstUserMessage({
    sessionID: input.sessionID,
    messageID: info.id,
    parts: persisted.parts,
  })

  return persisted
}
