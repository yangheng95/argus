import { Instance, lazyInstanceState } from "../../project/instance"
import { Log } from "../../util/log"
import { Message } from "../message"
import { SessionStatus } from "../status"
import { Session } from ".."

export namespace SessionPromptState {
  export const log = Log.create({ service: "session.prompt" })

  // Phase 5: Sessions manage their own lifecycle via explicit cancel(sessionID).
  // Instance.dispose() no longer aborts running sessions — this prevents
  // Config.update / overlay reconnect / verifyResume from killing active executor sessions.
  export const state = lazyInstanceState(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
          callbacks: {
            resolve(input: Message.WithParts): void
            reject(reason?: any): void
          }[]
        }
      > = {}
      return data
    },
  )

  export function assertNotBusy(sessionID: string) {
    if (SessionStatus.get(sessionID).type === "busy") throw new Session.BusyError(sessionID)
  }

  export function start(sessionID: string) {
    const s = state()
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller.signal
  }

  export function resume(sessionID: string) {
    const s = state()
    if (!s[sessionID]) return

    return s[sessionID].abort.signal
  }

  export function cancel(sessionID: string) {
    log.info("cancel", { sessionID })
    const s = state()
    const match = s[sessionID]
    if (!match) {
      SessionStatus.set(sessionID, { type: "idle" })
      return
    }
    match.abort.abort()
    // Reject all pending callbacks before deleting state so that
    // executePrompt() callers (task-queue-service) are unblocked.
    const error = new Error("session cancelled")
    for (const cb of match.callbacks) {
      cb.reject(error)
    }
    match.callbacks = []
    delete s[sessionID]
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }

  export function flushCallbacks(sessionID: string, result: Message.WithParts) {
    const s = state()[sessionID]
    if (!s) return
    for (const q of s.callbacks) q.resolve(result)
    s.callbacks = []
  }

}
