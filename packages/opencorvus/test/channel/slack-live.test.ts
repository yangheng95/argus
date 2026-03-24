import { afterEach, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { SlackGateway } from "../../src/channel/slack"
import { Identifier } from "../../src/id/id"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import { OrchestratorService } from "../../src/orchestrator/service"
import {
  OrchestratorChannelBindingTable,
  OrchestratorInteractionRequestTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { WorkbenchPreferenceTable, WorkbenchBriefSnapshotTable } from "../../src/workbench/workbench.sql"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Database, and, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const hasLiveEnv =
  (process.env.SLACK_BOT_TOKEN?.length ?? 0) > 20 &&
  (process.env.SLACK_APP_TOKEN?.length ?? 0) > 20 &&
  (process.env.SLACK_CHANNEL_ID?.length ?? 0) > 5
const hasUserToken = (process.env.SLACK_USER_TOKEN?.length ?? 0) > 20

const enabled = process.env.OPENCORVUS_RUN_LIVE_SLACK_TEST === "1"
const extended = process.env.OPENCORVUS_RUN_LIVE_SLACK_EXTENDED_TEST === "1"
const live = hasLiveEnv && enabled ? test : test.skip
const inbound = hasLiveEnv && hasUserToken && enabled ? test : test.skip
const inboundExtended = hasLiveEnv && hasUserToken && enabled && extended ? test : test.skip

afterEach(async () => {
  await resetDatabase().catch(() => undefined)
})

live("authenticates against real Slack APIs", async () => {
  const bot = process.env.SLACK_BOT_TOKEN!
  const app = process.env.SLACK_APP_TOKEN!

  const auth = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bot}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  }).then((res) => res.json() as Promise<{ ok: boolean; error?: string }>)

  expect(auth.ok).toBe(true)

  const socket = await fetch("https://slack.com/api/apps.connections.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${app}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "",
  }).then((res) => res.json() as Promise<{ ok: boolean; url?: string; error?: string }>)

  expect(socket.ok).toBe(true)
  expect(typeof socket.url).toBe("string")
})

live("starts and stops Slack gateway with real credentials", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    init: InstanceBootstrap,
    fn: async () => {
      const gateway = new SlackGateway({
        directory: tmp.path,
        token: process.env.SLACK_BOT_TOKEN!,
        appToken: process.env.SLACK_APP_TOKEN!,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
      })

      await gateway.start()
      await Bun.sleep(1000)
      await gateway.stop()

      expect(true).toBe(true)
    },
  })
})

live("delivers orchestrator event to a real Slack thread", async () => {
  await using tmp = await tmpdir({ git: true })
  const token = process.env.SLACK_BOT_TOKEN!
  const channel = process.env.SLACK_CHANNEL_ID!
  const gateway = new SlackGateway({
    directory: tmp.path,
    token,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  })

  const root = await slackJson("chat.postMessage", {
    channel,
    text: `Codex live Slack test ${new Date().toISOString()}`,
  })
  expect(root.ok).toBe(true)
  expect(typeof root.ts).toBe("string")
  const rootTs = root.ts!

  const taskID = Identifier.ascending("task")
  const runID = Identifier.ascending("run")

  try {
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await gateway.start()
        const now = Date.now()
        Database.use((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "slack",
              title: "Live Slack test",
              request: "Verify outbound Slack event delivery",
              status: "running",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorChannelBindingTable)
            .values({
              id: Identifier.ascending("binding"),
              task_id: taskID,
              platform: "slack",
              channel,
              thread: rootTs,
              payload: {},
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        await Bus.publish(OrchestratorEvent.EvaluationCompleted, {
          taskID,
          runID,
          evaluationID: Identifier.ascending("evaluation"),
          status: "passed",
          verdict: "accepted",
          summary: "Live outbound Slack event delivery works",
        })
      },
    })

    await Bun.sleep(4000)
    const replies = await slackForm("conversations.replies", {
      channel,
      ts: rootTs,
    })
    expect(replies.ok).toBe(true)
    expect(Array.isArray(replies.messages)).toBe(true)
    const texts = (replies.messages ?? [])
      .map((item) => item.text)
      .filter((item): item is string => typeof item === "string" && item.length > 0)
    expect(texts.some((item) => item.includes("Evaluation accepted: Live outbound Slack event delivery works"))).toBe(true)

    for (const item of replies.messages ?? []) {
      if (!item?.ts) continue
      const deleted = await slackJson("chat.delete", {
        channel,
        ts: item.ts,
      })
      expect(deleted.ok).toBe(true)
    }
  } finally {
    await gateway.stop().catch(() => undefined)
  }
})

