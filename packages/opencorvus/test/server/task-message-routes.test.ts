import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { WorkbenchTaskNoteTable } from "../../src/workbench/workbench.sql"
import { beginBuildAttempt } from "../../src/engine/persist"
import { findGoalRun } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import * as Queue from "../../src/engine/queue"
import * as TaskLoop from "../../src/orchestrator/loop"
import { Orchestrator } from "../../src/orchestrator/agent"
import {
  completeOrchestratorToolOwnership,
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Log } from "../../src/util/log"
import { ExecutorRegistry } from "../../src/executor/registry"
import type { ExecutorAdapter } from "../../src/executor/contract"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const routeTestConfig = { model: "test/model" } as const

async function seedRootSession(sessionID: string, text = "initial request") {
  const info = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user" as const,
    time: { created: Date.now() - 1_000 },
    agent: "orchestrator",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
    },
  }
  await Session.persistMessage({
    info,
    parts: [
      {
        id: Identifier.ascending("part"),
        messageID: info.id,
        sessionID,
        type: "text",
        text,
        kind: "user_content",
      },
    ],
    touchSessionID: sessionID,
  })
}

async function seedActiveAndCompletedSameCwdTasks() {
  const activeTaskID = Identifier.ascending("task")
  const completedTaskID = Identifier.ascending("task")
  const now = Date.now()
  const activeRoot = await Session.create({ kind: "root", title: "active same cwd" })
  const completedRoot = await Session.create({ kind: "root", title: "completed same cwd" })
  await seedRootSession(activeRoot.id)
  await seedRootSession(completedRoot.id)

  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: activeTaskID,
        project_id: Instance.project.id,
        session_id: activeRoot.id,
        source: "panel",
        title: "active same cwd",
        request: "active same cwd",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: completedTaskID,
        project_id: Instance.project.id,
        session_id: completedRoot.id,
        source: "panel",
        title: "completed same cwd",
        request: "completed same cwd",
        priority: "normal",
        time_created: now + 1,
        time_updated: now + 1,
        time_started: now + 1,
        time_completed: now + 2,
      })
      .run()
  })

  return { activeTaskID, completedTaskID }
}

