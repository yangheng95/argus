import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineChannelBindingTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { PanelTool } from "../../src/tool/panel"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function ctx(extra: Record<string, unknown>) {
  return {
    sessionID: Identifier.ascending("session"),
    messageID: Identifier.ascending("message"),
    agent: "control",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
    extra,
  }
}

describe("panel.create_task channel binding", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("persists server-derived channel binding when tool params omit binding identity", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PanelTool.init()
        const result = await tool.execute(
          {
            action: "create_task",
            request: "Original user input: build the channel task.",
            queue: true,
            metadata: { user_id: "U1" },
          },
          ctx({
            surface: "slack",
            source: "channel:slack",
            channelBinding: {
              platform: "slack",
              channel: "C-root",
              thread: "T-root",
            },
          }),
        )

        const taskID = (JSON.parse(result.output) as { task_id: string }).task_id
        const binding = Database.use((db) =>
          db
            .select()
            .from(EngineChannelBindingTable)
            .where(eq(EngineChannelBindingTable.task_id, taskID))
            .get(),
        )
        expect(binding).toMatchObject({
          task_id: taskID,
          platform: "slack",
          channel: "C-root",
          thread: "T-root",
          payload: { user_id: "U1" },
        })
      },
    })
  }, 25_000)

  test("rejects conflicting model-supplied identity before task creation", async () => {
    const createSpy = spyOn(EngineService, "createTask").mockResolvedValue("task_never_created")
    const tool = await PanelTool.init()

    await expect(
      tool.execute(
        {
          action: "create_task",
          request: "Original user input: conflict.",
          queue: true,
          platform: "telegram",
          channel: "chat-2",
          thread: "thread-2",
        },
        ctx({
          surface: "slack",
          channelBinding: {
            platform: "slack",
            channel: "C-root",
            thread: "T-root",
          },
        }),
      ),
    ).rejects.toThrow("channel binding conflict")

    expect(createSpy).not.toHaveBeenCalled()
  })

  test("rejects partial explicit channel identity before task creation", async () => {
    const createSpy = spyOn(EngineService, "createTask").mockResolvedValue("task_never_created")
    const tool = await PanelTool.init()

    await expect(
      tool.execute(
        {
          action: "create_task",
          request: "Original user input: partial.",
          queue: true,
          platform: "slack",
        },
        ctx({ surface: "panel" }),
      ),
    ).rejects.toThrow("requires platform, channel, and thread together")

    expect(createSpy).not.toHaveBeenCalled()
  })

  test("preserves complete explicit binding for non-channel tool contexts", async () => {
    const createSpy = spyOn(EngineService, "createTask").mockResolvedValue("task_created")
    const tool = await PanelTool.init()

    await tool.execute(
      {
        action: "create_task",
        request: "Original user input: explicit.",
        queue: true,
        platform: "discord",
        channel: "guild-channel",
        thread: "thread-1",
        metadata: { source_user: "U2" },
      },
      ctx({ surface: "panel" }),
    )

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy.mock.calls[0]?.[0]).toMatchObject({
      channelBinding: {
        platform: "discord",
        channel: "guild-channel",
        thread: "thread-1",
        payload: { source_user: "U2" },
      },
    })
  })
})