async function slackJson(method: string, body: Record<string, unknown>) {
  return slackJsonWith(process.env.SLACK_BOT_TOKEN!, method, body)
}

async function slackJsonWith(token: string, method: string, body: Record<string, unknown>) {
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  }).then((res) => res.json() as Promise<{ ok: boolean; ts?: string; error?: string }>)
}

async function slackForm(method: string, body: Record<string, string>) {
  const token = process.env.SLACK_BOT_TOKEN!
  const params = new URLSearchParams(body)
  return fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  }).then((res) => res.json() as Promise<{ ok: boolean; messages?: Array<{ ts?: string; text?: string }>; error?: string }>)
}

inbound("answers a real Slack permission interaction from the thread", async () => {
  await using tmp = await tmpdir({ git: true })
  const bot = process.env.SLACK_BOT_TOKEN!
  const user = process.env.SLACK_USER_TOKEN!
  const channel = process.env.SLACK_CHANNEL_ID!
  const marker = `codex-live-interaction-${Date.now()}`
  const gateway = new SlackGateway({
    directory: tmp.path,
    token: bot,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  })

  let rootTs = ""
  let task: typeof OrchestratorTaskTable.$inferSelect | undefined
  let resolved = false

  try {
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await gateway.start()
        await Bun.sleep(2000)

        const root = await slackJsonWith(user, "chat.postMessage", {
          channel,
          text: marker,
        })
        expect(root.ok).toBe(true)
        expect(typeof root.ts).toBe("string")
        rootTs = root.ts!

        const taskDeadline = Date.now() + 20_000
        while (Date.now() < taskDeadline) {
          await Bun.sleep(1000)
          const tasks = Database.use((db) => db.select().from(OrchestratorTaskTable).all())
          const found = tasks.find((item) => item.source === "slack" && item.request.includes(marker))
          if (!found?.session_id) continue
          task = found
          break
        }

        expect(task?.session_id).toBeDefined()

        const pending = PermissionNext.ask({
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
        }).then(() => {
          resolved = true
        })

        const interactionDeadline = Date.now() + 20_000
        let interaction: typeof OrchestratorInteractionRequestTable.$inferSelect | undefined
        while (Date.now() < interactionDeadline) {
          await Bun.sleep(1000)
          const found = Database.use((db) =>
            db
              .select()
              .from(OrchestratorInteractionRequestTable)
              .where(
                and(
                  eq(OrchestratorInteractionRequestTable.task_id, task!.id),
                  eq(OrchestratorInteractionRequestTable.request_type, "permission"),
                  eq(OrchestratorInteractionRequestTable.status, "pending"),
                ),
              )
              .get(),
          )
          if (!found) continue
          interaction = found
          break
        }

        expect(interaction?.status).toBe("pending")

        const reply = await slackJsonWith(user, "chat.postMessage", {
          channel,
          thread_ts: rootTs,
          text: "allow",
        })
        expect(reply.ok).toBe(true)

        const resolvedDeadline = Date.now() + 15_000
        while (Date.now() < resolvedDeadline && !resolved) {
          await Bun.sleep(500)
        }
        await pending

        const final = Database.use((db) =>
          db
            .select()
            .from(OrchestratorInteractionRequestTable)
            .where(
              and(
                eq(OrchestratorInteractionRequestTable.task_id, task!.id),
                eq(OrchestratorInteractionRequestTable.request_type, "permission"),
              ),
            )
            .get(),
        )
        expect(final?.status).toBe("answered")

        const replies = await slackForm("conversations.replies", {
          channel,
          ts: rootTs,
        })
        expect(replies.ok).toBe(true)
        const texts = (replies.messages ?? [])
          .map((item) => item.text)
          .filter((item): item is string => typeof item === "string" && item.length > 0)
        expect(texts.some((item) => item.includes("Input requested: Permission: bash"))).toBe(true)
      },
    })
  } finally {
    await gateway.stop().catch(() => undefined)
    if (rootTs) {
      const replies = await slackForm("conversations.replies", { channel, ts: rootTs }).catch(() => ({ messages: [] }))
      for (const item of replies.messages ?? []) {
        if (!item?.ts) continue
        const token = item.ts === rootTs ? user : bot
        await slackJsonWith(token, "chat.delete", { channel, ts: item.ts }).catch(() => undefined)
      }
    }
  }
})

