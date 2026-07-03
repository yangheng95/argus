import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Message } from "../session/message"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { SessionStatus } from "../session/status"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { EffectiveConfig } from "../config/effective"
import { PermissionNext } from "@/permission/next"
import { resolveAgentModelRef } from "@/agent/model"
import type { SessionKind } from "@/session/session.sql"
import { ExploreAgent } from "@/explore/agent"
import { cancelSessionPromptInScope } from "@/engine/cancellation-scope"
import { TASK_TOOL_SUBAGENT_METADATA_KEY, taskToolSessionMetadata } from "@/agent/subagent-session-metadata"

export { taskToolSessionMetadata } from "@/agent/subagent-session-metadata"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export function sessionKindForSubagent(agentName: string) {
  return agentName === "explore" ? "explore" : "assistant"
}

function taskToolPromptSwitches(input: {
  hasTaskPermission: boolean
  primaryTools?: readonly string[]
}): Record<string, boolean> {
  return {
    todowrite: false,
    todoread: false,
    ...(input.hasTaskPermission ? {} : { task: false }),
    ...Object.fromEntries((input.primaryTools ?? []).map((toolName) => [toolName, false])),
  }
}

export function assertTaskResumeSession(input: {
  resumeSession: Session.Info
  callerSession: Session.Info
  expectedKind: SessionKind
  expectedSubagent: string
}) {
  const metadataSubagent = input.resumeSession.metadata?.[TASK_TOOL_SUBAGENT_METADATA_KEY]
  if (input.resumeSession.parentID !== input.callerSession.id) {
    throw new Error(
      `Invalid task_id: ${input.resumeSession.id} is not a child session of caller session ${input.callerSession.id}`,
    )
  }
  if (input.resumeSession.kind !== input.expectedKind) {
    throw new Error(
      `Invalid task_id: ${input.resumeSession.id} has session kind ${input.resumeSession.kind}; expected ${input.expectedKind}`,
    )
  }
  if (input.resumeSession.directory !== input.callerSession.directory) {
    throw new Error(
      `Invalid task_id: ${input.resumeSession.id} belongs to ${input.resumeSession.directory}; expected ${input.callerSession.directory}`,
    )
  }
  if (metadataSubagent !== input.expectedSubagent) {
    throw new Error(
      `Invalid task_id: ${input.resumeSession.id} belongs to subagent ${String(metadataSubagent)}; expected ${input.expectedSubagent}`,
    )
  }
}

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list(ctx?.config ? { config: ctx.config } : undefined).then((x) =>
    x.filter((a) => a.mode !== "primary"),
  )

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await EffectiveConfig.effective({ sessionID: ctx.sessionID })

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type, { config })
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      // Stage agents (no permission ruleset) cannot be the target of the
      // task-tool dispatch — that path is for SessionPrompt-driven agents
      // (build/general/explore). Treat undefined as "no task perm".
      const hasTaskPermission = agent.permission?.some((rule) => rule.permission === "task") ?? false

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(params.task_id)
          const callerSession = await Session.get(ctx.sessionID)
          assertTaskResumeSession({
            resumeSession: found,
            callerSession,
            expectedKind: sessionKindForSubagent(agent.name),
            expectedSubagent: agent.name,
          })
          return found
        }

        return await Session.create({
          kind: sessionKindForSubagent(agent.name),
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          metadata: taskToolSessionMetadata(agent.name),
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await Message.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = await resolveAgentModelRef(agent.name, { sessionID: ctx.sessionID })

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      const promptSwitches = taskToolPromptSwitches({
        hasTaskPermission,
        primaryTools: config.experimental?.primary_tools,
      })

      if (agent.name === "explore") {
        const promptParts = await SessionPrompt.resolvePromptParts(params.prompt, { config })
        const unsupportedPromptParts = promptParts.filter((part) => part.type !== "text" && part.type !== "file")
        if (unsupportedPromptParts.length > 0) {
          throw new Error(
            `Explore task prompt does not support ${unsupportedPromptParts
              .map((part) => part.type)
              .join(", ")} prompt parts; use a text or file prompt instead.`,
          )
        }
        const explorePromptParts = promptParts.filter(
          (part): part is Extract<(typeof promptParts)[number], { type: "text" | "file" }> =>
            part.type === "text" || part.type === "file",
        )
        const exploreResult = await ExploreAgent.run({
          existingSessionID: session.id,
          parentSessionID: ctx.sessionID,
          sessionTitle: session.title,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          signal: ctx.abort,
          prompt: params.prompt,
          toolSwitches: promptSwitches,
          buildUserParts: async () => explorePromptParts,
        })

        return {
          title: params.description,
          metadata: {
            sessionId: session.id,
            model,
          },
          output: [
            `task_id: ${session.id} (for resuming to continue this task if needed)`,
            "",
            "<task_result>",
            exploreResult.finalText,
            "</task_result>",
          ].join("\n"),
        }
      }

      const messageID = Identifier.ascending("message")

      function cancel() {
        cancelSessionPromptInScope({ session })
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt, { config })

      let result: Awaited<ReturnType<typeof SessionPrompt.prompt>>
      try {
        result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          byteMaterializationProjectID: session.projectID,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: promptSwitches,
          parts: promptParts,
        })
      } catch (err) {
        // The subagent's actor close path will eventually emit its own
        // terminal — but only when the actor itself shuts down. For the
        // overlay card to flip to its terminal display the moment the
        // dispatch boundary completes (this is what the operator perceives
        // as "the subagent finished"), publish here too. Idempotent: a
        // later actor close will just rewrite the same terminal status.
        SessionStatus.set(session.id, {
          type: "terminal",
          reason: "error",
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      // Subagent dispatch finished from the caller's perspective. The actor
      // may stay alive in standby (so a future task_id resume can re-enter
      // streaming) — that's fine, the next prompt() call will publish
      // streaming again and the card will flip back.
      SessionStatus.set(session.id, { type: "terminal", reason: "completed" })

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
