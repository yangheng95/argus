import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { MessageV2 } from "./message"
import { SessionStatus } from "./status"
import { Session } from "."

export namespace SessionPromptState {
  export const log = Log.create({ service: "session.prompt" })

  export const state = Instance.state(
    () => {
      const data: Record<
        string,
        {
          abort: AbortController
          callbacks: {
            resolve(input: MessageV2.WithParts): void
            reject(reason?: any): void
          }[]
        }
      > = {}
      return data
    },
    async (current) => {
      for (const item of Object.values(current)) {
        item.abort.abort()
        for (const q of item.callbacks) q.reject(new Error("Instance disposed"))
        item.callbacks = []
      }
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
    for (const q of match.callbacks) q.reject(new Error("Session cancelled"))
    match.callbacks = []
    delete s[sessionID]
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }

  export function flushCallbacks(sessionID: string, result: MessageV2.WithParts) {
    const s = state()[sessionID]
    if (!s) return
    for (const q of s.callbacks) q.resolve(result)
    s.callbacks = []
  }

  export async function lastModel(sessionID: string) {
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) return item.info.model
    }
    const { Provider } = await import("../provider/provider")
    return Provider.defaultModel()
  }
}