inboundExtended("stores free-form preference from a real Slack thread message", async () => {
  await using tmp = await tmpdir({ git: true })
  const bot = process.env.SLACK_BOT_TOKEN!
  const user = process.env.SLACK_USER_TOKEN!
  const channel = process.env.SLACK_CHANNEL_ID!
  const marker = `codex-live-preference-${Date.now()}`
  const gateway = new SlackGateway({
    directory: tmp.path,
    token: bot,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  })

  let rootTs = ""
  let taskID = ""

  try {
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await gateway.start()
      },
    })
    await Bun.sleep(2000)

    const root = await slackJsonWith(user, "chat.postMessage", {
      channel,
      text: marker,
    })
    expect(root.ok).toBe(true)
    expect(typeof root.ts).toBe("string")
    rootTs = root.ts!

    taskID = await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () =>
        OrchestratorService.createTask({
          project: Instance.project.id,
          request: "Live Slack preference update test",
          source: "slack",
          channelBinding: {
            platform: "slack",
            channel,
            thread: rootTs,
          },
          metadata: {
            slack: {
              user: "U-PREF",
            },
          },
        }),
    })

    const reply = await slackJsonWith(user, "chat.postMessage", {
      channel,
      thread_ts: rootTs,
      text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
    })
    expect(reply.ok).toBe(true)

    const deadline = Date.now() + 20_000
    let pref = undefined as typeof WorkbenchPreferenceTable.$inferSelect | undefined
    let brief = undefined as typeof WorkbenchBriefSnapshotTable.$inferSelect | undefined
    while (Date.now() < deadline) {
      await Bun.sleep(1000)
      const found = await Instance.provide({
        directory: tmp.path,
        init: InstanceBootstrap,
        fn: async () => {
          const prefRow = Database.use((db) =>
            db
              .select()
              .from(WorkbenchPreferenceTable)
              .where(eq(WorkbenchPreferenceTable.task_id, taskID))
              .all()
              .find((item) => item.key === "lockfile_policy"),
          )
          const briefRow = Database.use((db) =>
            db
              .select()
              .from(WorkbenchBriefSnapshotTable)
              .where(eq(WorkbenchBriefSnapshotTable.task_id, taskID))
              .orderBy(WorkbenchBriefSnapshotTable.time_created)
              .all()
              .at(-1),
          )
          return {
            prefRow,
            briefRow,
          }
        },
      })
      if (!found.prefRow || !found.briefRow) continue
      pref = found.prefRow
      brief = found.briefRow
      break
    }

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await OrchestratorService.getBrief({ taskID })
      },
    })
    brief = await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () =>
        Database.use((db) =>
          db
            .select()
            .from(WorkbenchBriefSnapshotTable)
            .where(eq(WorkbenchBriefSnapshotTable.task_id, taskID))
            .orderBy(WorkbenchBriefSnapshotTable.time_created)
            .all()
            .at(-1),
        ),
    })

    expect(pref?.value).toBe("avoid_changes")
    expect(brief?.content).toContain("lockfile_policy: avoid_changes")
  } finally {
    await gateway.stop().catch(() => undefined)
    if (rootTs) {
      const replies = await slackForm("conversations.replies", { channel, ts: rootTs }).catch(() => ({ messages: [] }))
      for (const item of replies.messages ?? []) {
        if (!item?.ts) continue
        const token = item.ts === rootTs ? user : bot
        await slackJsonWith(token, "chat.delete", { channel, ts: item.ts }).catch(() => undefined)
      }
    }
  }
})