async function seedLiveBuildOwner(input: {
  taskID: string
  rootSessionID: string
  suffix: string
  now: number
  orderIndex: number
}) {
  const goalID = Identifier.ascending("goal")
  const childSession = await Session.createNext({
    kind: "build",
    parentID: input.rootSessionID,
    goalID,
    title: `live build ${input.suffix}`,
    directory: Instance.directory,
  })
  Database.use((db) =>
    db
      .insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: input.taskID,
        title: `Live build goal ${input.suffix}`,
        slug: `live-build-goal-${input.suffix}`,
        objective: `Keep live build goal ${input.suffix} running while the task is messaged.`,
        acceptance_specs: [],
        owned_paths: [],
        depends_on: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "test",
        order_index: input.orderIndex,
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
  const goalRunID = beginBuildAttempt({
    taskID: input.taskID,
    goalID,
    sessionID: childSession.id,
    now: input.now,
  })
  const ownershipPayload = createOrchestratorToolOwnershipPayload({
    taskID: input.taskID,
    orchestratorSessionID: `ses_orchestrator_${input.suffix}_${input.now}`,
    orchestratorMessageID: `msg_orchestrator_${input.suffix}_${input.now}`,
    toolCallID: `cal_build_${input.suffix}_${input.now}`,
    toolPartID: `prt_build_${input.suffix}_${input.now}`,
    childSessionID: childSession.id,
    scope: "goal",
    goalID,
    goalRunID,
    now: input.now,
  })
  insertOrchestratorToolOwnershipArtifact({
    taskID: input.taskID,
    goalRunID,
    label: "tool-ownership-start",
    payload: ownershipPayload,
    now: input.now,
  })
  return { goalID, goalRunID, sessionID: childSession.id, ownershipID: ownershipPayload.ownership_id }
}

describe("task message routes", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("GET /task/:taskID/operator-model-context mirrors task message agent model resolution", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "test/base",
        agent: {
          orchestrator: {
            model: "test/orchestrator",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "model context" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "model context",
              request: "model context",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/operator-model-context`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          taskID: string
          sessionID: string
          agent: string
          model: {
            providerID: string
            modelID: string
          }
        }
        expect(body).toEqual({
          taskID,
          sessionID: root.id,
          agent: "orchestrator",
          model: {
            providerID: "test",
            modelID: "orchestrator",
          },
        })
      },
    })
  })

  test("GET /task/:taskID/operator-model-context uses orchestrator for empty task root sessions", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "test/base",
        agent: {
          orchestrator: {
            model: "test/orchestrator",
          },
          coding: {
            model: "test/coding",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "empty model context" })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "empty model context",
              request: "empty model context",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/operator-model-context`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
          taskID,
          sessionID: root.id,
          agent: "orchestrator",
          model: {
            providerID: "test",
            modelID: "orchestrator",
          },
        })
      },
    })
  })

  test("POST /task/:taskID/message triggers scheduler with natural language", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "retry through message" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "retry through message",
              request: "retry through message",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const target = {
          kind: "build_session" as const,
          sessionID: "ses_build_route_target",
          goalID: "goal_route_target",
        }
        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "把当前任务停下来，重新评估策略后继续。",
            source: "panel",
            target,
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          kind: string
          message: string
          should_resume: boolean
          user_message?: {
            info: { id: string; sessionID: string; extra?: Record<string, unknown> }
            parts: Array<{ type: string; text?: string }>
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Task wake dispatched.")
        expect(body.should_resume).toBe(true)
        expect(body.user_message?.info.sessionID).toBe(root.id)
        expect(body.user_message?.info.extra).toEqual({
          operator_message: {
            source: "panel",
            target,
          },
        })
        expect(body.user_message?.parts).toHaveLength(1)
        expect(body.user_message?.parts[0]).toMatchObject({
          type: "text",
          text: "把当前任务停下来，重新评估策略后继续。",
        })
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        // V35: dispatchTaskLoop trigger schema changed from
        //   trigger: { kind, message, attachmentSummary }
        // to
        //   event: { note, operatorMessage: { text, attachmentSummary } }
        // Reflect the new shape.
        expect(dispatchTaskLoop.mock.calls[0]?.[0]).toMatchObject({
          taskID,
          event: {
            note: "把当前任务停下来，重新评估策略后继续。",
            operatorMessage: {
              text: "把当前任务停下来，重新评估策略后继续。",
              attachmentSummary: undefined,
              source: "panel",
              target,
              messageID: body.user_message?.info.id,
            },
          },
        })
        expect(dispatchTaskLoop.mock.calls[0]?.[0]).not.toHaveProperty("interrupt")

        // V35: row state is no longer "failed" (we seeded an active
        // task) — assertion on "row stays failed" is dropped.
        const row = Database.use((db) =>
          db
            .select({
              time_completed: EngineTaskTable.time_completed,
              error: EngineTaskTable.error,
            })
            .from(EngineTaskTable)
            .where(eq(EngineTaskTable.id, taskID))
            .get(),
        )
        expect(row?.error).toBeNull()
        const persisted = await Session.messages({ sessionID: root.id })
        expect(persisted).toHaveLength(2)
        const latest = persisted[persisted.length - 1]
        expect(latest?.parts).toHaveLength(1)
        expect(latest?.parts[0]).toMatchObject({
          type: "text",
          text: "把当前任务停下来，重新评估策略后继续。",
        })
        expect(latest?.info.extra).toEqual({
          operator_message: {
            source: "panel",
            target,
          },
        })
        const workbenchNotes = Database.use((db) =>
          db.select().from(WorkbenchTaskNoteTable).where(eq(WorkbenchTaskNoteTable.task_id, taskID)).all(),
        )
        expect(workbenchNotes).toEqual([])
      },
    })
  })

  test("POST /task/:taskID/message applies selected prompt profile before waking scheduler", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "profile message" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "profile message",
              request: "profile message",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续，但切换前端自动化 debug 专家团。",
            source: "panel",
            promptProfile: "frontend-automation-debug",
          }),
        })

        expect(response.status).toBe(200)
        expect((await Session.get(root.id)).metadata?.configOverlay).toMatchObject({
          prompt_profile: { active: "frontend-automation-debug" },
        })
      },
    })
  })

  test("POST /task/:taskID/message persists orchestrator agent on empty task root sessions", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "test/base",
        agent: {
          orchestrator: {
            model: "test/orchestrator",
          },
          coding: {
            model: "test/coding",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "empty task message" })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "empty task message",
              request: "empty task message",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续推进当前任务。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const messages = await Session.messages({ sessionID: root.id })
        expect(messages).toHaveLength(1)
        expect(messages[0]?.info).toMatchObject({
          role: "user",
          agent: "orchestrator",
          model: {
            providerID: "test",
            modelID: "orchestrator",
          },
        })
      },
    })
  })

  test("POST /task/:taskID/message reopens a failed task and wakes the orchestrator", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const completedAt = now + 1
        const root = await Session.create({ kind: "root", title: "failed task" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "failed task",
              request: "failed task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: completedAt,
              error: "previous failure",
              metadata: { decision_log: ["keep-me"] },
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续，不要清空上下文。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toBeDefined()
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect(row?.time_completed).toBeNull()
        expect(row?.error).toBeNull()
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })

  test("POST /task/:taskID/message accepts bridge envelope fields from resume clients", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "resume envelope" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "resume envelope",
              request: "resume envelope",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now + 1,
              error: "task cancelled",
              metadata: { cancelled: true, decision_log: ["keep-me"] },
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续这个任务。",
            source: "panel",
            resolvedRole: "user",
            channel: "main",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        expect(await Session.messages({ sessionID: root.id })).toHaveLength(2)

        const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect(row?.time_completed).toBeNull()
        expect(row?.error).toBeNull()
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
        expect((row?.metadata as { cancelled?: boolean } | null)?.cancelled).toBeUndefined()
      },
    })
  })

  test("POST /task/:taskID/message accepts a cancelled task and requeues it with the operator message", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "cancelled task" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "cancelled task",
              request: "cancelled task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now + 1,
              error: "task cancelled",
              metadata: { cancelled: true, decision_log: ["keep-me"] },
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续这个任务。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        expect(await Session.messages({ sessionID: root.id })).toHaveLength(2)

        const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect(row?.time_completed).toBeNull()
        expect(row?.error).toBeNull()
        expect((row?.metadata as { cancelled?: boolean; decision_log?: string[] } | null)?.cancelled).toBeUndefined()
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })

  test("cancelled continuation uses a new orchestrator session when the prior one is terminal", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        model: "isolated/model",
        provider: {
          isolated: {
            name: "Isolated Provider",
            npm: "@ai-sdk/openai-compatible",
            api: "https://example.invalid/v1",
            env: [],
            models: {
              model: {
                id: "model",
                name: "Isolated Model",
                release_date: "2026-05-27",
                attachment: false,
                reasoning: false,
                tool_call: true,
                cost: {
                  input: 1,
                  output: 1,
                },
                limit: {
                  context: 1024,
                  output: 1024,
                },
              },
            },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "terminal orchestrator continuation" })
        await seedRootSession(root.id)
        const oldOrchestrator = await Session.createNext({
          kind: "orchestrator",
          parentID: root.id,
          title: "old orchestrator",
          directory: tmp.path,
        })
        SessionStatus.set(oldOrchestrator.id, { type: "terminal", reason: "aborted" })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "terminal orchestrator continuation",
              request: "terminal orchestrator continuation",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue({
          info: {
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID: "placeholder",
            time: { created: now },
            agent: "orchestrator",
            providerID: "hexin",
            modelID: "gpt-5.5",
          },
          parts: [
            {
              id: Identifier.ascending("part"),
              messageID: Identifier.ascending("message"),
              sessionID: "placeholder",
              type: "text",
              text: "done",
              time: { start: now, end: now },
            },
          ],
        } as any)

        await Orchestrator.processTask(taskID, {
          note: "operator continuation",
          operatorMessage: {
            text: "继续这个任务。",
            source: "panel",
            messageID: Identifier.ascending("message"),
          },
        })

        expect(prompt).toHaveBeenCalledTimes(1)
        const promptInput = prompt.mock.calls[0]?.[0] as { sessionID?: string } | undefined
        expect(promptInput?.sessionID).toBeDefined()
        expect(promptInput?.sessionID).not.toBe(oldOrchestrator.id)
        const children = await Session.children(root.id)
        expect(children.filter((session) => session.kind === "orchestrator")).toHaveLength(2)
      },
    })
  })

  test("POST /task/:taskID/message rejects empty text without attachments before creating a message card", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "empty input task" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "empty input task",
              request: "empty input task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "   ",
            source: "panel",
          }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string; data: { taskID: string; message: string } }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.name).toBe("TaskEmptyMessageError")
        expect(body.data.taskID).toBe(taskID)
        expect(body.data.message).toContain("empty task-level message")
        expect(dispatchTaskLoop).not.toHaveBeenCalled()
        expect(await Session.messages({ sessionID: root.id })).toHaveLength(1)
      },
    })
  })

  test("POST /task/:taskID/message rejects missing source before creating a message card", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "missing source input" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "missing source input",
              request: "missing source input",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "message without a structured source",
          }),
        })

        expect(response.status).toBe(400)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(dispatchTaskLoop).not.toHaveBeenCalled()
        expect(await Session.messages({ sessionID: root.id })).toHaveLength(1)
      },
    })
  })

  test("POST /task/:taskID/message queues a completed task and wakes the orchestrator", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "completed task" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "completed task",
              request: "completed task",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now + 1,
              metadata: { decision_log: ["keep-me"] },
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续完善这个已完成任务。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.should_resume).toBe(true)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        expect(dispatchTaskLoop.mock.calls[0]?.[0]?.event?.operatorMessage?.text).toBe("继续完善这个已完成任务。")

        const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row ? deriveTaskStatus(row) : undefined).toBe("queued")
        expect(row?.time_started).toBeNull()
        expect(row?.time_completed).toBeNull()
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })

  test("POST /task/:taskID/message queues a completed same-cwd task behind active work", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const { completedTaskID } = await seedActiveAndCompletedSameCwdTasks()

        const response = await app.request(`/task/${completedTaskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "继续完善这个已完成任务。",
            source: "panel",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; should_resume: boolean }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.should_resume).toBe(true)
        expect(runTaskLoop).not.toHaveBeenCalled()

        const completed = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, completedTaskID)).get(),
        )
        expect(completed ? deriveTaskStatus(completed) : undefined).toBe("queued")
        expect(Queue.directoryQueueSnapshot(tmp.path).queuedTaskIDs).toContain(completedTaskID)
      },
    })
  })

  test("POST /task/:taskID/inject queues a completed same-cwd task behind active work", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const { completedTaskID } = await seedActiveAndCompletedSameCwdTasks()

        const response = await app.request(`/task/${completedTaskID}/inject`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "继续完善这个已完成任务。",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          appended: boolean
          orchestratorWoken: boolean
          executorResumed: boolean
          status: string
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body).toEqual({
          appended: true,
          orchestratorWoken: true,
          executorResumed: false,
          status: "queued",
        })
        expect(runTaskLoop).not.toHaveBeenCalled()

        const completed = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, completedTaskID)).get(),
        )
        expect(completed ? deriveTaskStatus(completed) : undefined).toBe("queued")
        expect(Queue.directoryQueueSnapshot(tmp.path).queuedTaskIDs).toContain(completedTaskID)
      },
    })
  })

  test("POST /task/:taskID/message forwards attachment summary to scheduler", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "attachment message" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "attachment message",
              request: "attachment message",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "参考我刚上传的规格，再决定下一步。",
            source: "panel",
            attachments: [
              {
                mime: "text/plain",
                filename: "spec.txt",
                data: Buffer.from("hello spec").toString("base64"),
              },
            ],
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          kind: string
          message: string
          should_resume: boolean
          user_message: {
            info: { id: string; sessionID: string }
            parts: Array<{ type: string; mime?: string; filename?: string; url?: string }>
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.kind).toBe("note")
        expect(body.message).toBe("Operator note recorded. Task wake dispatched.")
        expect(body.should_resume).toBe(true)
        expect(body.user_message.info.sessionID).toBe(root.id)
        expect(body.user_message.parts).toHaveLength(2)
        expect(body.user_message.parts[1]).toMatchObject({
          type: "file",
          mime: "text/plain",
          filename: "spec.txt",
        })
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        // V35: trigger schema replaced with `event.operatorMessage`.
        const event = (
          dispatchTaskLoop.mock.calls[0]?.[0] as {
            event: {
              note?: string
              operatorMessage: {
                text: string
                attachmentSummary?: string
              }
            }
          }
        )?.event
        expect(event.operatorMessage.text).toBe("参考我刚上传的规格，再决定下一步。")
        expect(event.operatorMessage.attachmentSummary).toContain("Attachments:")
        expect(event.operatorMessage.attachmentSummary).toContain("spec.txt")
        expect(event.operatorMessage.attachmentSummary).toContain("text/plain")
        expect(dispatchTaskLoop.mock.calls[0]?.[0]).not.toHaveProperty("interrupt")
        const task = Database.use((db) =>
          db
            .select({ attachments: EngineTaskTable.attachments })
            .from(EngineTaskTable)
            .where(eq(EngineTaskTable.id, taskID))
            .get(),
        )
        expect(task?.attachments).toEqual([
          expect.objectContaining({
            mime: "text/plain",
            filename: "spec.txt",
            intent: "spec_artifact",
            source: "user-upload",
          }),
        ])
        const messages = await Session.messages({ sessionID: root.id })
        const latest = messages.at(-1)
        expect(latest?.info.id).toBe(body.user_message.info.id)
        expect(latest?.parts[1]).toMatchObject({
          type: "file",
          mime: "text/plain",
          filename: "spec.txt",
        })
      },
    })
  })

  test("POST /task/:taskID/inject queues behind live build ownership without aborting it", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const goalID = Identifier.ascending("goal")
        const childSessionID = `ses_build_inject_${now}`
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          await holdLoop
        })
        const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")
        const root = await Session.create({ kind: "root", title: "inject live owner" })
        await seedRootSession(root.id)

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "inject live owner",
              request: "inject live owner",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "Live build goal",
              slug: "live-build-goal",
              objective: "Keep the live build running while /inject wakes the task.",
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
        })
        const goalRunID = beginBuildAttempt({
          taskID,
          goalID,
          sessionID: childSessionID,
          now,
        })

        await Queue.dispatchTaskLoop({ taskID })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: `ses_orchestrator_${now}`,
          orchestratorMessageID: `msg_orchestrator_${now}`,
          toolCallID: `cal_build_${now}`,
          toolPartID: `prt_build_${now}`,
          childSessionID,
          scope: "goal",
          goalID,
          goalRunID,
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          goalRunID,
          label: "tool-ownership-start",
          payload: ownershipPayload,
          now,
        })

        const response = await app.request(`/task/${taskID}/inject`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "继续推进这个失败点。",
          }),
        })

        expect(response.status).toBe(200)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)
        expect(findGoalRun(goalRunID)?.status).toBe("running")

        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: ownershipPayload.ownership_id,
          outcome: "completed",
          now: now + 1,
        })
        release!()
        await holdLoop
      },
    })
  })

  test("POST /task/:taskID/message queues behind multiple live build owners without aborting them", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          await holdLoop
        })
        const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")
        const root = await Session.create({ kind: "root", title: "message live owners" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "message live owners",
              request: "message live owners",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await Queue.dispatchTaskLoop({ taskID })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

        const owners = [
          await seedLiveBuildOwner({ taskID, rootSessionID: root.id, suffix: "a", now, orderIndex: 0 }),
          await seedLiveBuildOwner({ taskID, rootSessionID: root.id, suffix: "b", now, orderIndex: 1 }),
        ]

        const target = {
          kind: "build_session" as const,
          sessionID: owners[0]!.sessionID,
          goalID: owners[0]!.goalID,
        }
        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "补充一条调度器消息，但不能中断正在跑的 goal。",
            source: "panel",
            target,
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          user_message?: { info: { id: string; extra?: Record<string, unknown> } }
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(2)
        for (const owner of owners) {
          expect(findGoalRun(owner.goalRunID)?.status).toBe("running")
        }
        expect(body.user_message?.info.extra).toEqual({
          operator_message: {
            source: "panel",
            target,
          },
        })

        for (const owner of owners) {
          completeOrchestratorToolOwnership({
            taskID,
            ownershipID: owner.ownershipID,
            outcome: "completed",
            now: now + 1,
          })
        }
        release!()
        await holdLoop
      },
    })
  })

  test("POST /task/:taskID/message does not interrupt async goal after ownership closes", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        let release: (() => void) | undefined
        const holdLoop = new Promise<void>((resolve) => {
          release = resolve
        })
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockImplementation(async () => {
          await holdLoop
        })
        const interruptTaskLoop = spyOn(TaskLoop, "interruptTaskLoop")
        const root = await Session.create({ kind: "root", title: "message async build" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "message async build",
              request: "message async build",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await Queue.dispatchTaskLoop({ taskID })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(runTaskLoop).toHaveBeenCalledTimes(1)

        const owner = await seedLiveBuildOwner({ taskID, rootSessionID: root.id, suffix: "async", now, orderIndex: 0 })
        completeOrchestratorToolOwnership({
          taskID,
          ownershipID: owner.ownershipID,
          outcome: "completed",
          now: now + 1,
        })
        expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)

        const response = await app.request(`/task/${taskID}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "补充信息，但后台 build 不能被取消。",
            source: "panel",
            target: {
              kind: "build_session",
              sessionID: owner.sessionID,
              goalID: owner.goalID,
            },
          }),
        })

        expect(response.status).toBe(200)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(interruptTaskLoop).not.toHaveBeenCalled()
        expect(runTaskLoop).toHaveBeenCalledTimes(2)
        expect(findGoalRun(owner.goalRunID)?.status).toBe("running")

        release!()
        await holdLoop
      },
    })
  })

  test("POST /task/:taskID/inject reopens failed terminal task and wakes orchestrator", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "inject terminal" })
        await seedRootSession(root.id)

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "inject terminal",
              request: "inject terminal",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
              time_completed: now + 1,
              error: "previous failure",
              metadata: { decision_log: ["keep-me"] },
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/inject`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "继续推进。",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          appended: boolean
          orchestratorWoken: boolean
          executorResumed: boolean
          status: string
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body).toEqual({
          appended: true,
          orchestratorWoken: true,
          executorResumed: false,
          status: "active",
        })
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)

        const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row ? deriveTaskStatus(row) : undefined).toBe("active")
        expect((row?.metadata as { decision_log?: string[] } | null)?.decision_log).toEqual(["keep-me"])
      },
    })
  })

  test("POST /task/:taskID/inject wakes orchestrator without resuming the root run session", async () => {
    await using tmp = await tmpdir({ git: true, config: routeTestConfig })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const dispatchTaskLoop = spyOn(Queue, "dispatchTaskLoop").mockResolvedValue(undefined)
        let resumeCalls = 0
        ExecutorRegistry.register("opencorvus", {
          capabilities: () => ({
            submit: true,
            status: true,
            abort: true,
            acceptance: true,
            resume: true,
            events: false,
          }),
          submit: async () => {
            throw new Error("submit should not be called")
          },
          status: async () => {
            throw new Error("status should not be called")
          },
          abort: async () => {
            throw new Error("abort should not be called")
          },
          acceptance: async () => {
            throw new Error("acceptance should not be called")
          },
          resume: async () => {
            resumeCalls += 1
            throw new Error("task inject must not resume the active executor")
          },
          events: () => {
            throw new Error("events should not be called")
          },
        } as unknown as ExecutorAdapter)
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "inject running" })
        await seedRootSession(root.id)

        Database.use((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "inject running",
              request: "inject running",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineArtifactTable)
            .values({
              id: runID,
              task_id: taskID,
              run_id: runID,
              kind: "run",
              label: "run-running",
              payload: {
                plan_version_id: null,
                session_id: root.id,
                executor: "opencorvus",
                status: "running",
                phase: "dispatch",
                retry_count: 0,
                blocking_reason: null,
                error: null,
                executor_ref: {
                  session_id: root.id,
                  queue_task_id: "queue-root",
                },
                metadata: {},
                time_started: now,
                time_completed: null,
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        const response = await app.request(`/task/${taskID}/inject`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "继续完成G3",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          appended: boolean
          orchestratorWoken: boolean
          executorResumed: boolean
          status: string
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body).toEqual({
          appended: true,
          orchestratorWoken: true,
          executorResumed: false,
          status: "active",
        })
        expect(resumeCalls).toBe(0)
        expect(dispatchTaskLoop).toHaveBeenCalledTimes(1)
        const event = dispatchTaskLoop.mock.calls[0]?.[0] as {
          event: {
            operatorMessage: {
              text: string
            }
          }
        }
        expect(event.event.operatorMessage.text).toBe("继续完成G3")
        expect(dispatchTaskLoop.mock.calls[0]?.[0]).not.toHaveProperty("interrupt")

        const messages = await Session.messages({ sessionID: root.id })
        expect(messages.filter((message) => message.info.role === "assistant")).toHaveLength(0)
        expect(
          messages.some(
            (message) =>
              message.info.role === "user" &&
              message.parts.some((part) => part.type === "text" && part.text === "继续完成G3"),
          ),
        ).toBe(true)
      },
    })
  })
})
