import { Session } from "@/session"
import { record, type CodingEventInfo } from "./contract"

export type ExecutorSessionRef = {
  nativeSessionID?: string
  threadID?: string
  turnID?: string
}

export type PersistedExecutorSessionRef = ExecutorSessionRef & {
  provider?: string
  updatedAt?: number
}

function stringValue(input: unknown) {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined
}

export function extractExecutorSessionRef(event: CodingEventInfo): ExecutorSessionRef | undefined {
  const meta = record("meta" in event ? event.meta : undefined) ?? {}
  const threadID = stringValue(meta.thread_id) ?? stringValue(meta.threadId)
  const turnID = stringValue(meta.turn_id) ?? stringValue(meta.turnId)
  const nativeSessionID =
    stringValue("sessionID" in event ? event.sessionID : undefined) ??
    stringValue(meta.session_id) ??
    stringValue(meta.sessionID) ??
    stringValue(meta.provider_session_id) ??
    (threadID && turnID ? `${threadID}:${turnID}` : undefined)

  if (!nativeSessionID && !threadID && !turnID) return undefined
  return {
    ...(nativeSessionID ? { nativeSessionID } : {}),
    ...(threadID ? { threadID } : {}),
    ...(turnID ? { turnID } : {}),
  }
}

function executorMetadata(input: unknown): PersistedExecutorSessionRef {
  const item = record(input) ?? {}
  return {
    provider: stringValue(item.provider),
    nativeSessionID: stringValue(item.native_session_id) ?? stringValue(item.nativeSessionID),
    threadID: stringValue(item.thread_id) ?? stringValue(item.threadID),
    turnID: stringValue(item.turn_id) ?? stringValue(item.turnID),
    updatedAt:
      typeof item.updated_at === "number"
        ? item.updated_at
        : typeof item.updatedAt === "number"
          ? item.updatedAt
          : undefined,
  }
}

export async function readExecutorSessionRef(sessionID: string): Promise<PersistedExecutorSessionRef | undefined> {
  const session = await Session.get(sessionID)
  const value = executorMetadata(session.metadata?.executor)
  return value.provider || value.nativeSessionID || value.threadID || value.turnID ? value : undefined
}

export async function persistExecutorSessionRef(input: {
  sessionID: string
  provider: string
  ref?: ExecutorSessionRef
}) {
  const next: Record<string, unknown> = {
    provider: input.provider,
    updated_at: Date.now(),
  }
  const nativeSessionID = input.ref?.nativeSessionID
  const threadID = input.ref?.threadID
  const turnID = input.ref?.turnID
  if (nativeSessionID) next.native_session_id = nativeSessionID
  if (threadID) next.thread_id = threadID
  if (turnID) next.turn_id = turnID
  await Session.mergeMetadata({
    sessionID: input.sessionID,
    patch: {
      executor: next,
    },
  })
}

export function resolveNativeResumeRef(provider: string, ref: PersistedExecutorSessionRef | undefined): string {
  if (!ref) {
    throw new Error(`resolveNativeResumeRef: ${provider} has no persisted executor session ref`)
  }
  if (ref.provider && ref.provider !== provider) {
    throw new Error(`resolveNativeResumeRef: persisted provider ${ref.provider} does not match ${provider}`)
  }
  if (ref.nativeSessionID) return ref.nativeSessionID
  throw new Error(`resolveNativeResumeRef: ${provider} persisted ref has no provider-native session id`)
}
