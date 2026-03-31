import z from "zod"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Log } from "../util/log"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { Bus } from "../bus"
import { Plugin } from "../plugin"
import { $ } from "bun"
import { ConfigMarkdown } from "../config/markdown"
import { NamedError } from "@opencorvus-ai/util/error"
import { Session } from "."
import { Command } from "../command"
import { installRuntimeShims } from "@/runtime/shims"
import { lastModel } from "./prompt-state"
import { resolvePromptParts } from "./prompt-message"
import type { PromptInput } from "./prompt-schema"

const log = Log.create({ service: "session.prompt" })

export const CommandInput = z.object({
  messageID: Identifier.schema("message").optional(),
  sessionID: Identifier.schema("session"),
  agent: z.string().optional(),
  model: z.string().optional(),
  arguments: z.string(),
  command: z.string(),
  variant: z.string().optional(),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        Message.FilePart.omit({
          messageID: true,
          sessionID: true,
        }).partial({
          id: true,
        }),
      ]),
    )
    .optional(),
})
export type CommandInput = z.infer<typeof CommandInput>

const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export async function command(
  input: CommandInput,
  deps: {
    prompt: (input: PromptInput) => Promise<Message.WithParts>
  },
) {
  installRuntimeShims()
  log.info("command", input)
  const cmd = await Command.get(input.command)
  const agentName = cmd.agent ?? input.agent ?? (await Agent.defaultAgent())

  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

  const templateCommand = await cmd.template

  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  // Let the final placeholder swallow any extra arguments so prompts read naturally
  const withArgs = templateCommand.replaceAll(placeholderRegex, (_: string, index: string) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

  // If command doesn't explicitly handle arguments (no $N or $ARGUMENTS placeholders)
  // but user provided arguments, append them to the template
  if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
    template = template + "\n\n" + input.arguments
  }

  const shellMatches = ConfigMarkdown.shell(template)
  if (shellMatches.length > 0) {
    const results = await Promise.all(
      shellMatches.map(async ([, shellCmd]) => {
        try {
          return await $`${{ raw: shellCmd }}`.quiet().nothrow().text()
        } catch (error) {
          return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
        }
      }),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }
  template = template.trim()

  const taskModel = await (async () => {
    if (cmd.model) {
      return Provider.parseModel(cmd.model)
    }
    if (cmd.agent) {
      const cmdAgent = await Agent.get(cmd.agent)
      if (cmdAgent?.model) {
        return cmdAgent.model
      }
    }
    if (input.model) return Provider.parseModel(input.model)
    return await lastModel(input.sessionID)
  })()

  try {
    await Provider.getModel(taskModel.providerID, taskModel.modelID)
  } catch (e) {
    if (Provider.ModelNotFoundError.isInstance(e)) {
      const { providerID, modelID, suggestions } = e.data
      const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
      })
    }
    throw e
  }
  const agent = await Agent.get(agentName)
  if (!agent) {
    const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
    Bus.publish(Session.Event.Error, {
      sessionID: input.sessionID,
      error: error.toObject(),
    })
    throw error
  }

  const templateParts = await resolvePromptParts(template)
  const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
  const parts = isSubtask
    ? [
        {
          type: "subtask" as const,
          agent: agent.name,
          description: cmd.description ?? "",
          command: input.command,
          model: {
            providerID: taskModel.providerID,
            modelID: taskModel.modelID,
          },
          // TODO: how can we make task tool accept a more complex input?
          prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
        },
      ]
    : [...templateParts, ...(input.parts ?? [])]

  const userAgent = isSubtask ? (input.agent ?? (await Agent.defaultAgent())) : agentName
  const userModel = isSubtask
    ? input.model
      ? Provider.parseModel(input.model)
      : await lastModel(input.sessionID)
    : taskModel

  await Plugin.trigger(
    "command.execute.before",
    {
      command: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
    },
    { parts },
  )

  const result = (await deps.prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model: userModel,
    agent: userAgent,
    parts,
    variant: input.variant,
  })) as Message.WithParts

  Bus.publish(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  })

  return result
}
