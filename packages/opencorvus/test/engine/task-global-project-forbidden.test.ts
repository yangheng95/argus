import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  EngineChannelBindingTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
  EngineProgressSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { persistQueuedTask } from "../../src/engine/pipeline"
import {
  TaskChannelBindingProjectConflictError,
  TaskGlobalProjectBindingError,
} from "../../src/engine/task-project-error"
import { Identifier } from "../../src/id/id"
import * as TaskLoop from "../../src/orchestrator/loop"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { ProjectTable } from "../../src/project/project.sql"
import { Session } from "../../src/session"
import { MessageTable, SessionTable } from "../../src/session/session.sql"
import { Database, eq, NotFoundError } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const INSTANCE_STARTUP_TIMEOUT_MS = 60_000

describe("task global project binding is forbidden", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("persistQueuedTask refuses project global before inserting a task row", () => {
    const taskID = Identifier.ascending("task")

    expect(() =>
      persistQueuedTask({
        taskID,
        sessionID: Identifier.ascending("session"),
        now: Date.now(),
        executor: "opencorvus",
        title: "bad task",
        request: "must not persist",
        metadata: {},
        projectID: "global",
        queue: true,
      }),
    ).toThrow(TaskGlobalProjectBindingError)

    const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(row).toBeUndefined()
  })

  test("non-git Instance.provide no longer creates a global active project", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Instance.project.id).toBe(Project.directoryProjectID(tmp.path))
        expect(Instance.project.id).not.toBe("global")

        await expect(
          EngineService.createTask({
            request: "must not create root session",
            source: "test",
          }),
        ).rejects.toThrow("not a git repository")

        const sessions = Database.use((db) =>
          db.select().from(SessionTable).where(eq(SessionTable.title, "must not create root session")).all(),
        )
        expect(sessions).toHaveLength(0)
      },
    })
  })

  test(
    "handleTaskMessage refuses legacy global task before appending attachments or messages",
    async () => {
      const legacy = await seedLegacyGlobalTask()

      await Instance.provide({
        directory: legacy.directory,
        fn: async () => {
          expect(Instance.project.id).not.toBe("global")
          await expect(
            EngineService.handleTaskMessage(legacy.taskID, {
              text: "retry",
              source: "test",
              attachments: [
                {
                  data: Buffer.from("must not be written").toString("base64"),
                  mime: "image/png",
                  filename: "blocked.png",
                },
              ],
            }),
          ).rejects.toThrow(TaskGlobalProjectBindingError)
        },
      })

      const task = Database.use((db) =>
        db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, legacy.taskID)).get(),
      )
      expect(task?.project_id).toBe("global")
      expect(task?.attachments ?? null).toBeNull()
      expect(messageCount(legacy.sessionID)).toBe(0)
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "injectMessage refuses legacy global task before appending a session message",
    async () => {
      const legacy = await seedLegacyGlobalTask()

      await Instance.provide({
        directory: legacy.directory,
        fn: async () => {
          expect(Instance.project.id).not.toBe("global")
          await expect(EngineService.injectMessage(legacy.taskID, "retry")).rejects.toThrow(
            TaskGlobalProjectBindingError,
          )
        },
      })

      expect(messageCount(legacy.sessionID)).toBe(0)
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "retryTask refuses a legacy global task before dispatching",
    async () => {
      const legacy = await seedLegacyGlobalTask()
      const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

      await Instance.provide({
        directory: legacy.directory,
        fn: async () => {
          expect(Instance.project.id).not.toBe("global")
          await expect(EngineService.retryTask(legacy.taskID)).rejects.toThrow(TaskGlobalProjectBindingError)
        },
      })

      expect(runTaskLoop).not.toHaveBeenCalled()
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "recordOperatorNote refuses a legacy global task before writing progress",
    async () => {
      const legacy = await seedLegacyGlobalTask()
      const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

      await Instance.provide({
        directory: legacy.directory,
        fn: async () => {
          expect(Instance.project.id).not.toBe("global")
          await expect(EngineService.recordOperatorNote(legacy.taskID, "continue")).rejects.toThrow(
            TaskGlobalProjectBindingError,
          )
        },
      })

      expect(progressCount(legacy.taskID)).toBe(0)
      expect(runTaskLoop).not.toHaveBeenCalled()
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "public task mutations refuse a legacy global task",
    async () => {
      const legacy = await seedLegacyGlobalTask()

      await Instance.provide({
        directory: legacy.directory,
        fn: async () => {
          await expect(EngineService.updateTaskTitle(legacy.taskID, "renamed")).rejects.toThrow(
            TaskGlobalProjectBindingError,
          )
          await expect(EngineService.updateTaskBudget(legacy.taskID, null)).rejects.toThrow(
            TaskGlobalProjectBindingError,
          )
          await expect(EngineService.cancelTask(legacy.taskID)).rejects.toThrow(TaskGlobalProjectBindingError)
          await expect(EngineService.deleteTask(legacy.taskID)).rejects.toThrow(TaskGlobalProjectBindingError)
        },
      })

      const task = Database.use((db) =>
        db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, legacy.taskID)).get(),
      )
      expect(task?.title).toBe("legacy global task")
      expect(task?.time_completed).toBeNull()
      expect(progressCount(legacy.taskID)).toBe(0)
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "direct task file registration refuses a legacy global task before URL fallback",
    async () => {
      const legacy = await seedLegacyGlobalTask()

      await Instance.provide({
        directory: legacy.directory,
        fn: async () => {
          await expect(
            EngineService.appendTaskSystemArtifact(legacy.taskID, {
              sha: "sha_global_system",
              url: "/not-an-attachment-url",
              mime: "text/plain",
              size: 1,
            }),
          ).rejects.toThrow(TaskGlobalProjectBindingError)
          await expect(
            EngineService.appendTaskAttachment(legacy.taskID, {
              sha: "sha_global_attachment",
              url: "/not-an-attachment-url",
              mime: "text/plain",
              size: 1,
            }),
          ).rejects.toThrow(TaskGlobalProjectBindingError)
        },
      })
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "channel binding preflight refuses a binding that points to a legacy global task",
    async () => {
      const binding = {
        platform: "slack",
        channel: "C_global",
        thread: "T_global",
      }
      await seedLegacyGlobalTask({ binding })
      await using real = await tmpdir({ git: true, config: { model: "project/default" } })
      const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

      await Instance.provide({
        directory: real.path,
        fn: async () => {
          await expect(
            EngineService.createTask({
              request: "must not recover global binding",
              source: "test",
              channelBinding: binding,
            }),
          ).rejects.toThrow(TaskGlobalProjectBindingError)
        },
      })

      expect(runTaskLoop).not.toHaveBeenCalled()
      const sessions = Database.use((db) =>
        db.select().from(SessionTable).where(eq(SessionTable.title, "must not recover global binding")).all(),
      )
      expect(sessions).toHaveLength(0)
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "channel binding preflight refuses another concrete project before creating a root session",
    async () => {
      const binding = {
        platform: "slack",
        channel: "C_cross_project",
        thread: "T_cross_project",
      }
      await using first = await tmpdir({ git: true, config: { model: "project/default" } })
      await using second = await tmpdir({ git: true, config: { model: "project/default" } })
      const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

      await Instance.provide({
        directory: first.path,
        fn: async () => {
          const session = await Session.create({ kind: "root", title: "first binding owner" })
          const taskID = Identifier.ascending("task")
          const now = Date.now()
          Database.use((db) => {
            db.insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                session_id: session.id,
                source: "test",
                title: "first binding owner",
                request: "first project owns binding",
                executor: "opencorvus",
                priority: "normal",
                kind: "workflow",
                queue_order: 0,
                time_started: now,
                time_created: now,
                time_updated: now,
              })
              .run()
            db.insert(EngineChannelBindingTable)
              .values({
                id: Identifier.ascending("binding"),
                task_id: taskID,
                platform: binding.platform,
                channel: binding.channel,
                thread: binding.thread,
                payload: {},
                time_created: now,
                time_updated: now,
              })
              .run()
          })
        },
      })

      await Instance.provide({
        directory: second.path,
        fn: async () => {
          await expect(
            EngineService.createTask({
              request: "second project must not create session",
              title: "must not create cross project binding session",
              source: "test",
              channelBinding: binding,
            }),
          ).rejects.toThrow(TaskChannelBindingProjectConflictError)
        },
      })

      expect(runTaskLoop).not.toHaveBeenCalled()
      const sessions = Database.use((db) =>
        db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.title, "must not create cross project binding session"))
          .all(),
      )
      expect(sessions).toHaveLength(0)
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "task, goal, and interaction entrypoints hide concrete foreign project rows",
    async () => {
      await using first = await tmpdir({ git: true, config: { model: "project/default" } })
      await using second = await tmpdir({ git: true, config: { model: "project/default" } })
      const permissionReply = spyOn(PermissionNext, "reply").mockResolvedValue({
        id: "permission_foreign",
        sessionID: "session_foreign",
        permission: "bash",
        patterns: [],
        metadata: {},
        time: { created: Date.now() },
        title: "foreign permission",
      } as never)

      let taskID = ""
      let goalID = ""
      let interactionID = ""

      await Instance.provide({
        directory: first.path,
        fn: async () => {
          const session = await Session.create({ kind: "root", title: "foreign concrete task" })
          const now = Date.now()
          taskID = Identifier.ascending("task")
          goalID = Identifier.ascending("goal")
          interactionID = Identifier.ascending("interaction")
          Database.use((db) => {
            db.insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                session_id: session.id,
                source: "test",
                title: "foreign concrete task",
                request: "first project owns this task",
                executor: "opencorvus",
                priority: "normal",
                kind: "workflow",
                queue_order: 0,
                time_started: now,
                time_created: now,
                time_updated: now,
              })
              .run()
            db.insert(EngineGoalTable)
              .values({
                id: goalID,
                task_id: taskID,
                title: "foreign goal",
                slug: "foreign-goal",
                objective: "first project owns this goal",
                acceptance_specs: [],
                owned_paths: [],
                depends_on: [],
                kind: "feature",
                requirement_ids: [],
                priority: "blocking",
                source: "test",
                order_index: 0,
                time_created: now,
                time_updated: now,
              })
              .run()
            db.insert(EngineInteractionRequestTable)
              .values({
                id: interactionID,
                task_id: taskID,
                external_id: "permission_foreign",
                request_type: "permission",
                status: "pending",
                title: "foreign permission",
                body: "first project owns this permission",
                payload: {},
                time_created: now,
                time_updated: now,
              })
              .run()
          })
        },
      })

      await Instance.provide({
        directory: second.path,
        fn: async () => {
          await expect(EngineService.getTask(taskID)).rejects.toThrow(NotFoundError)
          await expect(EngineService.getProgress(taskID)).rejects.toThrow(NotFoundError)
          await expect(EngineService.updateTaskTitle(taskID, "cross-project rename")).rejects.toThrow(NotFoundError)
          await expect(EngineService.updateTaskBudget(taskID, null)).rejects.toThrow(NotFoundError)
          await expect(
            EngineService.updateGoal(goalID, {
              description: "cross-project goal update",
              acceptance_specs: [acceptanceSpec(goalID)],
            }),
          ).rejects.toThrow(NotFoundError)
          await expect(EngineService.deleteGoal(goalID)).rejects.toThrow(NotFoundError)
          await expect(
            EngineService.replyInteraction(interactionID, { reply: "once", autoReply: false, message: "approve" }),
          ).rejects.toThrow(NotFoundError)
          await expect(
            EngineService.rejectInteraction(interactionID, { autoReply: false, message: "reject" }),
          ).rejects.toThrow(NotFoundError)
        },
      })

      expect(permissionReply).not.toHaveBeenCalled()
      const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
      expect(task?.title).toBe("foreign concrete task")
      expect(task?.budget ?? null).toBeNull()
      const goal = Database.use((db) => db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goalID)).get())
      expect(goal?.title).toBe("foreign goal")
      const interaction = Database.use((db) =>
        db
          .select()
          .from(EngineInteractionRequestTable)
          .where(eq(EngineInteractionRequestTable.id, interactionID))
          .get(),
      )
      expect(interaction?.status).toBe("pending")
      expect(interaction?.response ?? null).toBeNull()
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )
})

