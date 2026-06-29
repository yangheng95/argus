import { Instance } from "../../project/instance"
import { Log } from "../../util/log"
import { Filesystem } from "../../util/filesystem"
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
      finished: Promise<void>
      finish(): void
      timeCreated: number
      timeUpdated: number
      timeCancelled?: number
    }
  >

  function createPromptState(): PromptState {
    return {}
  }

  function createFinishSignal() {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    return { finished, finish }
  }

  const statesByDirectory = new Map<string, PromptState>()

  function directoryKey(directory?: string) {
    return Filesystem.resolve(directory ?? Instance.directory)
  }

  function stateEntry(directory?: string) {
    const key = directoryKey(directory)
    let promptState = statesByDirectory.get(key)
    if (!promptState) {
      promptState = createPromptState()
      statesByDirectory.set(key, promptState)
    }
    return { key, promptState }
  }

  function existingStateEntry(directory?: string) {
    const key = directoryKey(directory)
    return { key, promptState: statesByDirectory.get(key) }
  }

  function existingStateEntryBySessionID(sessionID: string) {
    for (const [key, promptState] of statesByDirectory) {
      if (promptState[sessionID]) return { key, promptState }
    }
    return undefined
  }

  function existingStateEntryByAbort(sessionID: string, abort: AbortSignal) {
    for (const [key, promptState] of statesByDirectory) {
      const match = promptState[sessionID]
      if (match?.abort.signal === abort) return { key, promptState }
    }
    return undefined
  }

  function existingStateEntryForSession(sessionID: string, directory?: string) {
    if (directory !== undefined) return existingStateEntry(directory)
    return existingStateEntryBySessionID(sessionID) ?? { key: undefined, promptState: undefined }
  }

  function deleteDirectoryIfEmpty(key: string, promptState: PromptState) {
    if (Object.keys(promptState).length === 0 && statesByDirectory.get(key) === promptState) {
      statesByDirectory.delete(key)
    }
  }

  export function state(directory?: string) {
    return stateEntry(directory).promptState
  }

  export function assertNotBusy(sessionID: string) {
    if (SessionStatus.get(sessionID).type === "streaming") throw new BusyError(sessionID)
  }

  export function start(sessionID: string, directory?: string) {
    const { promptState: s } = stateEntry(directory)
    if (s[sessionID]) return
    const controller = new AbortController()
    const finished = createFinishSignal()
    const now = Date.now()
    s[sessionID] = {
      abort: controller,
      callbacks: [],
      finished: finished.finished,
      finish: finished.finish,
      timeCreated: now,
      timeUpdated: now,
    }
    return controller.signal
  }

  export function touch(sessionID: string, directory?: string): void {
    const match = existingStateEntryForSession(sessionID, directory).promptState?.[sessionID]
    if (!match) return
    match.timeUpdated = Date.now()
  }

  export function activity(sessionID: string, directory?: string) {
    const match = existingStateEntryForSession(sessionID, directory).promptState?.[sessionID]
    if (!match) return undefined
    return {
      timeCreated: match.timeCreated,
      timeUpdated: match.timeUpdated,
      timeCancelled: match.timeCancelled,
    }
  }

  export function attach(sessionID: string, directory?: string): Promise<Message.WithParts> {
    const match = existingStateEntryForSession(sessionID, directory).promptState?.[sessionID]
    if (!match) {
      return Promise.reject(new Error(`Session ${sessionID} prompt owner missing during attach`))
    }
    if (match.abort.signal.aborted || match.timeCancelled !== undefined) {
      return Promise.reject(
        new Error(
          `Session ${sessionID} has a cancelled prompt owner that has not finished; refusing to attach a new prompt callback`,
        ),
      )
    }
    touch(sessionID, directory)
    return new Promise<Message.WithParts>((resolve, reject) => {
      match.callbacks.push({ resolve, reject })
    })
  }

  export function isActive(sessionID: string, directory?: string): boolean {
    return Boolean(existingStateEntryForSession(sessionID, directory).promptState?.[sessionID])
  }

  export function isActiveInAnyDirectory(sessionID: string): boolean {
    for (const promptState of statesByDirectory.values()) {
      if (promptState[sessionID]) return true
    }
    return false
  }

  export function waitForFinish(sessionID: string, directory?: string): Promise<void> {
    return existingStateEntryForSession(sessionID, directory).promptState?.[sessionID]?.finished ?? Promise.resolve()
  }

  export function resume(sessionID: string, directory?: string) {
    const { promptState: s } = existingStateEntryForSession(sessionID, directory)
    if (!s?.[sessionID]) return

    return s[sessionID].abort.signal
  }

  export function cancel(sessionID: string, directory?: string): boolean {
    log.info("cancel", { sessionID })
    SessionStatus.abortActivityMonitor(sessionID, new DOMException("session cancelled", "AbortError"))
    const { promptState: s } = existingStateEntryForSession(sessionID, directory)
    const match = s?.[sessionID]
    const statusOptions = directory ? { publish: false } : undefined
    if (!match) {
      if (directory) return false
      SessionStatus.set(sessionID, { type: "terminal", reason: "aborted" }, statusOptions)
      return false
    }
    match.abort.abort()
    const now = Date.now()
    match.timeCancelled = now
    match.timeUpdated = now
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
    const entry =
      (abort ? existingStateEntryByAbort(sessionID, abort) : undefined) ??
      existingStateEntryForSession(sessionID, directory)
    const { key, promptState: s } = entry
    const match = s?.[sessionID]
    if (key === undefined) return
    if (!match) return
    if (abort && match.abort.signal !== abort) return
    const error = new Error("session prompt loop finished")
    for (const cb of match.callbacks) {
      cb.reject(error)
    }
    match.callbacks = []
    match.finish()
    delete s[sessionID]
    deleteDirectoryIfEmpty(key, s)
  }

  export function flushCallbacks(sessionID: string, result: Message.WithParts, directory?: string) {
    const s = existingStateEntryForSession(sessionID, directory).promptState?.[sessionID]
    if (!s) return
    s.timeUpdated = Date.now()
    for (const q of s.callbacks) q.resolve(result)
    s.callbacks = []
  }
}
