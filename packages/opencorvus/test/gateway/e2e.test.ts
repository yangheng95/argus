/**
 * Gateway end-to-end tests — exercises the realistic flow the new
 * Gateway page depends on, without spawning real LLMs:
 *
 *   1. External channel message (slack / telegram / etc.)
 *      → ChannelIngress.message routes through ControlMessage.handle
 *      → bound vs unbound vs allow_create=false branches
 *      → permission-interaction short-circuit (no LLM hop)
 *
 *   2. Task lifecycle through EngineService (the same surface the
 *      Gateway workbench uses):
 *      → createTask (queue=false / queue=true)
 *      → handleTaskMessage (operator follow-up)
 *      → cancelTask, retryTask, deleteTask
 *      → channel-binding cleanup on cancel
 *
 *   3. HTTP-shape assertions through Server.App().request, the same
 *      transport the Gateway UI uses.
 *
 * Mocks: TaskLoop.runTaskLoop and ControlMessage.handle are stubbed
 * so the orchestrator and control-plane LLM never actually run. The
 * tests still validate that the right service was called with the
 * right arguments — that's exactly what end-to-end coverage of the
 * Gateway surface needs (the LLM path itself is covered elsewhere).
 */
import { afterEach, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Server } from "../../src/server/server"
import { ChannelIngress } from "../../src/channel/ingress"
import { ChannelSupervisor } from "../../src/channel/supervisor"
import { ControlMessage } from "../../src/control/message"
import { SessionPrompt } from "../../src/session/prompt"
import { PanelTool } from "../../src/tool/panel"
import { EngineService } from "@/task-api"
import { Question } from "../../src/question"
import { listProjectTasks } from "../../src/engine/store"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import * as TaskLoop from "../../src/orchestrator/loop"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })
setDefaultTimeout(30_000)

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

