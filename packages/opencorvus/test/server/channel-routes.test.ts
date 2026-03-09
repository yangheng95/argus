import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import { OrchestratorChannelBindingTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SessionSummary } from "../../src/session/summary"
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
  beforeEach(() => {
    spyOn(SessionSummary, "summarize").mockResolvedValue(undefined as never)
  })

  afterEach(async () => {
    mock.restore()
    delete process.env.OPENCORVUS_WORKBENCH_LLM
    delete process.env.OPENCORVUS_PUBLIC_URL
    delete process.env.OPENCORVUS_PUBLIC_URL_SECRET
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
        const channel = binding?.payload?.channel as { user_id?: string } | undefined
        expect(channel?.user_id).toBe("user-1")
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
        expect(body.message).toContain("Intent analysis failed")

        const brief = await app.request(`/task/${task_id}/brief`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(brief.status).toBe(200)
        const briefBody = (await brief.json()) as { content: string }
        expect(briefBody.content).not.toContain("style: concise")
        expect(briefBody.content).not.toContain("lockfile_policy: avoid_changes")
        expect(briefBody.content).toContain("Please keep updates concise")
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
        expect(body.kind).toBe("panel_response")
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

  test("POST /channel/message accepts mainstream non-legacy channel platforms", async () => {
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
            platform: "feishu",
            channel: "chat-9",
            thread: "root-9",
            text: "Create a task to wire channel screenshots into the control plane.",
            user_id: "ou_xxx",
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; task_id: string }
        expect(body.kind).toBe("created")

        const binding = Database.use((db) =>
          db
            .select()
            .from(OrchestratorChannelBindingTable)
            .where(eq(OrchestratorChannelBindingTable.task_id, body.task_id))
            .get(),
        )
        expect(binding?.platform).toBe("feishu")
        expect(binding?.channel).toBe("chat-9")
        expect(binding?.thread).toBe("root-9")
      },
    })
  })

  test("POST /channel/attachment publishes signed URLs for remote screenshot delivery", async () => {
    await using tmp = await tmpdir({ git: true })
    process.env.OPENCORVUS_PUBLIC_URL = "https://public.opencorvus.dev"
    process.env.OPENCORVUS_PUBLIC_URL_SECRET = "secret-key"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/channel/attachment", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            mime: "image/png",
            filename: "overlay.png",
            data: Buffer.from("hello").toString("base64"),
          }),
        })

        expect(created.status).toBe(200)
        const body = (await created.json()) as {
          id: string
          url: string
          filename: string
          mime: string
          expires_at: number
        }
        expect(body.id.startsWith("att_")).toBe(true)
        expect(body.url.startsWith("https://public.opencorvus.dev/channel/attachment/")).toBe(true)
        expect(body.filename).toBe("overlay.png")
        expect(body.mime).toBe("image/png")
        expect(body.expires_at).toBeGreaterThan(Date.now())

        const signed = new URL(body.url)
        const fetched = await app.request(`${signed.pathname}${signed.search}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(fetched.status).toBe(200)
        expect(fetched.headers.get("content-type")).toBe("image/png")
        expect(await fetched.text()).toBe("hello")
      },
    })
  })
})
