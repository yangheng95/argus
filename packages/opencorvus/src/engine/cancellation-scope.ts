import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { AwaitTimeoutError } from "@/util/await-with-timeout"
import { createTaskCancellationIncomplete } from "./cancellation-error"

type SessionInfo = Awaited<ReturnType<typeof Session.get>>
type PromptSession = Pick<SessionInfo, "id" | "directory">

const DEFAULT_PROMPT_SETTLE_INACTIVITY_MS = 5_000

export function cancelSessionPromptInScope(input: {
  session: Pick<SessionInfo, "id" | "directory">
  taskID?: string
  runID?: string
  handle?: string
}): boolean {
  const handle = input.handle ?? "SessionPrompt.cancel"
  const cancelled = SessionPrompt.cancel(input.session.id, input.session.directory)
  const status = SessionStatus.get(input.session.id)
  if (!cancelled && status.type !== "idle" && status.type !== "terminal") {
    throw createTaskCancellationIncomplete({
      taskID: input.taskID,
      runID: input.runID,
      handle,
      cause: new Error("no live prompt state matched session directory"),
    })
  }
  return cancelled
}

export async function awaitSessionPromptFinishedInScope(input: {
  session: Pick<SessionInfo, "id" | "directory">
  taskID?: string
  runID?: string
  handle?: string
  inactivityTimeoutMs?: number
}): Promise<boolean> {
  const handle = input.handle ?? "SessionPrompt.finish"
  if (!SessionPrompt.isActive(input.session.id, input.session.directory)) return false
  try {
    await waitForPromptFinishAfterInactivity({
      sessionID: input.session.id,
      directory: input.session.directory,
      inactivityTimeoutMs: input.inactivityTimeoutMs ?? DEFAULT_PROMPT_SETTLE_INACTIVITY_MS,
      label: handle,
    })
    return true
  } catch (cause) {
    throw createTaskCancellationIncomplete({
      taskID: input.taskID,
      runID: input.runID,
      handle,
      cause,
    })
  }
}

export async function cancelSessionPromptSubtreeInScope(input: {
  sessionID: string
  projectID: string
  taskID?: string
  runID?: string
  handle?: string
  inactivityTimeoutMs?: number
}): Promise<{ sessionIDs: string[]; cancelledSessionIDs: string[] }> {
  const requested = await requestSessionPromptSubtreeCancellation(input)
  await assertSessionPromptSubtreeFinished({
    sessions: requested.cancelledSessions,
    failures: requested.failures,
    taskID: input.taskID,
    runID: input.runID,
    handle: input.handle,
    inactivityTimeoutMs: input.inactivityTimeoutMs,
  })
  return {
    sessionIDs: requested.sessionIDs,
    cancelledSessionIDs: requested.cancelledSessions.map((session) => session.id),
  }
}

export async function requestSessionPromptSubtreeCancellation(input: {
  sessionID: string
  projectID: string
  taskID?: string
  runID?: string
  handle?: string
}): Promise<{ sessionIDs: string[]; cancelledSessions: PromptSession[]; failures: unknown[] }> {
  const handle = input.handle ?? "SessionPrompt.cancel"
  const sessionIDs = await Session.treeInProject({ sessionID: input.sessionID, projectID: input.projectID })
  const sessions = await Promise.all(
    sessionIDs.map((sessionID) => Session.getInProject({ sessionID, projectID: input.projectID })),
  )
  const cancelledSessions: PromptSession[] = []
  const failures: unknown[] = []

  for (const session of sessions.slice().reverse()) {
    try {
      if (
        cancelSessionPromptInScope({
          session,
          taskID: input.taskID,
          runID: input.runID,
          handle,
        })
      ) {
        cancelledSessions.push(session)
      }
    } catch (error) {
      failures.push(error)
    }
  }

  return { sessionIDs, cancelledSessions, failures }
}

export async function assertSessionPromptSubtreeFinished(input: {
  sessions: PromptSession[]
  failures?: unknown[]
  taskID?: string
  runID?: string
  handle?: string
  inactivityTimeoutMs?: number
}): Promise<void> {
  const handle = input.handle ?? "SessionPrompt.cancel"
  const failures = [...(input.failures ?? [])]
  const settled = await Promise.allSettled(
    input.sessions.map((session) =>
      awaitSessionPromptFinishedInScope({
        session,
        taskID: input.taskID,
        runID: input.runID,
        handle: `${handle}.finish`,
        inactivityTimeoutMs: input.inactivityTimeoutMs,
      }),
    ),
  )
  for (const result of settled) {
    if (result.status === "rejected") failures.push(result.reason)
  }

  if (failures.length > 0) {
    throw createTaskCancellationIncomplete({
      taskID: input.taskID,
      runID: input.runID,
      handle,
      cause: new Error(failures.map(cancellationFailureMessage).join("; ")),
    })
  }
}

export function terminateSessionPromptInScope(input: {
  session: Pick<SessionInfo, "id" | "directory">
  reason: string
}): boolean {
  const cancelled = SessionPrompt.cancel(input.session.id, input.session.directory)
  const status = SessionStatus.get(input.session.id)
  if (status.type !== "terminal") {
    SessionStatus.set(input.session.id, { type: "terminal", reason: "aborted", error: input.reason })
  }
  return cancelled
}

export async function cancelSessionPromptByID(input: {
  sessionID: string
  taskID?: string
  runID?: string
  handle?: string
}): Promise<boolean> {
  return cancelSessionPromptInScope({
    session: await Session.get(input.sessionID),
    taskID: input.taskID,
    runID: input.runID,
    handle: input.handle,
  })
}

function waitForPromptFinishAfterInactivity(input: {
  sessionID: string
  directory: string
  inactivityTimeoutMs: number
  label: string
}): Promise<void> {
  if (!SessionPrompt.isActive(input.sessionID, input.directory)) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
    const complete = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        complete(() =>
          reject(new AwaitTimeoutError(`${input.label} ${input.sessionID} inactive`, input.inactivityTimeoutMs)),
        )
      }, input.inactivityTimeoutMs)
    }
    const unsubscribe = Bus.subscribe(SessionStatus.Event.Status, (event) => {
      if (event.properties.sessionID === input.sessionID) schedule()
    })

    schedule()
    SessionPrompt.waitForFinish(input.sessionID, input.directory).then(
      () => complete(() => resolve()),
      (error) => complete(() => reject(error)),
    )
  })
}

function cancellationFailureMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
