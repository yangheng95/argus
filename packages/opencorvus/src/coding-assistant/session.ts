import type { Session } from "@/session"
import type { SessionPrompt } from "@/session/prompt"
import { Instance } from "@/project/instance"
import { Session as SessionApi } from "@/session"
import { SessionTable } from "@/session/session.sql"
import { Database, and, desc, eq, isNull, sql } from "@/storage/db"

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

export function isRightSidebarCodingAssistantSession(
  session: Pick<Session.Info, "kind" | "metadata">,
): boolean {
  if (session.kind !== "assistant") return false
  const metadata = session.metadata
  const codingAssistant =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>).codingAssistant
      : undefined
  if (!codingAssistant || typeof codingAssistant !== "object") return false
  return (codingAssistant as Record<string, unknown>).surface === "right-sidebar"
}

export function applyRightSidebarCodingAssistantPromptOverlay<T extends Omit<SessionPrompt.PromptInput, "sessionID">>(
  prompt: T,
): T {
  const { system: _system, systemMode: _systemMode, tools, ...rest } = prompt
  const forcedTools = Object.fromEntries(
    RIGHT_SIDEBAR_CODING_ASSISTANT_REQUIRED_TOOLS.map((tool) => [tool, true]),
  )
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

export function listRightSidebarCodingAssistantSessions(input: {
  directory?: string
  limit: number
}): Session.Info[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(
        and(
          eq(SessionTable.project_id, Instance.project.id),
          eq(SessionTable.directory, input.directory ?? Instance.directory),
          eq(SessionTable.kind, "assistant"),
          isNull(SessionTable.time_archived),
          sql`json_extract(${SessionTable.metadata}, '$.codingAssistant.surface') = 'right-sidebar'`,
        ),
      )
      .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
      .limit(input.limit)
      .all(),
  )
  return rows.map(SessionApi.fromRow)
}
