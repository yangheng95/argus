import z from "zod"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { resolveAgentModelRef } from "../agent/model"
import { Bus } from "../bus"
import { Plugin } from "../plugin"
import { Command } from "../command"
import { $ } from "bun"
import { ConfigMarkdown } from "../config/markdown"
import { EffectiveConfig } from "../config/effective"
import { NamedError } from "@opencorvus-ai/util/error"
import { Session } from "."
import { SessionPromptState } from "./prompt/state"

export namespace SessionCommand {
  const { log } = SessionPromptState

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
  const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
  const placeholderRegex = /\$(\d+)/g
  const quoteTrimRegex = /^["']|["']$/g

  export async function command(input: CommandInput) {
    log.info("command", input)
    const cmd = await Command.get(input.command)
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    const agentName = cmd.agent ?? input.agent ?? (await Agent.defaultAgent({ config }))

    const raw = input.arguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    const templateCommand = await cmd.template

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
      const value = Number(item.slice(1))
      if (value > last) last = value
    }

    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
      const position = Number(index)
      const argIndex = position - 1
      if (argIndex >= args.length) return ""
      if (position === last) return args.slice(argIndex).join(" ")
      return args[argIndex]
    })
    const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
    let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

    if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
      template = template + "\n\n" + input.arguments
    }

    const shell = ConfigMarkdown.shell(template)
    if (shell.length > 0) {
      const results = await Promise.all(
        shell.map(async ([, cmd]) => {
          try {
            return await $`${{ raw: cmd }}`.quiet().nothrow().text()
          } catch (error) {
            return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
          }
        }),
      )
      let index = 0
      template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    // Single model resolver (spec §13.1). Deliberately normalizes the old
    // ad-hoc order (cmd.model > cmd.agent.model > input.model > default) to
    // the canonical precedence: per-request explicit (cmd.model, else
    // input.model) > session overlay > base agent.<name>.model > base model.
    // Consolidating the parallel derivation is the rule 8 goal.
    const explicitModel = cmd.model
      ? Provider.parseModel(cmd.model)
      : input.model
        ? Provider.parseModel(input.model)
        : null
    const taskModel = await resolveAgentModelRef(cmd.agent ?? (await Agent.defaultAgent({ config })), {
      explicitModel,
      sessionID: input.sessionID,
    })

    try {
      await Provider.getModel(taskModel.providerID, taskModel.modelID, { config })
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
    const agent = await Agent.get(agentName, { config })
    if (!agent) {
      const available = await Agent.list({ config }).then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: error.toObject(),
      })
      throw error
    }

    const { SessionPrompt } = await import("./prompt")
    const templateParts = await SessionPrompt.resolvePromptParts(template, { config })
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
            prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
          },
        ]
      : [...templateParts, ...(input.parts ?? [])]

    const userAgent = isSubtask ? (input.agent ?? (await Agent.defaultAgent({ config }))) : agentName
    const userModel = isSubtask
      ? await resolveAgentModelRef(userAgent, {
          explicitModel: input.model ? Provider.parseModel(input.model) : null,
          sessionID: input.sessionID,
        })
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

    const result = (await SessionPrompt.prompt({
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
}