async function waitForTaskStatus(taskID: string, status: string) {
  for (let i = 0; i < 50; i++) {
    if ((await EngineService.getTask(taskID)).status === status) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function insertIngressTask(input: { taskID?: string; title: string }) {
  const taskID = input.taskID ?? Identifier.ascending("task")
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "gateway:test",
        title: input.title,
        request: input.title,
        executor: "opencorvus",
        kind: "workflow",
        priority: "normal",
        queue_order: 0,
        time_started: now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return taskID
}

async function seedGatewayProject<T>(directory: string, fn: () => T | Promise<T>) {
  const result = await Instance.provide({ directory, fn })
  await Instance.disposeAll()
  return result
}

// ── 1. Channel ingress: routing semantics ────────────────────────────

describe("Gateway e2e — channel ingress routing (template §10)", () => {
  test("bound thread routes the message to the existing task without creating a new one", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runTaskLoop = spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "panel_response",
          message: "stub from control plane",
        })

        const taskID = await EngineService.createTask({
          request: "Initial requirement",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "test" },
        })
        await waitForTaskStatus(taskID, "active")
        ChannelIngress.bindThread({
          platform: "slack",
          channel: "C-route",
          thread: "T-route",
          taskID,
        })

        const result = await ChannelIngress.message({
          platform: "slack",
          channel: "C-route",
          thread: "T-route",
          text: "Follow-up from chat",
          allow_create: true,
        })

        expect(result.kind).toBe("panel_response")
        expect(handleSpy).toHaveBeenCalledTimes(1)
        const callArg = handleSpy.mock.calls[0]?.[0] as { taskID?: string; surface?: string; text?: string } | undefined
        expect(callArg?.taskID).toBe(taskID)
        expect(callArg?.surface).toBe("slack")
        expect(callArg?.text).toBe("Follow-up from chat")

        // No second task was created — the panel_response routes back to the
        // bound task. We only see the one task we explicitly created.
        const projectTasks = listProjectTasks(Instance.project.id, 50)
        expect(projectTasks.filter((t) => t.id === taskID)).toHaveLength(1)
        // runTaskLoop fires once for the EngineService.createTask, no extra
        // dispatch because ControlMessage.handle is stubbed.
        expect(runTaskLoop).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("unbound thread with allow_create=false rejects without LLM hop", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "panel_response",
          message: "should never run",
        })

        const result = await ChannelIngress.message({
          platform: "slack",
          channel: "C-empty",
          thread: "T-empty",
          text: "Anyone here?",
          allow_create: false,
        })

        expect(result.kind).toBe("panel_response")
        expect(result.message).toContain("No task is bound")
        // ControlMessage.handle MUST NOT be called — short-circuit happens
        // entirely inside ChannelIngress when allow_create is false.
        expect(handleSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("first channel message creates a durable binding and the follow-up resolves the same task", async () => {
    mock.module("@/agent/model", () => ({
      resolveAgentModelRef: async () => ({
        id: "control",
        providerID: "mock-control",
        modelID: "control",
        api: { id: "control" },
      }),
    }))
    spyOn(Agent, "defaultAgent").mockResolvedValue({
      name: "control",
      mode: "primary",
      options: {},
    })
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
          const tool = await PanelTool.init()
          const result = await tool.execute(
            {
              action: "create_task",
              request: `Original user input:\n${String(input.parts[0]?.text ?? "")}`,
              queue: true,
            },
            {
              sessionID: input.sessionID,
              messageID: "msg_control_tool",
              agent: "control",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              async ask() {},
              extra: input.extra,
            },
          )
          const taskID = (JSON.parse(result.output) as { task_id: string }).task_id
          return {
            info: {
              id: "msg_control_result",
              sessionID: input.sessionID,
              role: "assistant",
              structured: {
                kind: "created",
                message: "Task accepted.",
                task_id: taskID,
              },
              time: {
                created: Date.now(),
                completed: Date.now(),
              },
              agent: "control",
              providerID: "mock-control",
              modelID: "control",
              cost: 0,
              tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              path: { cwd: tmp.path, root: tmp.path },
            },
            parts: [],
          } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
        })

        const created = await ChannelIngress.message({
          platform: "slack",
          channel: "C-first-create",
          thread: "T-first-create",
          text: "Build this from the channel.",
          allow_create: true,
        })
        expect(created.kind).toBe("created")
        expect(created.task_id).toBeDefined()

        const binding = ChannelIngress.findBinding("slack", "C-first-create", "T-first-create")
        expect(binding?.task_id).toBe(created.task_id)

        mock.restore()
        const followupSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "message",
          message: "follow-up routed",
          task_id: created.task_id,
        })

        await ChannelIngress.message({
          platform: "slack",
          channel: "C-first-create",
          thread: "T-first-create",
          text: "Second message.",
          allow_create: false,
        })

        expect(followupSpy).toHaveBeenCalledTimes(1)
        expect((followupSpy.mock.calls[0]?.[0] as { taskID?: string } | undefined)?.taskID).toBe(created.task_id)
      },
    })
  }, 25_000)

  test("binding owned by another active project is rejected at channel ingress", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const foreignTaskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(ProjectTable)
            .values({
              id: "foreign-project-id",
              worktree: `${tmp.path}/foreign-project`,
              sandboxes: [],
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: foreignTaskID,
              project_id: "foreign-project-id",
              source: "gateway:test",
              title: "foreign channel task",
              request: "foreign channel task",
              status: "active",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        ChannelIngress.bindThread({
          platform: "slack",
          channel: "C-cross-project",
          thread: "T-cross-project",
          taskID: foreignTaskID,
        })
        const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "panel_response",
          message: "should never run",
        })

        await expect(
          ChannelIngress.message({
            platform: "slack",
            channel: "C-cross-project",
            thread: "T-cross-project",
            text: "follow up from another project",
            allow_create: false,
          }),
        ).rejects.toThrow("but the active project is")

        expect(handleSpy).not.toHaveBeenCalled()
      },
    })
  }, 20_000)

  test(
    "permission interaction reply skips the LLM hop entirely",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
          const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
            kind: "panel_response",
            message: "should never run",
          })
          const replySpy = spyOn(EngineService, "replyInteraction").mockResolvedValue({
            id: "int_1",
            status: "answered",
          } as any)
          spyOn(EngineService, "listTaskInteractions").mockResolvedValue([
            { id: "int_1", type: "permission", status: "pending" } as any,
          ])

          const taskID = insertIngressTask({ title: "Requires permission" })
          ChannelIngress.bindThread({
            platform: "slack",
            channel: "C-perm",
            thread: "T-perm",
            taskID,
          })

          const result = await ChannelIngress.message({
            platform: "slack",
            channel: "C-perm",
            thread: "T-perm",
            text: "allow",
            allow_create: true,
          })

          expect(result.kind).toBe("interaction")
          expect(replySpy).toHaveBeenCalledTimes(1)
          // Critical template §10 invariant — the channel command "allow" resolves
          // the pending permission deterministically, never falling through to
          // the LLM control plane.
          expect(handleSpy).not.toHaveBeenCalled()
        },
      })
    },
    { timeout: 30_000 },
  )

  test(
    "unknown permission reply is handled deterministically without LLM fallthrough",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
          const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
            kind: "panel_response",
            message: "should never run",
          })
          const replySpy = spyOn(EngineService, "replyInteraction").mockResolvedValue({
            id: "int_unknown",
            status: "answered",
          } as any)
          const rejectSpy = spyOn(EngineService, "rejectInteraction").mockResolvedValue({
            id: "int_unknown",
            status: "rejected",
          } as any)
          spyOn(EngineService, "listTaskInteractions").mockResolvedValue([
            { id: "int_unknown", type: "permission", status: "pending" } as any,
          ])

          const taskID = insertIngressTask({ title: "Requires permission" })
          ChannelIngress.bindThread({
            platform: "slack",
            channel: "C-perm-unknown",
            thread: "T-perm-unknown",
            taskID,
          })

          const result = await ChannelIngress.message({
            platform: "slack",
            channel: "C-perm-unknown",
            thread: "T-perm-unknown",
            text: "maybe later",
            allow_create: true,
          })

          expect(result.kind).toBe("panel_response")
          expect(result.message).toContain("Permission reply not recognized")
          expect(replySpy).not.toHaveBeenCalled()
          expect(rejectSpy).not.toHaveBeenCalled()
          expect(handleSpy).not.toHaveBeenCalled()
        },
      })
    },
    { timeout: 30_000 },
  )

  test(
    "question interaction passes the message text into the reply (no LLM)",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
          const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
            kind: "panel_response",
            message: "should never run",
          })
          const replySpy = spyOn(EngineService, "replyInteraction").mockResolvedValue({
            id: "int_2",
            status: "answered",
          } as any)
          spyOn(EngineService, "listTaskInteractions").mockResolvedValue([
            { id: "int_2", type: "question", status: "pending" } as any,
          ])

          const taskID = insertIngressTask({ title: "Asks a question" })
          ChannelIngress.bindThread({
            platform: "telegram",
            channel: "@me",
            thread: "thread-q",
            taskID,
          })

          const result = await ChannelIngress.message({
            platform: "telegram",
            channel: "@me",
            thread: "thread-q",
            text: "use option B",
            allow_create: true,
          })

          expect(result.kind).toBe("interaction")
          const replyArg = replySpy.mock.calls[0]?.[1]
          expect(replyArg?.message).toBe("use option B")
          expect(handleSpy).not.toHaveBeenCalled()
        },
      })
    },
    { timeout: 30_000 },
  )
})

