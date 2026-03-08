import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import { OrchestratorChannelBindingTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { installControlModel } from "../control-plane/mock-control-model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function stub() {
  spyOn(PlannerService, "initial").mockResolvedValue({
    summary: "Implement feature",
    prompt: "Do the work",
    goals: [
      {
        description: "Implement the requested change",
        criteria: "The requested change is implemented and checks pass.",
        priority: "blocking",
      },
    ],
    metadata: {
      strategy: "initial",
      steps: ["Implement the requested change"],
      clarification: undefined,
      spec_analysis: undefined,
    },
  })
  spyOn(OpencodeExecutor, "status").mockImplementation(async (queueTaskID) => ({
    queueTaskID,
    status: "running",
    error: null,
  }))
}

describe("channel routes", () => {
  afterEach(async () => {
    mock.restore()
    delete process.env.OPENCORVUS_WORKBENCH_LLM
    await resetDatabase()
  })

  test("POST /channel/message creates a bound task from a channel thread", async () => {
    await using tmp = await tmpdir({ git: true })
    stub()
    installControlModel()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/channel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            platform: "discord",
            channel: "room-1",
            thread: "thread-1",
            text: "Create a task to ship the settings panel improvements.",
            request_id: "req-channel-1",
            user_id: "user-1",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; task_id: string; message: string }
        expect(body.kind).toBe("created")
        expect(body.message).toContain("Task accepted:")

        const task = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, body.task_id))
            .get(),
        )
        const binding = Database.use((db) =>
          db
            .select()
            .from(OrchestratorChannelBindingTable)
            .where(eq(OrchestratorChannelBindingTable.task_id, body.task_id))
            .get(),
        )
        expect(task?.source).toBe("channel:discord")
        expect(task?.request_id).toBe("req-channel-1")
        expect(binding?.platform).toBe("discord")
        expect(binding?.channel).toBe("room-1")
        expect(binding?.thread).toBe("thread-1")
        expect(binding?.payload?.user_id).toBe("user-1")
      },
    })
  })

  test("POST /channel/message routes free-form follow-up text into board controls", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_WORKBENCH_LLM = "0"
    stub()
    installControlModel()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/channel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            platform: "discord",
            channel: "room-2",
            thread: "thread-2",
            text: "Create a task to implement feature x.",
            user_id: "user-2",
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }

        const response = await app.request("/channel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            platform: "discord",
            channel: "room-2",
            thread: "thread-2",
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            user_id: "user-2",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; message: string }
        expect(body.kind).toBe("message")
        expect(body.message).toContain("Preference saved")

        const brief = await app.request(`/task/${task_id}/brief`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(brief.status).toBe(200)
        const briefBody = (await brief.json()) as { content: string }
        expect(briefBody.content).toContain("style: concise")
        expect(briefBody.content).toContain("lockfile_policy: avoid_changes")
      },
    })
  })

  test("POST /channel/message can refuse implicit task creation", async () => {
    await using tmp = await tmpdir({ git: true })
    stub()
    installControlModel()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/channel/message", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            platform: "discord",
            channel: "room-3",
            thread: "thread-3",
            text: "follow up without a bound task",
            allow_create: false,
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; message: string }
        expect(body.kind).toBe("ignored")
        expect(body.message).toContain("No task is bound")

        const tasks = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.project_id, Instance.project.id)).all(),
        )
        expect(tasks).toHaveLength(0)
      },
    })
  })

  test("POST /channel/message preserves source for follow-up task messages", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_WORKBENCH_LLM = "0"
    stub()
    installControlModel()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const seen: string[] = []
        const unsub = Bus.subscribe(OrchestratorEvent.TaskMessageRecorded, (event) => {
          seen.push(event.properties.source)
        })

        try {
          await app.request("/channel/message", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({
              platform: "slack",
              channel: "room-4",
              thread: "thread-4",
              text: "Create a task to implement feature y.",
              request_id: "req-slack-1",
              source: "slack",
              user_id: "user-4",
            }),
          })

          const response = await app.request("/channel/message", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({
              platform: "slack",
              channel: "room-4",
              thread: "thread-4",
              text: "keep updates concise",
              request_id: "req-slack-2",
              source: "slack",
              user_id: "user-4",
            }),
          })

          expect(response.status).toBe(200)
          expect(seen).toContain("slack")
        } finally {
          unsub()
        }
      },
    })
  })
})
