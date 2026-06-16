import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { randomBytes } from "node:crypto"
import { Instance } from "@/project/instance"
import {
  ensureMissionSession,
  findExistingMissionSession,
  getMissionSession,
  getMissionSessionByDirectory,
  listGlobalMissionSessions,
} from "@/mission/session"
import { MissionID } from "@/mission/schema"
import { listMissionTasks, listTaskRows } from "@/engine/store"
import { deriveTaskStatus } from "@/engine/task-status"
import { PromptProfile } from "@/agent/prompt-profile"
import {
  MissionStatusSnapshot,
  StatusSnapshotState,
  missionStatusSnapshot,
  statusFromTaskLifecycle,
  taskStatusDetailFromBoard,
} from "@/status/task-status-snapshot"
import { compileBoard } from "@/workbench/board"
import { Session, SessionStatus } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionWake } from "@/session/wake"
import { Provider } from "@/provider/provider"
import { isModelReference } from "@/provider/model-ref"
import { Config } from "@/config/config"

function newMissionID(): string {
  return randomBytes(8).toString("hex")
}

const MissionWakeInput = z.object({
  missionID: MissionID.optional(),
  text: z.string().min(1).max(32_000),
  title: z.string().min(1).max(120).optional(),
  model: z
    .string()
    .refine(isModelReference, {
      message: 'Model must be in the format "provider/model".',
    })
    .optional(),
  promptProfile: z.string().min(1).optional(),
})

const MissionWakeResult = z.object({
  missionID: MissionID,
  sessionID: z.string(),
  created: z.boolean(),
})

const MissionTaskStatus = z.enum(["queued", "active", "completed", "failed", "cancelled"])

