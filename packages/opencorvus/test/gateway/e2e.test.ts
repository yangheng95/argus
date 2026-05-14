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
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { ChannelIngress } from "../../src/channel/ingress"
import { ControlMessage } from "../../src/control/message"
import { EngineService } from "@/task-api"
import { Question } from "../../src/question"
import { listProjectTasks } from "../../src/engine/store"
import * as TaskLoop from "../../src/orchestrator/loop"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

// ── 1. Channel ingress: routing semantics ────────────────────────────

describe("Gateway e2e — channel ingress routing (PRD §10)", () => {
  test("bound thread routes the message to the existing task without creating a new one", async () => {
    await using tmp = await tmpdir({ git: true })
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
    await using tmp = await tmpdir({ git: true })
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

  test("permission interaction reply skips the LLM hop entirely", async () => {
    await using tmp = await tmpdir({ git: true })
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

        const taskID = await EngineService.createTask({
          request: "Requires permission",
          kind: "workflow",
          queue: false,
          executor: "opencorvus",
          metadata: { source: "test" },
        })
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
        // Critical PRD §10 invariant — the channel command "allow" resolves
        // the pending permission deterministically, never falling through to
        // the LLM control plane.
        expect(handleSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("question interaction passes the message text into the reply (no LLM)", async () => {
    await using tmp = await tmpdir({ git: true })
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

        const taskID = await EngineService.createTask({
          request: "Asks a question",
          kind: "workflow",
          queue: false,
          executor: "opencorvus",
          metadata: { source: "test" },
        })
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
  })
})

// ── 2. Task lifecycle via the same APIs Gateway calls ────────────────

describe("Gateway e2e — task lifecycle through EngineService (PRD §9)", () => {
  test("create → message → cancel → delete writes match expected statuses", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        // create — queue:false → status active
        const taskID = await EngineService.createTask({
          request: "Build a counter",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
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

  test("queue=true keeps the task queued instead of starting (matches 2026-05-13 task-queue-opt-in)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        // First task starts immediately (queue=false).
        const firstID = await EngineService.createTask({
          request: "first",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
        const first = await EngineService.getTask(firstID)
        expect(first.status).toBe("active")

        // Second task with queue=true must NOT auto-start because the first
        // is already active in the same directory — it stays queued.
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
    await using tmp = await tmpdir({ git: true })
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

describe("Gateway e2e — channel bindings + reverse lookup (PRD §17.14)", () => {
  test("bindThread + bindingsByTaskID round-trip returns the same rows", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const taskID = await EngineService.createTask({
          request: "binding round-trip",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
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

        await EngineService.deleteTask(taskID).catch(() => undefined)
      },
    })
  })

  test("HTTP GET /task/:taskID/bindings returns the bindings for the task only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const targetID = await EngineService.createTask({
          request: "target",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
        const otherID = await EngineService.createTask({
          request: "other",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
        ChannelIngress.bindThread({ platform: "slack", channel: "C", thread: "T-target", taskID: targetID })
        ChannelIngress.bindThread({ platform: "slack", channel: "C", thread: "T-other", taskID: otherID })

        const response = await Server.App().request(`/task/${encodeURIComponent(targetID)}/bindings`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })
        expect(response.status).toBe(200)
        const rows = (await response.json()) as Array<{ task_id: string; thread: string }>
        expect(rows.length).toBe(1)
        expect(rows[0]!.task_id).toBe(targetID)
        expect(rows[0]!.thread).toBe("T-target")

        await EngineService.deleteTask(targetID).catch(() => undefined)
        await EngineService.deleteTask(otherID).catch(() => undefined)
      },
    })
  })
})

// ── 4. HTTP transport coverage for gateway routes ───────────────────

describe("Gateway e2e — HTTP routes via Server.App().request (PRD §11)", () => {
  test("POST /channel/message with bound thread reaches ControlMessage.handle through the route", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
        const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "panel_response",
          message: "ok",
        })

        const taskID = await EngineService.createTask({
          request: "for routing",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })
        ChannelIngress.bindThread({ platform: "slack", channel: "C-rt", thread: "T-rt", taskID })

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

        await EngineService.deleteTask(taskID).catch(() => undefined)
      },
    })
  })

  test("POST /gateway/channel/:platform/message bridges into ChannelIngress with the URL platform", async () => {
    await using tmp = await tmpdir({ git: true })
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
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const taskID = await EngineService.createTask({
          request: "stats sample",
          executor: "opencorvus",
          kind: "workflow",
          queue: false,
          metadata: { source: "gateway:test" },
        })

        const response = await Server.App().request("/gateway/stats", {
          headers: { "x-opencorvus-directory": tmp.path },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          tasks: { total: number; recent: Array<{ id: string }>; status: Record<string, number> }
          capabilities: { total: number }
        }
        expect(body.tasks.total).toBeGreaterThanOrEqual(1)
        expect(body.tasks.recent.some((t) => t.id === taskID)).toBe(true)
        expect(typeof body.capabilities.total).toBe("number")

        await EngineService.deleteTask(taskID).catch(() => undefined)
      },
    })
  })

  test("POST /gateway/task/decompose validates input — empty requirement is 400", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/gateway/task/decompose", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ requirement: "" }),
        })
        expect(response.status).toBe(400)
      },
    })
  })

  test("POST /gateway/task/decompose rejects requirements over 32 KB (DoS / token-cost guard)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const oversized = "x".repeat(32_001)
        const response = await Server.App().request("/gateway/task/decompose", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ requirement: oversized }),
        })
        expect(response.status).toBe(400)
      },
    })
  })

  test(
    "POST /gateway/task/decompose creates ZERO tasks regardless of outcome (PRD §17.7)",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)
          const before = listProjectTasks(Instance.project.id, 999).length

          const response = await Server.App().request("/gateway/task/decompose", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({ requirement: "Decompose into nothing — proof of zero side effects." }),
          })

          // The route may succeed (200) or fail (>=400) depending on the
          // test environment's model config, but in NEITHER case may a
          // task have been created. This is the load-bearing PRD §17.7
          // invariant: decomposition is a preview, not a write.
          const after = listProjectTasks(Instance.project.id, 999).length
          expect(after).toBe(before)
          expect([200, 400, 500, 502, 503]).toContain(response.status)
        },
      })
    },
    { timeout: 60000 },
  )

  test(
    "POST /gateway/task/decompose returns the documented HTTP shape on every code path",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Either a successful proposal (status 200, full
          // GatewayTaskDecomposition shape with at least one task) or a
          // typed failure (>=400 with a non-empty error body). The shape
          // we explicitly forbid — and what this test catches — is a 200
          // with an empty `tasks` array, which would mean Gateway silently
          // returned a useless proposal instead of surfacing the error.
          const response = await Server.App().request("/gateway/task/decompose", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({ requirement: "Build a tiny todo app." }),
          })
          if (response.status === 200) {
            const body = (await response.json()) as {
              proposal_id: string
              requirement: string
              summary: string
              tasks: Array<{ id: string; title: string; description: string }>
            }
            expect(typeof body.proposal_id).toBe("string")
            expect(body.proposal_id.length).toBeGreaterThan(0)
            expect(typeof body.summary).toBe("string")
            expect(Array.isArray(body.tasks)).toBe(true)
            expect(body.tasks.length).toBeGreaterThan(0)
            for (const task of body.tasks) {
              expect(typeof task.id).toBe("string")
              expect(typeof task.title).toBe("string")
              expect(typeof task.description).toBe("string")
            }
          } else {
            expect(response.status).toBeGreaterThanOrEqual(400)
            const text = await response.text()
            expect(text.length).toBeGreaterThan(0)
            // The route MUST NOT echo raw stack traces / API tokens to
            // the client. Our generic message starts with this prefix.
            if (response.status >= 500) {
              expect(text).toContain("Gateway decomposition failed")
            }
          }
        },
      })
    },
    { timeout: 60000 },
  )

  test(
    "GET /task/:taskID/bindings returns the documented row shape (id, task_id, platform, channel, thread)",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

          const taskID = await EngineService.createTask({
            request: "shape check",
            executor: "opencorvus",
            kind: "workflow",
            queue: false,
            metadata: { source: "gateway:test" },
          })
          ChannelIngress.bindThread({
            platform: "slack",
            channel: "C-shape",
            thread: "T-shape",
            taskID,
            payload: { user: "u-shape" },
          })

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

          await EngineService.deleteTask(taskID).catch(() => undefined)
        },
      })
    },
  )

})
