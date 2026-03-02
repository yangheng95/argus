import { Session } from "./index"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Provider } from "@/provider/provider"
import { SessionPrompt } from "./prompt"
import { MessageV2 } from "./message"
import { Agent } from "@/agent/agent"

/**
 * Session wake mechanism.
 *
 * Injects a synthetic user message into a session to trigger the
 * `waitForUserMessage()` listener. Same pattern as compaction.ts
 * "continue" message injection (lines 202-224).
 *
 * If the session's loop is in standby (waiting for user message),
 * the injected message will wake it. If the loop is not running,
 * we start it.
 */
export namespace SessionWake {
  const log = Log.create({ service: "session.wake" })

  export interface WakeInput {
    /** Existing session ID to wake. If omitted, creates a new session. */
    sessionID?: string
    /** The prompt to inject as a synthetic user message. */
    prompt: string
    /** Agent name (default: "default"). */
    agent?: string
    /** Model override. If omitted, uses the session's last model or default. */
    model?: { providerID: string; modelID: string }
  }

  /**
   * Wake a session by injecting a synthetic user message.
   * Returns the session ID (existing or newly created).
   */
  export async function wake(input: WakeInput): Promise<string> {
    // Resolve agent name: use provided name, or fall back to the default agent
    const agent = input.agent ?? await Agent.defaultAgent()

    // Resolve or create session
    let sessionID = input.sessionID
    if (!sessionID) {
      const session = await Session.createNext({
        directory: Instance.directory,
        title: `Scheduled: ${input.prompt.slice(0, 60)}`,
      })
      sessionID = session.id
      log.info("created new session for wake", { sessionID })
    }

    // Resolve model: use override, or fetch last model from session, or default
    let model = input.model
    if (!model) {
      model = await resolveModel(sessionID)
    }

    // Inject synthetic user message (same pattern as compaction.ts line 202-224)
    const msg = await Session.updateMessage({
      id: Identifier.ascending("message"),
      role: "user",
      sessionID,
      time: { created: Date.now() },
      agent,
      model,
    })
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID,
      type: "text",
      synthetic: true,
      text: `[Scheduled wake-up] ${input.prompt}`,
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    })

    log.info("injected wake message", { sessionID, messageID: msg.id })

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
  }

  /** Resolve model from the session's last user message, or fall back to default. */
  async function resolveModel(sessionID: string): Promise<{ providerID: string; modelID: string }> {
    // Check last user message in this session for model info
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) {
        return item.info.model
      }
    }
    // Fall back to config default
    return Provider.defaultModel()
  }
}