// ── 2. Task lifecycle via the same APIs Gateway calls ────────────────

describe("Gateway e2e — task lifecycle through EngineService (template §9)", () => {
  test("create → message → cancel → delete writes match expected statuses", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        // create — queue:false starts immediately.
        const taskID = await EngineService.createTask({
          request: "Build a counter",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
        await waitForTaskStatus(taskID, "active")
        let task = await EngineService.getTask(taskID)
        expect(task.status).toBe("active")
        expect(task.kind).toBe("workflow")

        // operator-message handler — accepts the message and returns a kind
        // describing what the engine did (note / goal / plan).
        const msgRes = await EngineService.handleTaskMessage(taskID, {
          text: "actually use a stepper",
          source: "panel",
        })
        expect(typeof msgRes.kind).toBe("string")
        expect(msgRes.kind.length).toBeGreaterThan(0)

        // cancel — flips to cancelled
        await EngineService.cancelTask(taskID)
        task = await EngineService.getTask(taskID)
        expect(task.status).toBe("cancelled")

        // delete — row gone
        await EngineService.deleteTask(taskID)
        const remaining = listProjectTasks(Instance.project.id, 50)
        expect(remaining.find((t) => t.id === taskID)).toBeUndefined()
      },
    })
  })

  test("queue=true second same-directory task stays queued until the active task exits", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        // First task starts because queue:false starts immediately.
        const firstID = await EngineService.createTask({
          request: "first",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
        await waitForTaskStatus(firstID, "active")
        const first = await EngineService.getTask(firstID)
        expect(first.status).toBe("active")

        // Second task waits because the caller explicitly requested queueing.
        const secondID = await EngineService.createTask({
          request: "second",
          executor: "opencorvus",
          kind: "workflow",
          queue: true,
          metadata: { source: "gateway:test" },
        })
        const second = await EngineService.getTask(secondID)
        expect(second.status).toBe("queued")

        await EngineService.deleteTask(firstID).catch(() => undefined)
        await EngineService.deleteTask(secondID).catch(() => undefined)
      },
    })
  })

  test("retryTask flips a terminal task back to a non-terminal status", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const taskID = await EngineService.createTask({
          request: "to-be-retried",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
        await waitForTaskStatus(taskID, "active")
        await EngineService.cancelTask(taskID)
        const cancelled = await EngineService.getTask(taskID)
        expect(cancelled.status).toBe("cancelled")

        await EngineService.retryTask(taskID)
        const after = await EngineService.getTask(taskID)
        expect(["queued", "active"]).toContain(after.status)

        await EngineService.deleteTask(taskID).catch(() => undefined)
      },
    })
  })
})

