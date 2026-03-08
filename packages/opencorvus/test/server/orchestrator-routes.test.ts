import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { OrchestratorRunTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("orchestrator routes", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("POST /task returns task_id and dispatches a run", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
            },
          }),
        })

        expect(response.status).toBe(202)
        const json = (await response.json()) as { task_id: string }
        expect(typeof json.task_id).toBe("string")

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, json.task_id)).get(),
        )
        expect(task?.status).toBe("running")
        expect(task?.metadata?.checks).toBeDefined()

        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, json.task_id)).get(),
        )
        expect(run?.status).toBe("accepted")
        expect(run?.executor_ref?.queue_task_id).toBeTruthy()
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task is idempotent when request id is reused", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const first = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            requestID: "req-123",
            request: "implement feature x",
          }),
        })
        const second = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            requestID: "req-123",
            request: "implement feature x",
          }),
        })

        const firstBody = (await first.json()) as { task_id: string }
        const secondBody = (await second.json()) as { task_id: string }
        expect(first.status).toBe(202)
        expect(second.status).toBe(202)
        expect(secondBody.task_id).toBe(firstBody.task_id)

        const tasks = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.request_id, "req-123"))
            .all(),
        )
        expect(tasks.length).toBe(1)
        expect(tasks[0]?.request_id).toBe("req-123")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task accepts request id header for idempotency", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const first = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
            "x-opencorvus-request-id": "req-header-1",
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })
        const second = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
            "x-opencorvus-request-id": "req-header-1",
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })

        const firstBody = (await first.json()) as { task_id: string }
        const secondBody = (await second.json()) as { task_id: string }
        expect(secondBody.task_id).toBe(firstBody.task_id)
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task/:id/message stores preference update", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U123",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const response = await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "/pref style=concise",
            source: "slack",
            user_id: "U123",
          }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; message: string }
        expect(body.kind).toBe("preference")
        expect(body.message).toContain("Preference saved")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/brief returns compiled assistant brief", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U123",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            source: "slack",
            user_id: "U123",
          }),
        })
        const response = await app.request(`/task/${task_id}/brief`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { content: string }
        expect(body.content).toContain("Global preferences:")
        expect(body.content).toContain("lockfile_policy: avoid_changes")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task/:id/message accepts free-form preference text", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U999",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const response = await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            source: "slack",
            user_id: "U999",
          }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string }
        expect(body.kind).toBe("preference")
        const brief = await app.request(`/task/${task_id}/brief`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const briefBody = (await brief.json()) as { content: string }
        expect(briefBody.content).toContain("style: concise")
        expect(briefBody.content).toContain("lockfile_policy: avoid_changes")
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/board returns unified board projection", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U777",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            source: "slack",
            user_id: "U777",
          }),
        })
        const response = await app.request(`/task/${task_id}/board`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { lanes: Array<{ id: string; cards: unknown[] }>; brief: { content: string } }
        expect(body.lanes.some((lane) => lane.id === "preferences" && lane.cards.length > 0)).toBe(true)
        expect(body.brief.content).toContain("lockfile_policy: avoid_changes")
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/board includes api user-scoped preferences after message", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            source: "api",
            user_id: "U-API",
          }),
        })
        const response = await app.request(`/task/${task_id}/board`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { lanes: Array<{ id: string; cards: Array<{ title: string }> }>; brief: { content: string } }
        expect(body.lanes.some((lane) => lane.id === "preferences" && lane.cards.some((card) => card.title === "style"))).toBe(true)
        expect(body.brief.content).toContain("lockfile_policy: avoid_changes")
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /tasks returns project-level aggregation", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "first task",
          }),
        })
        await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "second task",
          }),
        })

        const response = await app.request("/tasks", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          summary: { total_tasks: number; open_tasks: number }
          tasks: Array<{ task: { id: string; request: string } }>
        }
        expect(body.summary.total_tasks).toBe(2)
        expect(body.summary.open_tasks).toBe(2)
        expect(body.tasks.length).toBe(2)
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("POST /task/:id/retry queues a deterministic retry run", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "update the landing page hero section copy",
            budget: {
              maxRuns: 1,
            },
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const progress = await app.request(`/task/${task_id}/progress`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(progress.status).toBe(200)

        const response = await app.request(`/task/${task_id}/retry`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { status: string }
        expect(body.status).toBe("accepted")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("POST /task/:id/replan queues a replanned run", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "update the landing page hero section copy",
            budget: {
              maxRuns: 1,
            },
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const progress = await app.request(`/task/${task_id}/progress`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(progress.status).toBe(200)

        const response = await app.request(`/task/${task_id}/replan`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { status: string; phase: string }
        expect(body.status).toBe("accepted")
        expect(body.phase).toBe("replan")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("PATCH and DELETE preference routes mutate board data", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "/pref style=concise",
          }),
        })
        const before = await app.request(`/task/${task_id}/board`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const beforeBody = (await before.json()) as { lanes: Array<{ id: string; cards: Array<{ id: string; title: string; detail?: string }> }> }
        const pref = beforeBody.lanes.find((lane) => lane.id === "preferences")?.cards[0]
        expect(pref?.title).toBe("style")

        const updated = await app.request(`/preference/${pref!.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            key: "style",
            value: "minimal_diff",
          }),
        })
        expect(updated.status).toBe(200)

        const afterUpdate = await app.request(`/task/${task_id}/board`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const updatedBody = (await afterUpdate.json()) as { lanes: Array<{ id: string; cards: Array<{ detail?: string }> }> }
        expect(updatedBody.lanes.find((lane) => lane.id === "preferences")?.cards[0]?.detail).toBe("minimal_diff")

        const removed = await app.request(`/preference/${pref!.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(removed.status).toBe(200)

        const afterDelete = await app.request(`/task/${task_id}/board`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const deletedBody = (await afterDelete.json()) as { lanes: Array<{ id: string; cards: unknown[] }> }
        expect(deletedBody.lanes.find((lane) => lane.id === "preferences")?.cards.length).toBe(0)
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("PATCH and DELETE goal routes mutate board data", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            goals: [
              {
                description: "Initial goal",
                criteria: "Initial criteria",
              },
            ],
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }

        const before = await app.request(`/task/${task_id}/board`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const beforeBody = (await before.json()) as { lanes: Array<{ id: string; cards: Array<{ id: string; title: string; detail?: string }> }> }
        const goal = beforeBody.lanes.find((lane) => lane.id === "goals")?.cards[0]
        expect(goal?.title).toBe("Initial goal")

        const updated = await app.request(`/goal/${goal!.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            description: "Updated goal",
            criteria: "Updated criteria",
          }),
        })
        expect(updated.status).toBe(200)

        const afterUpdate = await app.request(`/task/${task_id}/board`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const updatedBody = (await afterUpdate.json()) as { lanes: Array<{ id: string; cards: Array<{ title: string; detail?: string }> }> }
        expect(updatedBody.lanes.find((lane) => lane.id === "goals")?.cards[0]?.title).toBe("Updated goal")

        const removed = await app.request(`/goal/${goal!.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(removed.status).toBe(200)

        const afterDelete = await app.request(`/task/${task_id}/board`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const deletedBody = (await afterDelete.json()) as { lanes: Array<{ id: string; cards: unknown[] }> }
        expect(deletedBody.lanes.find((lane) => lane.id === "goals")?.cards.length).toBe(0)
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task accepts a registered custom executor", async () => {
    await using tmp = await tmpdir({ git: true })
    const calls: string[] = []
    const codex: ExecutorAdapter = {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      async submit(input: { sessionID: string; prompt: string; priority?: "high" | "normal" | "low" }) {
        calls.push(input.prompt)
        return {
          sessionID: input.sessionID,
          queueTaskID: Identifier.ascending("task"),
        }
      },
      async status(queueTaskID: string) {
        return {
          queueTaskID,
          status: "queued",
          error: null,
        }
      },
      async abort() {
        return true
      },
      async delivery() {
        return {
          summary: "done",
          diffs: [],
        }
      },
      async resume(input: { sessionID: string; message: string; priority?: "high" | "normal" | "low" }) {
        return this.submit({
          sessionID: input.sessionID,
          prompt: input.message,
          priority: input.priority,
        })
      },
      async *events() {},
    }
    ExecutorRegistry.register("codex", codex)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            executor: "codex",
            request: "implement feature y",
          }),
        })

        expect(response.status).toBe(202)
        const body = (await response.json()) as { task_id: string }
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, body.task_id)).get(),
        )
        expect(run?.executor).toBe("codex")
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("implement feature y")
  })

  test("POST /task returns 400 when executor is not registered", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            executor: "codex",
            request: "implement feature z",
          }),
        })

        expect(response.status).toBe(400)
        expect(await response.text()).toContain("executor not configured: codex")
      },
    })
  })
})