function acceptanceSpec(goalID: string) {
  return {
    id: `acc_${goalID}`,
    source_requirement_id: "REQ-foreign-project",
    goal_id: goalID,
    title: "foreign project update must not apply",
    scorers: [
      {
        type: "heuristic" as const,
        name: "no-op",
        spec: { kind: "shell" as const, cmd: "true" },
      },
    ],
    severity: "essential" as const,
  }
}

async function seedLegacyGlobalTask(input?: {
  binding?: { platform: string; channel: string; thread: string }
}): Promise<{ directory: string; taskID: string; sessionID: string }> {
  await using tmp = await tmpdir()
  let taskID = ""
  let sessionID = ""

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(Instance.project.id).not.toBe("global")
      const session = await Session.create({ kind: "root", title: "legacy global task" })
      taskID = Identifier.ascending("task")
      sessionID = session.id
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(ProjectTable)
          .values({
            id: "global",
            worktree: "/legacy-global-project",
            sandboxes: [],
            time_created: now,
            time_updated: now,
          })
          .onConflictDoNothing()
          .run(),
      )
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: "global",
            session_id: session.id,
            source: "test",
            title: "legacy global task",
            request: "retry",
            executor: "opencorvus",
            priority: "normal",
            kind: "workflow",
            queue_order: 0,
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      if (input?.binding) {
        Database.use((db) =>
          db
            .insert(EngineChannelBindingTable)
            .values({
              id: Identifier.ascending("binding"),
              task_id: taskID,
              platform: input.binding.platform,
              channel: input.binding.channel,
              thread: input.binding.thread,
              payload: {},
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      }
    },
  })

  await $`git init`.cwd(tmp.path).quiet()
  return { directory: tmp.path, taskID, sessionID }
}

function messageCount(sessionID: string): number {
  return Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.session_id, sessionID)).all()).length
}

function progressCount(taskID: string): number {
  return Database.use((db) =>
    db.select().from(EngineProgressSnapshotTable).where(eq(EngineProgressSnapshotTable.task_id, taskID)).all(),
  ).length
}
