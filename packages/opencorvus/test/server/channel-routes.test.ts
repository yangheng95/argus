import { afterEach, beforeEach, describe, expect, mock, setDefaultTimeout, spyOn, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Bus } from "../../src/bus"
import { parseSSE } from "../../src/control-plane/sse"
import { Config } from "../../src/config/config"
import { Database, eq } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { type ExecutorAdapter } from "../../src/executor/contracts"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import * as GuiScreenshot from "../../src/gui/screenshot"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import { OrchestratorProtocol } from "../../src/orchestrator/protocol"
import { ProtocolStore } from "../../src/protocol/store"
import {
  OrchestratorChannelBindingTable,
  OrchestratorInteractionRequestTable,
  OrchestratorPlanVersionTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { ControlMessage } from "../../src/control"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SpecService } from "../../src/spec/service"
import { SessionSummary } from "../../src/session/summary"
import { Log } from "../../src/util/log"
import { installControlModel } from "../control-plane/mock-control-model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })
setDefaultTimeout(60_000)

let configDir = ""
let originalConfigDir: string | undefined

function stub() {
  const goals = [
    {
      description: "Implement the requested change",
      criteria: "The requested change is implemented and checks pass.",
      priority: "blocking" as const,
    },
  ]
  spyOn(SpecService, "initial").mockResolvedValue({
    summary: "Implement feature",
    content: "# Scope\n\nImplement feature",
    requirements: [{
      id: "req_impl",
      title: "Implement the requested change",
      description: "Implement the requested change",
      priority: "blocking",
      acceptance: ["The requested change is implemented and checks pass."],
      evidence_refs: [],
      metadata: { check_selector: ["spec_check"] },
    }],
    assumptions: [],
    risks: [],
    clarifications: [],
    evidence_sources: [],
    unresolved_questions: [],
  })
  spyOn(PlannerService, "initial").mockResolvedValue({
    summary: "Implement feature",
    prompt: "Do the work",
    goals,
    metadata: {
      strategy: "initial",
      steps: ["Implement the requested change"],
      clarification: undefined,
      spec_analysis: undefined,
      waves: goals.map((goal, index) => ({
        title: `Wave ${index + 1}`,
        objective: goal.description,
        goal_indices: [index],
        owned_paths: [`src/goal-${index + 1}.ts`],
      })),
    },
  })
  spyOn(OpencodeExecutor, "status").mockImplementation(async (queueTaskID) => ({
    queueTaskID,
    status: "running",
    error: null,
  }))
}

