import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import { OrchestratorProtocol } from "../../src/orchestrator/protocol"
import {
  OrchestratorChannelBindingTable,
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { PermissionNext } from "../../src/permission/next"
import { ControlMessage } from "../../src/control"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { SpecService } from "../../src/spec/service"
import { Database, and, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function stub() {
  spyOn(SpecService, "initial").mockResolvedValue({
    summary: "Implement feature",
    content: "# Scope\n\nImplement the requested change.",
    goals: [
      {
        description: "Implement the requested change",
        criteria: "The requested change is implemented and checks pass.",
        priority: "blocking",
      },
    ],
    assumptions: [],
    risks: [],
    spec_items: [],
    evidence_sources: [],
    unresolved_questions: [],
  })
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
}

const slackMock = {
  postMessage: async (_input: { channel: string; thread_ts: string; text: string }) => ({ ok: true }),
  uploadV2: async (_input: { channel_id: string; thread_ts: string; file_uploads: Array<{ filename?: string }> }) => ({ ok: true }),
}

mock.module("@slack/bolt", () => ({
  App: class {
    client = {
      chat: {
        postMessage: (input: { channel: string; thread_ts: string; text: string }) => slackMock.postMessage(input),
      },
      files: {
        uploadV2: (input: { channel_id: string; thread_ts: string; file_uploads: Array<{ filename?: string }> }) =>
          slackMock.uploadV2(input),
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
    stub()
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    const posted: Array<{ channel: string; thread_ts: string; text: string }> = []
    slackMock.postMessage = async (input) => {
      posted.push(input)
      return { ok: true }
    }
    spyOn(ControlMessage, "handle").mockImplementation(async (input) => {
      const taskID = await OrchestratorService.createTask({
        request: input.text,
        source: "slack",
        channelBinding: {
          platform: "slack",
          channel: input.channel!,
          thread: input.thread!,
          payload: input.metadata ?? {},
        },
        metadata: input.metadata,
      })
      return {
        kind: "created" as const,
        task_id: taskID,
        message: `Task accepted: \`${taskID}\``,
      }
    })
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
    stub()
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
    spyOn(ControlMessage, "handle").mockImplementation(async (input) => {
      const interaction = Database.use((db) =>
        db
          .select()
          .from(OrchestratorInteractionRequestTable)
          .where(
            and(
              eq(OrchestratorInteractionRequestTable.task_id, input.taskID!),
              eq(OrchestratorInteractionRequestTable.status, "pending"),
            ),
          )
          .get(),
      )
      if (interaction) {
        await OrchestratorService.replyInteraction(interaction.id, { reply: "once" })
        return {
          kind: "interaction" as const,
          task_id: interaction.task_id,
          interaction_id: interaction.id,
          message: "Permission reply recorded: `once`.",
        }
      }
      return {
        kind: "panel_response" as const,
        message: "No interaction.",
      }
    })
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
        let interaction = Database.use((db) =>
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
        for (const _ of Array.from({ length: 20 })) {
          if (interaction) break
          await Bun.sleep(25)
          interaction = Database.use((db) =>
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
        }
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

    expect(posted.at(-1)?.text).toContain("Permission granted")
  })

  test("publishes orchestrator events to bound Slack thread", async () => {
    await using tmp = await tmpdir({ git: true })
    const { SlackGateway } = await import("../../src/channel/slack")
    stub()
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
        await OrchestratorProtocol.emit(OrchestratorEvent.EvaluationCompleted, {
          taskID,
          runID,
          evaluationID: Identifier.ascending("evaluation"),
          status: "passed",
          verdict: "accepted",
          summary: "All checks passed",
        }, { source: "test.slack" })
      },
    })

    expect(posted.at(-1)?.channel).toBe("C3")
    expect(posted.at(-1)?.thread_ts).toBe("3.01")
    expect(posted.at(-1)?.text).toContain("accepted")

    await gateway.stop()
  })

  test("uploads screenshot attachments to the Slack thread", async () => {
    await using tmp = await tmpdir({ git: true })
    const { SlackGateway } = await import("../../src/channel/slack")

    const posted: Array<{ channel: string; thread_ts: string; text: string }> = []
    const uploads: Array<{ channel_id: string; thread_ts: string; file_uploads: Array<{ filename?: string }> }> = []
    slackMock.postMessage = async (input) => {
      posted.push(input)
      return { ok: true }
    }
    slackMock.uploadV2 = async (input) => {
      uploads.push(input)
      return { ok: true }
    }
    spyOn(ControlMessage, "handle").mockResolvedValue({
      kind: "panel_response",
      message: "Captured OpenCorvus GUI.",
      attachments: [{
        mime: "image/png",
        filename: "opencorvus-gui.png",
        url: "data:image/png;base64,aGVsbG8=",
      }],
    })

    const gateway = new SlackGateway({
      directory: tmp.path,
      token: "xoxb-test",
      appToken: "xapp-test",
    })
    ;(gateway as any).startedAt = "0"

    await (gateway as any).handleMessage({
      channel: "C4",
      ts: "4.01",
      thread_ts: undefined,
      user: "U4",
      text: "send me an OpenCorvus screenshot",
    })

    expect(posted).toHaveLength(1)
    expect(posted[0]?.text).toBe("Captured OpenCorvus GUI.")
    expect(uploads).toHaveLength(1)
    expect(uploads[0]?.channel_id).toBe("C4")
    expect(uploads[0]?.thread_ts).toBe("4.01")
    expect(uploads[0]?.file_uploads[0]?.filename).toBe("opencorvus-gui.png")
  })
})
