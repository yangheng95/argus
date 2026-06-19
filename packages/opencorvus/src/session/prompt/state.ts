import { Instance, lazyInstanceState } from "../../project/instance"
import { State } from "../../project/state"
import { Log } from "../../util/log"
import { Message } from "../message"
import { SessionStatus } from "../status"

export namespace SessionPromptState {
  export const log = Log.create({ service: "session.prompt" })

  class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
      this.name = "BusyError"
    }
  }

  // Phase 5: Sessions manage their own lifecycle via explicit cancel(sessionID).
  // Instance.dispose() no longer aborts running sessions — this prevents
  // Config.update / overlay reconnect / verifyResume from killing active executor sessions.
  type PromptState = Record<
    string,
    {
      abort: AbortController
      callbacks: {
        resolve(input: Message.WithParts): void
        reject(reason?: any): void
      }[]
    }
  >

  function createPromptState(): PromptState {
    return {}
  }

  const instanceState = lazyInstanceState(createPromptState)
  const explicitStates = new Map<string, () => PromptState>()

  export function state(directory?: string) {
    if (!directory) return instanceState()
    let stateForDirectory = explicitStates.get(directory)
    if (!stateForDirectory) {
      stateForDirectory = State.create(() => directory, createPromptState)
      explicitStates.set(directory, stateForDirectory)
    }
    return stateForDirectory()
  }

  export function assertNotBusy(sessionID: string) {
    if (SessionStatus.get(sessionID).type === "streaming") throw new BusyError(sessionID)
  }

  export function start(sessionID: string, directory?: string) {
    const s = state(directory)
    if (s[sessionID]) return
    const controller = new AbortController()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
    }
    return controller.signal
  }

  export function resume(sessionID: string, directory?: string) {
    const s = state(directory)
    if (!s[sessionID]) return

    return s[sessionID].abort.signal
  }

  export function cancel(sessionID: string, directory?: string): boolean {
    log.info("cancel", { sessionID })
    SessionStatus.abortActivityGate(sessionID, new DOMException("session cancelled", "AbortError"))
    const s = state(directory)
    const match = s[sessionID]
    const statusOptions = directory ? { publish: false } : undefined
    if (!match) {
      if (directory) return false
      SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" }, statusOptions)
      return false
    }
    match.abort.abort()
    // Reject all pending callbacks before deleting state so that
    // executePrompt() callers (task-queue-service) are unblocked.
    const error = new Error("session cancelled")
    for (const cb of match.callbacks) {
      cb.reject(error)
    }
    match.callbacks = []
    // Keep the busy slot until the owning prompt loop observes the abort and
    // calls finish(sessionID, sameAbortSignal). Deleting here lets a retry
    // start in the same session while the old provider/tool stack is still
    // unwinding, which races runtime contracts and terminal collectors.
    SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" }, statusOptions)
    return true
  }

  export function finish(sessionID: string, abort?: AbortSignal, directory?: string) {
    const s = state(directory)
    const match = s[sessionID]
    if (!match) return
    if (abort && match.abort.signal !== abort) return
    const error = new Error("session prompt loop finished")
    for (const cb of match.callbacks) {
      cb.reject(error)
    }
    match.callbacks = []
    delete s[sessionID]
  }

  export function flushCallbacks(sessionID: string, result: Message.WithParts, directory?: string) {
    const s = state(directory)[sessionID]
    if (!s) return
    for (const q of s.callbacks) q.resolve(result)
    s.callbacks = []
  }
}