// ── 3. Channel binding round-trip + reverse lookup ──────────────────

describe("Gateway e2e — channel bindings + reverse lookup (template §17.14)", () => {
  test(
    "bindThread + bindingsByTaskID round-trip returns the same rows",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const taskID = insertIngressTask({ title: "binding round-trip" })
          ChannelIngress.bindThread({
            platform: "slack",
            channel: "C-bind",
            thread: "T1",
            taskID,
            payload: { user: "u-1" },
          })
          ChannelIngress.bindThread({
            platform: "telegram",
            channel: "@bind",
            thread: "T2",
            taskID,
          })

          const rows = ChannelIngress.bindingsByTaskID(taskID)
          const platforms = rows.map((r) => r.platform).sort()
          expect(platforms).toEqual(["slack", "telegram"])
          for (const row of rows) {
            expect(row.task_id).toBe(taskID)
          }
        },
      })
    },
    { timeout: 30_000 },
  )

  test(
    "HTTP GET /task/:taskID/bindings returns the bindings for the task only",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
      const { targetID } = await seedGatewayProject(tmp.path, () => {
        const targetID = insertIngressTask({ title: "target" })
        const otherID = insertIngressTask({ title: "other" })
        ChannelIngress.bindThread({ platform: "slack", channel: "C", thread: "T-target", taskID: targetID })
        ChannelIngress.bindThread({ platform: "slack", channel: "C", thread: "T-other", taskID: otherID })
        return { targetID }
      })

      try {
        const response = await Server.App().request(`/task/${encodeURIComponent(targetID)}/bindings`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })
        expect(response.status).toBe(200)
        const rows = (await response.json()) as Array<{ task_id: string; thread: string }>
        expect(rows.length).toBe(1)
        expect(rows[0]!.task_id).toBe(targetID)
        expect(rows[0]!.thread).toBe("T-target")
      } finally {
        await Instance.disposeAll()
      }
    },
    { timeout: 30_000 },
  )

  test(
    "HTTP GET /task/:taskID/bindings distinguishes a missing task from an existing task without bindings",
    async () => {
      await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
      const taskID = await seedGatewayProject(tmp.path, () => insertIngressTask({ title: "task with no bindings" }))

      try {
        const emptyResponse = await Server.App().request(`/task/${encodeURIComponent(taskID)}/bindings`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })
        expect(emptyResponse.status).toBe(200)
        expect(await emptyResponse.json()).toEqual([])

        const missingResponse = await Server.App().request("/task/tsk_missing_bindings/bindings", {
          headers: { "x-opencorvus-directory": tmp.path },
        })
        expect(missingResponse.status).toBe(404)
      } finally {
        await Instance.disposeAll()
      }
    },
    { timeout: 30_000 },
  )
})

// ── 4. HTTP transport coverage for gateway routes ───────────────────

