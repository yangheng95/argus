import z from "zod"
import { deriveTaskStatus } from "@/engine/task-status"
import { listMissionTasks, listTaskRows, type TaskRow } from "@/engine/store"
import {
  MissionStatusSnapshot,
  StatusSnapshotState,
  missionStatusSnapshot,
  statusFromTaskLifecycle,
  taskStatusDetailFromBoard,
} from "@/status/task-status-snapshot"
import { compileBoard } from "@/workbench/board"
import { SessionStatus } from "@/session"
import { MissionID } from "./schema"
import type { MissionSession } from "./session"

export const MissionTaskStatus = z.enum(["queued", "active", "completed", "failed", "cancelled"])

export const MissionTaskProjection = z.object({
  id: z.string(),
  title: z.string(),
  status: MissionTaskStatus,
  executionStatus: StatusSnapshotState,
  priority: z.enum(["critical", "high", "normal", "low"]),
  source: z.string(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  started: z.number().optional(),
  completed: z.number().optional(),
})

export const MissionTaskStats = z.object({
  total: z.number(),
  queued: z.number(),
  active: z.number(),
  completed: z.number(),
  failed: z.number(),
  cancelled: z.number(),
})

export const MissionRecord = z.object({
  missionID: MissionID,
  sessionID: z.string(),
  title: z.string(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  archived: z.number().optional(),
  interruptible: z.boolean(),
  tasks: MissionTaskProjection.array(),
  taskStats: MissionTaskStats,
})

export type MissionTaskProjectionValue = z.infer<typeof MissionTaskProjection>
export type MissionTaskStatsValue = z.infer<typeof MissionTaskStats>
export type MissionRecordValue = z.infer<typeof MissionRecord>

export function missionTaskBinding(
  task: Pick<TaskRow, "source" | "metadata">,
): { missionID: string; missionSessionID: string } | undefined {
  if (task.source !== "mission") return undefined
  const metadata = task.metadata
  if (!metadata || typeof metadata !== "object") return undefined
  if ((metadata as Record<string, unknown>).actor !== "mission") return undefined
  const mission = (metadata as Record<string, unknown>).mission
  if (!mission || typeof mission !== "object") return undefined
  const missionID = (mission as Record<string, unknown>).id
  const missionSessionID = (mission as Record<string, unknown>).session_id
  if (typeof missionID !== "string" || typeof missionSessionID !== "string") return undefined
  return { missionID, missionSessionID }
}

export function missionTaskStats(tasks: MissionTaskProjectionValue[]): MissionTaskStatsValue {
  return tasks.reduce(
    (stats, task) => {
      stats.total += 1
      stats[task.status] += 1
      return stats
    },
    { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
  )
}

export function projectMissionTasks(session: MissionSession): MissionTaskProjectionValue[] {
  return listTaskRows(
    listMissionTasks({ projectID: session.projectID, missionID: session.missionID, sessionID: session.id }),
  ).map(({ task, directory }) => {
    const lifecycleStatus = deriveTaskStatus(task)
    return MissionTaskProjection.parse({
      id: task.id,
      title: task.title,
      status: lifecycleStatus,
      executionStatus: statusFromTaskLifecycle(lifecycleStatus),
      priority: task.priority,
      source: task.source,
      directory,
      created: task.time_created,
      updated: task.time_updated,
      started: task.time_started ?? undefined,
      completed: task.time_completed ?? undefined,
    })
  })
}

export function missionRecord(session: MissionSession): MissionRecordValue {
  const tasks = projectMissionTasks(session)
  const status = SessionStatus.get(session.id)
  return MissionRecord.parse({
    missionID: session.missionID,
    sessionID: session.id,
    title: session.title,
    directory: session.directory,
    created: session.time.created,
    updated: session.time.updated,
    archived: session.time.archived,
    interruptible: status.type === "streaming" || status.type === "retry",
    tasks,
    taskStats: missionTaskStats(tasks),
  })
}

export function missionStatusRecord(session: MissionSession): z.infer<typeof MissionStatusSnapshot> {
  const tasks = listTaskRows(
    listMissionTasks({ projectID: session.projectID, missionID: session.missionID, sessionID: session.id }),
  ).map(({ task }) => taskStatusDetailFromBoard(compileBoard({ taskID: task.id })))
  return missionStatusSnapshot({
    missionID: session.missionID,
    sessionID: session.id,
    title: session.title,
    directory: session.directory,
    tasks,
  })
}
