import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { createTaskCancellationIncomplete } from "./cancellation-error"

type SessionInfo = Awaited<ReturnType<typeof Session.get>>

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
