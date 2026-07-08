import z from "zod"
import { EngineTaskTable } from "@/engine/engine.sql"
import { deriveTaskStatus } from "@/engine/task-status"
import { findTask, listTaskRows } from "@/engine/store"
import { MissionID } from "@/mission/schema"
import {
  MissionTaskStats,
  missionRecord,
  missionTaskBinding,
  type MissionTaskProjectionValue,
} from "@/mission/projection"
import { getMissionSessionByDirectory } from "@/mission/session"
import { ProjectTable } from "@/project/project.sql"
import { Session, SessionStatus } from "@/session"
import { SessionTable } from "@/session/session.sql"
import { Database, sql } from "@/storage/db"
import { StatusSnapshotState, statusFromTaskLifecycle } from "@/status/task-status-snapshot"

export const WorkLedgerChatStatus = z.enum(["active", "idle", "terminal"])

export const WorkLedgerTaskRow = z.object({
  kind: z.literal("task"),
  id: z.string(),
  title: z.string(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  lifecycleStatus: z.enum(["queued", "active", "completed", "failed", "cancelled"]),
  executionStatus: StatusSnapshotState,
  priority: z.enum(["critical", "high", "normal", "low"]),
  source: z.string(),
  missionID: MissionID.optional(),
  missionSessionID: z.string().optional(),
})

export const WorkLedgerMissionRow = z.object({
  kind: z.literal("mission"),
  id: MissionID,
  missionID: MissionID,
  sessionID: z.string(),
  title: z.string(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  archived: z.number().optional(),
  interruptible: z.boolean(),
  taskStats: MissionTaskStats,
  tasks: WorkLedgerTaskRow.array(),
})

export const WorkLedgerChatRow = z.object({
  kind: z.literal("chat"),
  id: z.string(),
  sessionID: z.string(),
  title: z.string(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  status: WorkLedgerChatStatus,
})

export const WorkLedgerRow = z.discriminatedUnion("kind", [
  WorkLedgerMissionRow,
  WorkLedgerTaskRow,
  WorkLedgerChatRow,
])

export const WorkLedgerCursor = z.object({
  updated: z.number(),
  rowKey: z.string(),
})

export const WorkLedgerList = z.object({
  rows: WorkLedgerRow.array(),
  nextCursor: WorkLedgerCursor.nullable(),
})

export type WorkLedgerRowValue = z.infer<typeof WorkLedgerRow>
export type WorkLedgerListValue = z.infer<typeof WorkLedgerList>

type WorkLedgerTopRowCandidate = {
  kind: "mission" | "task" | "chat"
  id: string
  sessionID: string | null
  directory: string
  updated: number
  rowKey: string
}

export type WorkLedgerListInput = {
  directory?: string
  search?: string
  limit?: number
  cursorUpdated?: number
  cursorRowKey?: string
}

function rowKey(row: Pick<WorkLedgerRowValue, "kind" | "id">): string {
  return `${row.kind}:${row.id}`
}

function searchPattern(search: string | undefined): string | undefined {
  const term = search?.trim()
  return term ? `%${term}%` : undefined
}

function chatStatus(sessionID: string): z.infer<typeof WorkLedgerChatStatus> {
  const status = SessionStatus.get(sessionID)
  if (status.type === "terminal") return "terminal"
  if (status.type === "streaming" || status.type === "retry") return "active"
  return "idle"
}

function workLedgerTaskFromMissionTask(
  task: MissionTaskProjectionValue,
  mission: { missionID: string; sessionID: string },
) {
  return WorkLedgerTaskRow.parse({
    kind: "task",
    id: task.id,
    title: task.title,
    directory: task.directory,
    created: task.created,
    updated: task.updated,
    lifecycleStatus: task.status,
    executionStatus: task.executionStatus,
    priority: task.priority,
    source: task.source,
    missionID: mission.missionID,
    missionSessionID: mission.sessionID,
  })
}

function workLedgerTaskFromTaskID(taskID: string) {
  const task = findTask(taskID)
  if (!task) throw new Error(`Work Ledger task candidate missing task row: ${taskID}`)
  const item = listTaskRows([task])[0]
  if (!item) throw new Error(`Work Ledger task candidate missing task projection: ${taskID}`)
  const lifecycleStatus = deriveTaskStatus(task)
  const binding = missionTaskBinding(task)
  return WorkLedgerTaskRow.parse({
    kind: "task",
    id: task.id,
    title: task.title,
    directory: item.directory,
    created: task.time_created,
    updated: task.time_updated,
    lifecycleStatus,
    executionStatus: statusFromTaskLifecycle(lifecycleStatus),
    priority: task.priority,
    source: task.source,
    ...(binding
      ? {
          missionID: binding.missionID,
          missionSessionID: binding.missionSessionID,
        }
      : {}),
  })
}

async function workLedgerMissionFromCandidate(candidate: WorkLedgerTopRowCandidate) {
  const session = await getMissionSessionByDirectory({ missionID: candidate.id, directory: candidate.directory })
  const record = missionRecord(session)
  return WorkLedgerMissionRow.parse({
    kind: "mission",
    id: record.missionID,
    missionID: record.missionID,
    sessionID: record.sessionID,
    title: record.title,
    directory: record.directory,
    created: record.created,
    updated: record.updated,
    archived: record.archived,
    interruptible: record.interruptible,
    taskStats: record.taskStats,
    tasks: record.tasks.map((task) =>
      workLedgerTaskFromMissionTask(task, { missionID: record.missionID, sessionID: record.sessionID }),
    ),
  })
}

async function workLedgerChatFromCandidate(candidate: WorkLedgerTopRowCandidate) {
  const sessionID = candidate.sessionID ?? candidate.id
  const session = await Session.get(sessionID)
  return WorkLedgerChatRow.parse({
    kind: "chat",
    id: session.id,
    sessionID: session.id,
    title: session.title,
    directory: session.directory,
    created: session.time.created,
    updated: session.time.updated,
    status: chatStatus(session.id),
  })
}

function topRowCandidates(input: Required<Pick<WorkLedgerListInput, "limit">> & WorkLedgerListInput) {
  const directory = input.directory?.trim()
  const search = searchPattern(input.search)
  const limit = input.limit + 1
  return Database.use((db) =>
    db.all<WorkLedgerTopRowCandidate>(sql`
      WITH top_rows AS (
        SELECT
          'mission' AS kind,
          json_extract(${SessionTable.metadata}, '$.mission.id') AS id,
          ${SessionTable.id} AS sessionID,
          ${SessionTable.directory} AS directory,
          ${SessionTable.time_created} AS created,
          ${SessionTable.time_updated} AS updated
        FROM ${SessionTable}
        WHERE ${SessionTable.kind} = 'mission'
          AND ${SessionTable.time_archived} IS NULL
          AND json_extract(${SessionTable.metadata}, '$.mission.id') IS NOT NULL
          AND (${directory ?? null} IS NULL OR ${SessionTable.directory} = ${directory ?? null})
          AND (
            ${search ?? null} IS NULL
            OR ${SessionTable.title} LIKE ${search ?? null}
            OR ${SessionTable.directory} LIKE ${search ?? null}
            OR json_extract(${SessionTable.metadata}, '$.mission.id') LIKE ${search ?? null}
            OR EXISTS (
              SELECT 1
              FROM ${EngineTaskTable} AS mission_task
              WHERE mission_task.project_id = ${SessionTable.project_id}
                AND mission_task.source = 'mission'
                AND json_extract(mission_task.metadata, '$.actor') = 'mission'
                AND json_extract(mission_task.metadata, '$.mission.id') = json_extract(${SessionTable.metadata}, '$.mission.id')
                AND json_extract(mission_task.metadata, '$.mission.session_id') = ${SessionTable.id}
                AND (
                  mission_task.title LIKE ${search ?? null}
                  OR mission_task.id LIKE ${search ?? null}
                )
            )
          )
        UNION ALL
        SELECT
          'chat' AS kind,
          ${SessionTable.id} AS id,
          ${SessionTable.id} AS sessionID,
          ${SessionTable.directory} AS directory,
          ${SessionTable.time_created} AS created,
          ${SessionTable.time_updated} AS updated
        FROM ${SessionTable}
        WHERE ${SessionTable.kind} = 'assistant'
          AND ${SessionTable.time_archived} IS NULL
          AND json_extract(${SessionTable.metadata}, '$.codingAssistant.surface') = 'right-sidebar'
          AND (${directory ?? null} IS NULL OR ${SessionTable.directory} = ${directory ?? null})
          AND (
            ${search ?? null} IS NULL
            OR ${SessionTable.title} LIKE ${search ?? null}
            OR ${SessionTable.id} LIKE ${search ?? null}
            OR ${SessionTable.directory} LIKE ${search ?? null}
          )
        UNION ALL
        SELECT
          'task' AS kind,
          ${EngineTaskTable.id} AS id,
          ${EngineTaskTable.session_id} AS sessionID,
          COALESCE(task_session.directory, ${ProjectTable.worktree}, '') AS directory,
          ${EngineTaskTable.time_created} AS created,
          ${EngineTaskTable.time_updated} AS updated
        FROM ${EngineTaskTable}
        LEFT JOIN ${SessionTable} AS task_session ON ${EngineTaskTable.session_id} = task_session.id
        LEFT JOIN ${ProjectTable} ON ${EngineTaskTable.project_id} = ${ProjectTable.id}
        WHERE NOT (
          /* Keep this predicate congruent with listMissionTasks/projectMissionTasks:
             only mountable Mission child tasks are removed from top-level Task rows. */
          ${EngineTaskTable.source} = 'mission'
          AND json_extract(${EngineTaskTable.metadata}, '$.actor') = 'mission'
          AND json_extract(${EngineTaskTable.metadata}, '$.mission.id') IS NOT NULL
          AND json_extract(${EngineTaskTable.metadata}, '$.mission.session_id') IS NOT NULL
        )
          AND (${directory ?? null} IS NULL OR COALESCE(task_session.directory, ${ProjectTable.worktree}, '') = ${directory ?? null})
          AND (
            ${search ?? null} IS NULL
            OR ${EngineTaskTable.title} LIKE ${search ?? null}
            OR ${EngineTaskTable.id} LIKE ${search ?? null}
            OR COALESCE(task_session.directory, ${ProjectTable.worktree}, '') LIKE ${search ?? null}
          )
      )
      SELECT
        kind,
        id,
        sessionID,
        directory,
        updated,
        kind || ':' || id AS rowKey
      FROM top_rows
      WHERE (
        ${input.cursorUpdated ?? null} IS NULL
        OR updated < ${input.cursorUpdated ?? null}
        OR (updated = ${input.cursorUpdated ?? null} AND (kind || ':' || id) < ${input.cursorRowKey ?? null})
      )
      ORDER BY updated DESC, rowKey DESC
      LIMIT ${limit}
    `),
  )
}

async function workLedgerRowFromCandidate(candidate: WorkLedgerTopRowCandidate) {
  if (candidate.kind === "mission") return workLedgerMissionFromCandidate(candidate)
  if (candidate.kind === "chat") return workLedgerChatFromCandidate(candidate)
  return workLedgerTaskFromTaskID(candidate.id)
}

export async function listWorkLedger(input: WorkLedgerListInput = {}): Promise<WorkLedgerListValue> {
  const limit = input.limit ?? 50
  const candidates = topRowCandidates({ ...input, limit })
  const visibleCandidates = candidates.slice(0, limit)
  const rows: WorkLedgerRowValue[] = []
  for (const candidate of visibleCandidates) {
    rows.push(await workLedgerRowFromCandidate(candidate))
  }
  const last = rows.at(-1)
  return WorkLedgerList.parse({
    rows,
    nextCursor:
      candidates.length > limit && last
        ? {
            updated: last.updated,
            rowKey: rowKey(last),
          }
        : null,
  })
}
