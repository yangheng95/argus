import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
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
        expect(body.content).toContain("User preferences:")
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
})