const MissionTaskProjection = z.object({
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

const MissionTaskStats = z.object({
  total: z.number(),
  queued: z.number(),
  active: z.number(),
  completed: z.number(),
  failed: z.number(),
  cancelled: z.number(),
})

const MissionRecord = z.object({
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

const MissionListQuery = z
  .object({
    directory: z.string().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursorUpdated: z.coerce.number().optional(),
    cursorSessionID: z.string().optional(),
    archived: z.coerce.boolean().optional(),
  })
  .refine((query) => (query.cursorUpdated === undefined) === (query.cursorSessionID === undefined), {
    message: "cursorUpdated and cursorSessionID must be provided together",
    path: ["cursorUpdated"],
  })

const MissionParam = z.object({
  missionID: MissionID,
})

const MissionTitleInput = z.object({
  title: z.string().trim().min(1).max(200),
})

type MissionSessionRecord = Awaited<ReturnType<typeof getMissionSession>>
type MissionTaskProjectionValue = z.infer<typeof MissionTaskProjection>

function missionRouteSession(missionID: string): Promise<MissionSessionRecord> {
  return getMissionSessionByDirectory({ missionID, directory: Instance.directory })
}

function missionTaskStats(tasks: MissionTaskProjectionValue[]): z.infer<typeof MissionTaskStats> {
  return tasks.reduce(
    (stats, task) => {
      stats.total += 1
      stats[task.status] += 1
      return stats
    },
    { total: 0, queued: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
  )
}

function projectMissionTasks(session: MissionSessionRecord): MissionTaskProjectionValue[] {
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

function missionRecord(session: MissionSessionRecord): z.infer<typeof MissionRecord> {
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

function missionStatusRecord(session: MissionSessionRecord): z.infer<typeof MissionStatusSnapshot> {
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

export function MissionRoutes() {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List Missions",
        description:
          "List Mission records across project directories. Each record is backed by " +
          'exactly one kind="mission" session and can be opened through the session ' +
          "conversation/event routes.",
        operationId: "mission.list",
        responses: {
          200: {
            description: "Mission records",
            content: { "application/json": { schema: resolver(MissionRecord.array()) } },
          },
        },
      }),
      validator("query", MissionListQuery),
      async (c) => {
        const query = c.req.valid("query")
        const records: z.infer<typeof MissionRecord>[] = []
        for await (const session of listGlobalMissionSessions({
          directory: query.directory,
          search: query.search,
          limit: query.limit,
          cursorUpdated: query.cursorUpdated,
          cursorSessionID: query.cursorSessionID,
          archived: query.archived,
        })) {
          records.push(missionRecord(session))
        }
        return c.json(records)
      },
    )
    .get(
      "/:missionID/status",
      describeRoute({
        summary: "Get Mission status",
        description:
          "Collect the current Mission status from its tasks and each task's workflow/goal progress. " +
          'The top-level and nested detail `status` fields are normalized to "success", "failed", or "running"; ' +
          "raw lifecycle states remain available as lifecycleStatus/rawStatus fields.",
        operationId: "mission.status",
        responses: {
          200: {
            description: "Mission status snapshot",
            content: { "application/json": { schema: resolver(MissionStatusSnapshot) } },
          },
        },
      }),
      validator("param", MissionParam),
      async (c) => {
        const session = await missionRouteSession(c.req.valid("param").missionID)
        return c.json(missionStatusRecord(session))
      },
    )
    .patch(
      "/:missionID/title",
      describeRoute({
        summary: "Rename a Mission",
        description: "Rename the Mission session title. The Mission record remains backed by the same mission session.",
        operationId: "mission.rename",
        responses: {
          200: {
            description: "Renamed Mission record",
            content: { "application/json": { schema: resolver(MissionRecord) } },
          },
        },
      }),
      validator("param", MissionParam),
      validator("json", MissionTitleInput),
      async (c) => {
        const missionID = c.req.valid("param").missionID
        const session = await missionRouteSession(missionID)
        const updated = await Session.setTitle({ sessionID: session.id, title: c.req.valid("json").title })
        return c.json(missionRecord({ ...updated, missionID }))
      },
    )
    .post(
      "/:missionID/abort",
      describeRoute({
        summary: "Abort a Mission",
        description: "Abort the active Mission session loop for this Mission.",
        operationId: "mission.abort",
        responses: {
          200: {
            description: "Mission abort accepted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("param", MissionParam),
      async (c) => {
        const session = await missionRouteSession(c.req.valid("param").missionID)
        SessionPrompt.cancel(session.id, session.directory)
        return c.json(true)
      },
    )
    .delete(
      "/:missionID",
      describeRoute({
        summary: "Delete a Mission",
        description: "Delete the Mission session and its conversation history.",
        operationId: "mission.delete",
        responses: {
          200: {
            description: "Mission deleted",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("param", MissionParam),
      async (c) => {
        const session = await missionRouteSession(c.req.valid("param").missionID)
        await Session.removeInProject({ sessionID: session.id, projectID: session.projectID })
        return c.json(true)
      },
    )
    .post(
      "/wake",
      describeRoute({
        summary: "Wake the Mission agent",
        description:
          "Start (or resume) a Mission agent session and inject a user prompt. " +
          "Omit `missionID` to start a new mission; supply it to resume an existing one. " +
          "The route is idempotent for (project, missionID) — exactly one mission " +
          "session is keyed per mission.",
        operationId: "mission.wake",
        responses: {
          200: {
            description: "Mission wake accepted",
            content: { "application/json": { schema: resolver(MissionWakeResult) } },
          },
        },
      }),
      validator("json", MissionWakeInput),
      async (c) => {
        const input = c.req.valid("json")
        if (input.promptProfile) {
          try {
            PromptProfile.assertKnownProfileID(input.promptProfile, await Config.get())
          } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
          }
        }
        const missionID = input.missionID ?? newMissionID()
        // Snapshot existence BEFORE ensureMissionSession so the response
        // distinguishes "started" from "resumed". The lookup and the ensure
        // call both go through the same in-process lock on missionID, so they
        // observe the same state for any single wake call.
        const existing = findExistingMissionSession(missionID)
        const session = await ensureMissionSession({
          missionID,
          defaultCwd: Instance.directory,
        })
        if (input.promptProfile) {
          await Session.mergeConfigOverlay({
            sessionID: session.id,
            patch: { prompt_profile: { active: input.promptProfile } },
          })
        }
        await SessionWake.wake({
          sessionID: session.id,
          prompt: input.text,
          agent: "mission",
          model: input.model ? Provider.parseModel(input.model) : undefined,
          reason: {
            source: "mission.operator",
            missionID,
          },
        })
        return c.json(
          MissionWakeResult.parse({
            missionID,
            sessionID: session.id,
            created: !existing,
          }),
        )
      },
    )
}