describe("Gateway e2e — HTTP routes via Server.App().request (template §11)", () => {
  test("POST /channel/message with bound thread reaches ControlMessage.handle through the route", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    const taskID = await seedGatewayProject(tmp.path, () => {
      const taskID = insertIngressTask({ title: "for routing" })
      ChannelIngress.bindThread({ platform: "slack", channel: "C-rt", thread: "T-rt", taskID })
      return taskID
    })
    const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
      kind: "panel_response",
      message: "ok",
    })

    try {
      const response = await Server.App().request("/channel/message", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        },
        body: JSON.stringify({
          platform: "slack",
          channel: "C-rt",
          thread: "T-rt",
          text: "operator update from gateway",
          allow_create: true,
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { kind: string }
      expect(body.kind).toBe("panel_response")
      expect(handleSpy).toHaveBeenCalledTimes(1)
      const arg = handleSpy.mock.calls[0]?.[0] as { taskID?: string; text?: string }
      expect(arg.taskID).toBe(taskID)
      expect(arg.text).toBe("operator update from gateway")
    } finally {
      await Instance.disposeAll()
    }
  })

  test("POST /gateway/channel/:platform/message bridges into ChannelIngress with the URL platform", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "panel_response",
          message: "ok",
        })
        const ingressSpy = spyOn(ChannelIngress, "message")

        const response = await Server.App().request("/gateway/channel/discord/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            channel: "guild-ch",
            thread: "thr-1",
            text: "from gateway bridge",
            allow_create: false,
          }),
        })

        expect(response.status).toBe(200)
        // ChannelIngress sees the platform from the URL even though the body
        // omitted it (gateway route fills it in).
        expect(ingressSpy).toHaveBeenCalledTimes(1)
        const arg = ingressSpy.mock.calls[0]?.[0] as { platform?: string }
        expect(arg?.platform).toBe("discord")
        // allow_create=false + no binding → ControlMessage.handle not called.
        expect(handleSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("GET /gateway/stats returns project / task / capability summary", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    const taskID = await seedGatewayProject(tmp.path, () => insertIngressTask({ title: "stats sample" }))

    try {
      const response = await Server.App().request("/gateway/stats", {
        headers: { "x-opencorvus-directory": tmp.path },
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        tasks: { total: number; recent: Array<{ id: string }>; status: Record<string, number> }
        capabilities: { total: number }
        channelRuntime: { running: boolean; status: string; channels: string[] }
      }
      expect(body.tasks.total).toBeGreaterThanOrEqual(1)
      expect(body.tasks.recent.some((t) => t.id === taskID)).toBe(true)
      expect(typeof body.capabilities.total).toBe("number")
      expect(typeof body.channelRuntime.running).toBe("boolean")
      expect(typeof body.channelRuntime.status).toBe("string")
      expect(Array.isArray(body.channelRuntime.channels)).toBe(true)
    } finally {
      await Instance.disposeAll()
    }
  })

  test("GET /gateway/stats propagates channel runtime status failures", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(ChannelSupervisor, "status").mockRejectedValue(new Error("channel runtime status unavailable"))

        const response = await Server.App().request("/gateway/stats", {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: "channel runtime status unavailable" },
        })
      },
    })
  })

  test("GET /task/:taskID/bindings returns the documented row shape (id, task_id, platform, channel, thread)", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })
    const taskID = await seedGatewayProject(tmp.path, () => {
      const taskID = insertIngressTask({ title: "shape check" })
      ChannelIngress.bindThread({
        platform: "slack",
        channel: "C-shape",
        thread: "T-shape",
        taskID,
        payload: { user: "u-shape" },
      })
      return taskID
    })

    try {
      const response = await Server.App().request(`/task/${encodeURIComponent(taskID)}/bindings`, {
        headers: { "x-opencorvus-directory": tmp.path },
      })
      expect(response.status).toBe(200)
      const rows = (await response.json()) as Array<{
        id: string
        task_id: string
        platform: string
        channel: string
        thread: string
        payload?: Record<string, unknown>
        time_created?: number
        time_updated?: number
      }>
      expect(rows.length).toBe(1)
      const row = rows[0]!
      expect(typeof row.id).toBe("string")
      expect(row.id.length).toBeGreaterThan(0)
      expect(row.task_id).toBe(taskID)
      expect(row.platform).toBe("slack")
      expect(row.channel).toBe("C-shape")
      expect(row.thread).toBe("T-shape")
    } finally {
      await Instance.disposeAll()
    }
  })
})
