import { Session } from "./index"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { SessionPrompt } from "./prompt"
import { Agent } from "@/agent/agent"
import { SessionContext } from "./context"
import { EffectiveConfig } from "@/config/effective"
import { SessionAgentIdentity } from "./agent-identity"
import { SessionControl } from "./control"
import { Database } from "@/storage/db"
import z from "zod"
import { setSessionTitleFromFirstUserMessage } from "./first-message-title"

/**
 * Session wake mechanism.
 *
 * Appends a scheduled prompt as a normal session message to trigger the
 * `waitForUserMessage()` listener.
 *
 * If the session's loop is in standby (waiting for user message),
 * the injected message will wake it. If the loop is not running,
 * we start it.
 */
export namespace SessionWake {
  const log = Log.create({ service: "session.wake" })

  export const WakeReason = z.discriminatedUnion("source", [
    z.object({
      source: z.literal("mission.operator"),
      missionID: z.string().optional(),
    }),
    z.object({
      source: z.literal("mission.child_task_result"),
      missionID: z.string().optional(),
      taskID: z.string(),
      taskStatus: z.enum(["completed", "failed", "cancelled"]),
    }),
    z.object({
      source: z.literal("scheduler.cron"),
      jobID: z.string(),
      jobName: z.string(),
      fireID: z.string(),
      expression: z.string(),
      oneShot: z.boolean(),
    }),
    z.object({
      source: z.literal("scheduler.event"),
      jobID: z.string(),
      jobName: z.string(),
      fireID: z.string(),
      eventType: z.string(),
      oneShot: z.boolean(),
    }),
    z.object({
      source: z.literal("scheduler.task_queue"),
      queueTaskID: z.string().optional(),
      queueSource: z.string().optional(),
    }),
  ])
  export type WakeReason = z.infer<typeof WakeReason>

  export interface WakeInput {
    /** Existing session ID to wake. If omitted, creates a new session. */
    sessionID?: string
    /** The prompt to append as the next session message. */
    prompt: string
    /** Structured reason used to audit why this session was woken. */
    reason: WakeReason
    /** Agent name. If omitted, uses Agent.defaultAgent(). */
    agent?: string
    /** Model override. If omitted, uses the configured default model. */
    model?: { providerID: string; modelID: string }
  }

  export function reasonExtra(reason: WakeReason): { wake_reason: WakeReason } {
    return { wake_reason: WakeReason.parse(reason) }
  }

  /**
   * Wake a session by appending the scheduled prompt.
   * Returns the session ID (existing or newly created).
   */
  export async function wake(input: WakeInput): Promise<string> {
    const reason = WakeReason.parse(input.reason)
    // Resolve or create session
    let sessionID = input.sessionID
    let session: Session.Info
    if (!sessionID) {
      session = await Session.createNext({
        kind: "assistant",
        directory: Instance.directory,
        title: `Scheduled: ${input.prompt.slice(0, 60)}`,
      })
      sessionID = session.id
      log.info("created new session for wake", { sessionID })
    } else {
      session = await Session.get(sessionID)
    }

    const config = await EffectiveConfig.effective({ sessionID })
    const agent =
      SessionAgentIdentity.resolveForWake({
        sessionKind: session.kind,
        requestedAgent: input.agent,
      }) ?? (await Agent.defaultAgent({ config }))
    if (
      SessionPrompt.agentKindRequiresRuntimeContract(agent) ||
      SessionPrompt.agentKindRequiresRuntimeContract(session.kind)
    ) {
      throw new Error(
        `SessionWake cannot wake runtime-required agent/session without an installed runtime contract: agent=${agent}, sessionKind=${session.kind}`,
      )
    }

    return SessionContext.provide(session, async () => {
      const model = await resolveModel(agent, sessionID, input.model)
      const messageID = Identifier.ascending("message")
      const partID = Identifier.ascending("part")
      const textPart = {
        id: partID,
        messageID,
        sessionID,
        type: "text",
        text: input.prompt,
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      } satisfies Parameters<typeof setSessionTitleFromFirstUserMessage>[0]["parts"][number]

      const msg = {
        id: messageID,
        role: "user",
        sessionID,
        time: { created: Date.now() },
        agent,
        model,
        extra: reasonExtra(reason),
      } satisfies Parameters<typeof Session.updateMessage>[0]
      Database.transaction(() => {
        Session.persistMessage({
          info: msg,
          parts: [textPart],
          touchSessionID: sessionID,
        })
        SessionControl.create({
          sessionID,
          kind: "wake_reason",
          status: "consumed",
          owner: reason.source,
          payload: {
            messageID,
            wake_reason: reason,
          },
        })
      })
      await setSessionTitleFromFirstUserMessage({
        sessionID,
        messageID,
        parts: [textPart],
      })

      log.info("injected wake message", { sessionID, messageID: msg.id, wakeReason: reason.source })

      // Start the session loop.
      //
      // For existing sessions with an active loop in standby (waitForUserMessage),
      // the Bus event from updateMessage above will wake it automatically.
      //
      // For new sessions or sessions whose loop has ended, we need to start
      // a fresh loop. Using resume_existing=false ensures a new loop starts.
      // If a loop is already running, start() returns undefined and the
      // function enters the callback path (which resolves when the loop
      // processes our message).
      void SessionPrompt.loop({
        sessionID,
        resume_existing: false,
      }).catch((err) => {
        log.error("wake loop failed", { sessionID, err })
      })

      return sessionID
    })
  }

  /** Resolve the agent model through the single resolver. Session message
   * history must NOT influence runtime model. */
  async function resolveModel(
    agent: string,
    sessionID: string,
    explicitModel?: { providerID: string; modelID: string },
  ): Promise<{ providerID: string; modelID: string }> {
    const { resolveAgentModelRef } = await import("@/agent/model")
    return resolveAgentModelRef(agent, { sessionID, explicitModel: explicitModel ?? null })
  }
}
