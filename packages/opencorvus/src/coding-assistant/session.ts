import type { Session } from "@/session"
import type { SessionPrompt } from "@/session/prompt"
import { Instance } from "@/project/instance"
import { Session as SessionApi } from "@/session"
import { SessionTable } from "@/session/session.sql"
import { Database, and, desc, eq, isNull, like, or, sql, type SQL } from "@/storage/db"

export const RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA = {
  codingAssistant: {
    surface: "right-sidebar",
  },
} as const
export const RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE = "right-sidebar-assistant"
export const RIGHT_SIDEBAR_CODING_ASSISTANT_REQUIRED_TOOLS = [
  "panel",
  "question",
  "bash",
  "read",
  "glob",
  "search_code",
  "edit",
  "write",
  "apply_patch",
  "todoread",
  "todowrite",
] as const
type RightSidebarCodingAssistantMetadata = {
  surface: "right-sidebar"
  selectedTaskID?: string | null
  executor?: string | null
}

export function isRightSidebarCodingAssistantSession(session: Pick<Session.Info, "kind" | "metadata">): boolean {
  if (session.kind !== "assistant") return false
  const metadata = session.metadata
  const codingAssistant =
    metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).codingAssistant : undefined
  if (!codingAssistant || typeof codingAssistant !== "object") return false
  return (codingAssistant as Record<string, unknown>).surface === "right-sidebar"
}

export function applyRightSidebarCodingAssistantPromptOverlay<T extends Omit<SessionPrompt.PromptInput, "sessionID">>(
  prompt: T,
): T {
  const { system: _system, systemMode: _systemMode, tools, ...rest } = prompt
  const forcedTools = Object.fromEntries(RIGHT_SIDEBAR_CODING_ASSISTANT_REQUIRED_TOOLS.map((tool) => [tool, true]))
  return {
    ...rest,
    agent: "coding-assistant",
    tools: {
      ...(tools ?? {}),
      ...forcedTools,
    },
    extra: {
      ...(prompt.extra ?? {}),
      surface: "right-sidebar",
      source: RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE,
    },
  } as unknown as T
}

export async function setRightSidebarCodingAssistantSelectedTask(input: {
  session: Session.Info
  taskID: string | null
}) {
  const current =
    input.session.metadata && typeof input.session.metadata === "object"
      ? (input.session.metadata as Record<string, unknown>).codingAssistant
      : undefined
  const codingAssistant: RightSidebarCodingAssistantMetadata = {
    ...((current && typeof current === "object" ? current : {}) as Partial<RightSidebarCodingAssistantMetadata>),
    surface: "right-sidebar",
    selectedTaskID: input.taskID,
  }
  return SessionApi.mergeMetadata({
    sessionID: input.session.id,
    patch: { codingAssistant },
  })
}

export type RightSidebarCodingAssistantSessionListInput = {
  directory?: string
  limit: number
  cursorUpdated?: number
  cursorSessionID?: string
  search?: string
}

export type RightSidebarCodingAssistantSessionList = {
  sessions: Session.Info[]
  nextCursor?: {
    updated: number
    sessionID: string
  }
}

export function listRightSidebarCodingAssistantSessions(
  input: RightSidebarCodingAssistantSessionListInput,
): RightSidebarCodingAssistantSessionList {
  const conditions: SQL[] = [
    eq(SessionTable.project_id, Instance.project.id),
    eq(SessionTable.directory, input.directory ?? Instance.directory),
    eq(SessionTable.kind, "assistant" as const),
    isNull(SessionTable.time_archived),
    sql`json_extract(${SessionTable.metadata}, '$.codingAssistant.surface') = 'right-sidebar'`,
  ]
  const search = input.search?.trim()
  if (search) {
    conditions.push(or(like(SessionTable.title, `%${search}%`), like(SessionTable.id, `%${search}%`))!)
  }
  if (input.cursorUpdated !== undefined) {
    const cursorUpdated = input.cursorUpdated
    const cursorSessionID = input.cursorSessionID ?? ""
    conditions.push(
      or(
        sql`${SessionTable.time_updated} < ${cursorUpdated}`,
        cursorSessionID
          ? sql`${SessionTable.time_updated} = ${cursorUpdated} AND ${SessionTable.id} < ${cursorSessionID}`
          : sql`${SessionTable.time_updated} = ${cursorUpdated} AND ${SessionTable.id} < ''`,
      )!,
    )
  }
  const visibleLimit = input.limit
  const rows = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      .limit(visibleLimit + 1)
      .all(),
  )
  const visible = rows.slice(0, visibleLimit).map(SessionApi.fromRow)
  const last = visible.at(-1)
  return {
    sessions: visible,
    ...(rows.length > visibleLimit && last
      ? {
          nextCursor: {
            updated: last.time.updated,
            sessionID: last.id,
          },
        }
      : {}),
  }
}