async function waitForTaskBootstrap(taskID: string, timeoutMs = 5_000) {
  const started = Date.now()
  while ((Date.now() - started) < timeoutMs) {
    const task = Database.use((db) =>
      db
        .select()
        .from(OrchestratorTaskTable)
        .where(eq(OrchestratorTaskTable.id, taskID))
        .get(),
    )
    const plan = task?.active_plan_version_id
      ? Database.use((db) =>
          db
            .select()
            .from(OrchestratorPlanVersionTable)
            .where(eq(OrchestratorPlanVersionTable.id, task.active_plan_version_id!))
            .get(),
        )
      : undefined
    if (task?.session_id && task.active_run_id && plan) return
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for task bootstrap: ${taskID}`)
}

describe("channel routes", () => {
  beforeEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
    ExecutorRegistry.reset()
    Config.global.reset()
    originalConfigDir = process.env.OPENCORVUS_CONFIG_DIR
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-channel-config-"))
    process.env.OPENCORVUS_CONFIG_DIR = configDir
    spyOn(SessionSummary, "summarize").mockResolvedValue(undefined as never)
  })

  afterEach(async () => {
    mock.restore()
    delete process.env.OPENCORVUS_WORKBENCH_LLM
    delete process.env.OPENCORVUS_PUBLIC_URL
    delete process.env.OPENCORVUS_PUBLIC_URL_SECRET
    Config.global.reset()
    if (originalConfigDir === undefined) delete process.env.OPENCORVUS_CONFIG_DIR
    else process.env.OPENCORVUS_CONFIG_DIR = originalConfigDir
    if (configDir) await fs.rm(configDir, { recursive: true, force: true }).catch(() => undefined)
    configDir = ""
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("POST /channel/v1/ingress creates a bound task from a channel thread", async () => {
    await using tmp = await tmpdir({ git: true })
    stub()
    installControlModel()
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const requestID = `req-channel-${suffix}`
    const channelID = `room-${suffix}`
    const threadID = `thread-${suffix}`
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: requestID,
            platform: "discord",
            channel: channelID,
            thread: threadID,
            user: {
              id: "user-1",
            },
            message: {
              text: "Create a task to ship the settings panel improvements.",
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          result: { kind: string; task_id: string; message: string }
        }
        expect(body.result.kind).toBe("created")
        expect(body.result.message).toContain("Task accepted:")

        const task = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, body.result.task_id))
            .get(),
        )
        const binding = Database.use((db) =>
          db
            .select()
            .from(OrchestratorChannelBindingTable)
            .where(eq(OrchestratorChannelBindingTable.task_id, body.result.task_id))
            .get(),
        )
        expect(task?.source).toBe("channel:discord")
        expect(task?.request_id).toBe(requestID)
        expect(binding?.platform).toBe("discord")
        expect(binding?.channel).toBe(channelID)
        expect(binding?.thread).toBe(threadID)
        const channel = binding?.payload?.channel as { user_id?: string } | undefined
        expect(channel?.user_id).toBe("user-1")
      },
    })
  })

  test("POST /channel/v1/ingress routes free-form follow-up text into board controls", async () => {
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
        const created = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-room-2-create",
            platform: "discord",
            channel: "room-2",
            thread: "thread-2",
            user: {
              id: "user-2",
            },
            message: {
              text: "Create a task to implement feature x.",
            },
          }),
        })
        const { result } = (await created.json()) as { result: { task_id: string } }
        const task_id = result.task_id
        await waitForTaskBootstrap(task_id)

        const response = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-room-2-followup",
            platform: "discord",
            channel: "room-2",
            thread: "thread-2",
            user: {
              id: "user-2",
            },
            message: {
              text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { result: { kind: string; message: string } }
        expect(body.result.kind).toBe("message")
        expect(body.result.message).toContain("Intent analysis failed")

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

  test("POST /channel/v1/ingress can refuse implicit task creation", async () => {
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
        const response = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-room-3",
            platform: "discord",
            channel: "room-3",
            thread: "thread-3",
            message: {
              text: "follow up without a bound task",
            },
            context: {
              allow_create: false,
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { result: { kind: string; message: string } }
        expect(body.result.kind).toBe("panel_response")
        expect(body.result.message).toContain("No task is bound")

        const tasks = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.project_id, Instance.project.id)).all(),
        )
        expect(tasks).toHaveLength(0)
      },
    })
  })

  test("POST /channel/v1/ingress preserves source for follow-up task messages", async () => {
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
        const unsub = ProtocolStore.subscribeEvents((event) => {
          if (event.type !== OrchestratorEvent.TaskMessageRecorded.type) return
          const source = typeof event.payload?.source === "string" ? event.payload.source : undefined
          if (source) seen.push(source)
        }, {
          types: [OrchestratorEvent.TaskMessageRecorded.type],
        })

        try {
          const created = await app.request("/channel/v1/ingress", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({
              type: "channel_ingress",
              version: "channel.v1",
              request_id: "req-slack-1",
              platform: "slack",
              channel: "room-4",
              thread: "thread-4",
              message: {
                text: "Create a task to implement feature y.",
              },
              source: "slack",
              user: {
                id: "user-4",
              },
            }),
          })
          const createdBody = await created.json() as { result: { task_id: string } }
          await waitForTaskBootstrap(createdBody.result.task_id)

          const response = await app.request("/channel/v1/ingress", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({
              type: "channel_ingress",
              version: "channel.v1",
              request_id: "req-slack-2",
              platform: "slack",
              channel: "room-4",
              thread: "thread-4",
              message: {
                text: "keep updates concise",
              },
              source: "slack",
              user: {
                id: "user-4",
              },
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

  test("POST /channel/v1/ingress accepts mainstream non-legacy channel platforms", async () => {
    await using tmp = await tmpdir({ git: true })
    stub()
    installControlModel()
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const requestID = `req-feishu-${suffix}`
    const channelID = `chat-${suffix}`
    const threadID = `root-${suffix}`
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: requestID,
            platform: "feishu",
            channel: channelID,
            thread: threadID,
            user: {
              id: "ou_xxx",
            },
            message: {
              text: "Create a task to wire channel screenshots into the control plane.",
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { result: { kind: string; task_id: string } }
        expect(body.result.kind).toBe("created")

        const binding = Database.use((db) =>
          db
            .select()
            .from(OrchestratorChannelBindingTable)
            .where(eq(OrchestratorChannelBindingTable.task_id, body.result.task_id))
            .get(),
        )
        expect(binding?.platform).toBe("feishu")
        expect(binding?.channel).toBe(channelID)
        expect(binding?.thread).toBe(threadID)
      },
    })
  })

  test("POST /channel/v1/ingress routes text to an explicit task context and binds the thread", async () => {
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
        const taskID = await OrchestratorService.createTask({
          request: "implement the channel protocol task flow",
          source: "api",
        })
        const app = Server.App()
        const response = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-v1-1",
            platform: "discord",
            channel: "room-v1",
            thread: "thread-v1",
            user: {
              id: "user-v1",
              name: "Alice",
            },
            message: {
              text: "/plan 先补 SSE 回归",
            },
            context: {
              task_id: taskID,
              allow_create: false,
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
          type: string
          result: { kind: string }
          context: { task_id?: string; bound: boolean }
        }
        expect(body.type).toBe("channel_egress")
        expect(body.result.kind).toBe("message")
        expect(body.context.task_id).toBe(taskID)
        expect(body.context.bound).toBe(true)

        const binding = Database.use((db) =>
          db
            .select()
            .from(OrchestratorChannelBindingTable)
            .where(eq(OrchestratorChannelBindingTable.task_id, taskID))
            .get(),
        )
        expect(binding?.platform).toBe("discord")
        expect(binding?.channel).toBe("room-v1")
        expect(binding?.thread).toBe("thread-v1")

        const state = await app.request("/channel/v1/thread?platform=discord&channel=room-v1&thread=thread-v1", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(state.status).toBe(200)
        const stateBody = await state.json() as {
          binding: { task_id: string } | null
          board: { task: { id: string } } | null
        }
        expect(stateBody.binding?.task_id).toBe(taskID)
        expect(stateBody.board?.task.id).toBe(taskID)
      },
    })
  })

  test("POST /channel/v1/ingress forwards attachments into control message input", async () => {
    await using tmp = await tmpdir({ git: true })
    const handle = spyOn(ControlMessage, "handle").mockResolvedValue({
      kind: "panel_response",
      message: "Attachment noted.",
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-v1-attachment",
            platform: "discord",
            channel: "room-attachment",
            thread: "thread-attachment",
            message: {
              id: "msg-v1",
              text: "请看这个截图然后告诉我下一步",
              attachments: [
                {
                  mime: "image/png",
                  filename: "shot.png",
                  data: Buffer.from("hello").toString("base64"),
                },
              ],
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { result: { message: string } }
        expect(body.result.message).toBe("Attachment noted.")

        const input = handle.mock.calls[0]?.[0] as {
          attachments?: Array<{ mime: string; url: string; filename?: string }>
          metadata?: { channel?: { protocol?: { message_id?: string } } }
        }
        expect(input.attachments?.[0]?.mime).toBe("image/png")
        expect(input.attachments?.[0]?.filename).toBe("shot.png")
        expect(input.attachments?.[0]?.url).toBe(`data:image/png;base64,${Buffer.from("hello").toString("base64")}`)
        expect(input.metadata?.channel?.protocol?.message_id).toBe("msg-v1")
      },
    })
  })

  test("channel.v1 thread selection and task listing expose the current binding", async () => {
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
        const first = await OrchestratorService.createTask({
          request: "first channel task",
          source: "api",
        })
        const second = await OrchestratorService.createTask({
          request: "second channel task",
          source: "api",
        })
        const app = Server.App()
        const selected = await app.request("/channel/v1/thread/select", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            platform: "discord",
            channel: "room-select",
            thread: "thread-select",
            task_id: second,
          }),
        })

        expect(selected.status).toBe(200)
        const selectedBody = await selected.json() as {
          binding: { task_id: string } | null
          board: { task: { id: string } } | null
        }
        expect(selectedBody.binding?.task_id).toBe(second)
        expect(selectedBody.board?.task.id).toBe(second)

        const listed = await app.request("/channel/v1/tasks?platform=discord&channel=room-select&thread=thread-select&limit=10", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(listed.status).toBe(200)
        const listedBody = await listed.json() as {
          binding?: { task_id: string } | null
          board: { tasks: Array<{ task: { id: string } }> }
        }
        expect(listedBody.binding?.task_id).toBe(second)
        expect(listedBody.board.tasks.map((item) => item.task.id)).toContain(first)
        expect(listedBody.board.tasks.map((item) => item.task.id)).toContain(second)
      },
    })
  })

  test("POST /channel/v1/ingress supports plan queries against an explicit task context", async () => {
    await using tmp = await tmpdir({ git: true })
    stub()
    installControlModel()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(GuiScreenshot, "captureWindowScreenshot").mockResolvedValue({
      mime: "image/png",
      filename: "opencorvus-gui.png",
      url: `data:image/png;base64,${Buffer.from("hello").toString("base64")}`,
      title: "OpenCorvus",
      app: "OpenCorvus",
      width: 1280,
      height: 720,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "Validate the channel plan flow.",
          source: "api",
        }, { background: true })
        await waitForTaskBootstrap(taskID)
        const app = Server.App()
        const planned = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-plan-view",
            platform: "discord",
            channel: "room-plan",
            thread: "thread-plan",
            message: {
              text: "view plan",
            },
            context: {
              task_id: taskID,
              allow_create: false,
            },
          }),
        })
        expect(planned.status).toBe(200)
        const plannedBody = await planned.json() as { result: { kind: string; message: string } }
        expect(plannedBody.result.kind).toBe("panel_response")
        expect(plannedBody.result.message).toContain("Plan")
      },
    })
  })

  test("POST /channel/v1/ingress supports screenshot attachments without creating a task", async () => {
    await using tmp = await tmpdir({ git: true })
    stub()
    installControlModel()
    spyOn(GuiScreenshot, "captureWindowScreenshot").mockResolvedValue({
      mime: "image/png",
      filename: "opencorvus-gui.png",
      url: `data:image/png;base64,${Buffer.from("hello").toString("base64")}`,
      title: "OpenCorvus",
      app: "OpenCorvus",
      width: 1280,
      height: 720,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const screenshot = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-plan-shot",
            platform: "discord",
            channel: "room-plan",
            thread: "thread-plan",
            message: {
              text: "send me an OpenCorvus screenshot",
            },
            context: {
              allow_create: false,
            },
          }),
        })
        expect(screenshot.status).toBe(200)
        const screenshotBody = await screenshot.json() as {
          result: { message: string; attachments?: Array<{ filename?: string; mime: string }> }
        }
        expect(screenshotBody.result.message).toContain("Captured OpenCorvus GUI")
        expect(screenshotBody.result.attachments?.[0]?.filename).toBe("opencorvus-gui.png")
        expect(screenshotBody.result.attachments?.[0]?.mime).toBe("image/png")
      },
    })
  })

  test("POST /channel/v1/ingress answers pending permission interactions deterministically", async () => {
    await using tmp = await tmpdir({ git: true })
    stub()
    installControlModel()
    const resolved: Array<{ kind: string; requestID: string }> = []
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
      async submit(input) {
        return {
          sessionID: input.sessionID,
          queueTaskID: Identifier.ascending("task"),
        }
      },
      async status(queueTaskID) {
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
      async resume(input) {
        return this.submit({
          sessionID: input.sessionID,
          prompt: input.message,
          priority: input.priority,
        })
      },
      async *events() {},
      async resolve(input) {
        resolved.push({
          kind: input.kind,
          requestID: input.requestID,
        })
        return true
      },
    }
    ExecutorRegistry.register("codex", codex)

    let interactionID = ""
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "need protocol interaction over channel",
          executor: "codex",
          source: "channel:discord",
          channelBinding: {
            platform: "discord",
            channel: "room-interaction",
            thread: "thread-interaction",
          },
        })
        const task = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, taskID))
            .get(),
        )
        const now = Date.now()
        interactionID = Identifier.ascending("interaction")
        Database.use((db) =>
          db.insert(OrchestratorInteractionRequestTable).values({
            id: interactionID,
            task_id: taskID,
            run_id: task!.active_run_id!,
            session_id: task!.session_id!,
            external_id: "protocol-request-1",
            request_type: "permission",
            status: "pending",
            title: "Permission: bash",
            body: "echo *",
            payload: {
              protocol_request: true,
              request_id: "protocol-request-1",
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            request_id: "req-interaction-allow",
            platform: "discord",
            channel: "room-interaction",
            thread: "thread-interaction",
            metadata: {
              interactionID,
              reply: "once",
            },
            message: {
              text: "allow",
            },
          }),
        })
        expect(response.status).toBe(200)
        const body = await response.json() as { result: { kind: string; message: string } }
        expect(body.result.kind).toBe("interaction")
        expect(body.result.message).toContain("Permission granted")
        expect(resolved).toContainEqual({
          kind: "approval",
          requestID: "protocol-request-1",
        })
      },
    })
  })

  test("GET /channel/v1/thread/events wraps bound task events in channel envelopes", async () => {
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
        const taskID = await OrchestratorService.createTask({
          request: "stream channel thread events",
          source: "channel:discord",
          channelBinding: {
            platform: "discord",
            channel: "room-events",
            thread: "thread-events",
          },
        })
        const app = Server.App()
        const stop = new AbortController()
        const response = await app.request("/channel/v1/thread/events?platform=discord&channel=room-events&thread=thread-events", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
          signal: stop.signal,
        })

        expect(response.status).toBe(200)
        expect(response.body).toBeDefined()

        const seen: unknown[] = []
        try {
          setTimeout(() => {
            void OrchestratorProtocol.emit(OrchestratorEvent.TaskUpdated, {
              taskID,
              status: "running",
              summary: "Task event mirrored to channel",
            }, { source: "test.channel.route" })
          }, 25)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("timed out waiting for channel event"))
            }, 3000)

            void parseSSE(response.body!, stop.signal, (item) => {
              seen.push(item)
              const next = item as { type?: string; event?: { type?: string } }
              if (next.type !== "channel_event") return
              if (next.event?.type !== "task.updated") return
              clearTimeout(timeout)
              resolve()
            }).catch((error) => {
              clearTimeout(timeout)
              reject(error)
            })
          })
        } finally {
          stop.abort()
        }

        expect(seen).toContainEqual(expect.objectContaining({
          type: "channel_event",
          event: expect.objectContaining({
            task_id: taskID,
            type: "task.updated",
            summary: "Task event mirrored to channel",
          }),
        }))
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
