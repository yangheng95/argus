import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import {
  OrchestratorChannelBindingTable,
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Database, and, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const slackMock = {
  postMessage: async (_input: { channel: string; thread_ts: string; text: string }) => ({ ok: true }),
}

mock.module("@slack/bolt", () => ({
  App: class {
    client = {
      chat: {
        postMessage: (input: { channel: string; thread_ts: string; text: string }) => slackMock.postMessage(input),
      },
      auth: {
        test: async () => ({ user_id: "UBOT" }),
      },
    }
    message() {}
    async start() {}
    async stop() {}
  },
}))

describe("channel.slack", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("root Slack message creates task and binding", async () => {
    await using tmp = await tmpdir({ git: true })
    const { SlackGateway } = await import("../../src/channel/slack")
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    const posted: Array<{ channel: string; thread_ts: string; text: string }> = []
    slackMock.postMessage = async (input) => {
      posted.push(input)
      return { ok: true }
    }
    const gateway = new SlackGateway({
      directory: tmp.path,
      token: "xoxb-test",
      appToken: "xapp-test",
    })
    ;(gateway as any).startedAt = "0"

    await (gateway as any).handleMessage({
      channel: "C1",
      ts: "1.01",
      thread_ts: undefined,
      user: "U1",
      text: "implement this feature",
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const task = Database.use((db) => db.select().from(OrchestratorTaskTable).get())
        const binding = Database.use((db) => db.select().from(OrchestratorChannelBindingTable).get())
        expect(task?.source).toBe("slack")
        expect(binding?.platform).toBe("slack")
        expect(binding?.channel).toBe("C1")
        expect(binding?.thread).toBe("1.01")
      },
    })

    expect(posted.length).toBe(1)
    expect(posted[0]?.text).toContain("Task accepted:")
  })

  test("thread reply answers pending permission interaction", async () => {
    await using tmp = await tmpdir({ git: true })
    const { SlackGateway } = await import("../../src/channel/slack")
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "queued",
      error: null,
    })

    const posted: Array<{ channel: string; thread_ts: string; text: string }> = []
    slackMock.postMessage = async (input) => {
      posted.push(input)
      return { ok: true }
    }
    const gateway = new SlackGateway({
      directory: tmp.path,
      token: "xoxb-test",
      appToken: "xapp-test",
    })
    ;(gateway as any).startedAt = "0"

    let pending: Promise<void> | undefined
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "need permission",
          source: "slack",
          channelBinding: {
            platform: "slack",
            channel: "C2",
            thread: "2.01",
          },
        })
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        pending = PermissionNext.ask({
          sessionID: task!.session_id!,
          permission: "bash",
          patterns: ["echo *"],
          metadata: {},
          always: ["echo *"],
          ruleset: [
            {
              permission: "bash",
              pattern: "*",
              action: "ask",
            },
          ],
        })
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const interaction = Database.use((db) =>
          db
            .select()
            .from(OrchestratorInteractionRequestTable)
            .where(
              and(
                eq(OrchestratorInteractionRequestTable.request_type, "permission"),
                eq(OrchestratorInteractionRequestTable.status, "pending"),
              ),
            )
            .get(),
        )
        expect(interaction?.status).toBe("pending")
      },
    })

    await (gateway as any).handleMessage({
      channel: "C2",
      ts: "2.02",
      thread_ts: "2.01",
      user: "U2",
      text: "allow",
    })

    await pending

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const interaction = Database.use((db) =>
          db
            .select()
            .from(OrchestratorInteractionRequestTable)
            .where(eq(OrchestratorInteractionRequestTable.request_type, "permission"))
            .get(),
        )
        expect(interaction?.status).toBe("answered")
      },
    })

    expect(posted.at(-1)?.text).toContain("Permission reply recorded")
  })

  test("publishes orchestrator events to bound Slack thread", async () => {
    await using tmp = await tmpdir({ git: true })
    const { SlackGateway } = await import("../../src/channel/slack")
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    const posted: Array<{ channel: string; thread_ts: string; text: string }> = []
    slackMock.postMessage = async (input) => {
      posted.push(input)
      return { ok: true }
    }
    const gateway = new SlackGateway({
      directory: tmp.path,
      token: "xoxb-test",
      appToken: "xapp-test",
    })

    let taskID = ""
    let runID = ""
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        taskID = await OrchestratorService.createTask({
          request: "event target",
          source: "slack",
          channelBinding: {
            platform: "slack",
            channel: "C3",
            thread: "3.01",
          },
        })
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get(),
        )
        runID = run!.id
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        ;(gateway as any).subscribeEvents()
        await Bus.publish(OrchestratorEvent.EvaluationCompleted, {
          taskID,
          runID,
          evaluationID: Identifier.ascending("evaluation"),
          status: "passed",
          verdict: "accepted",
          summary: "All checks passed",
        })
      },
    })

    expect(posted.at(-1)?.channel).toBe("C3")
    expect(posted.at(-1)?.thread_ts).toBe("3.01")
    expect(posted.at(-1)?.text).toContain("Evaluation accepted")

    await gateway.stop()
  })
})
