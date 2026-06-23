import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { ControlMessage, ControlTimeline } from "../../src/control"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("control timeline", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("task-scoped control messages persist user command and assistant response after temporary session cleanup", async () => {
    mock.module("@/agent/model", () => ({
      resolveAgentModelRef: async () => ({
        id: "control",
        providerID: "mock-control",
        api: { id: "control" },
      }),
    }))
    spyOn(Agent, "defaultAgent").mockResolvedValue({
      name: "control",
      mode: "primary",
      options: {},
    })

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "timeline root" })
        const taskID = Identifier.ascending("task")
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "timeline task",
              request: "timeline task",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        let controlSessionID = ""
        spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
          controlSessionID = input.sessionID
          return {
            info: {
              id: Identifier.ascending("message"),
              sessionID: input.sessionID,
              role: "assistant",
              structured: {
                kind: "message",
                message: "已记录任务消息。",
                task_id: taskID,
              },
              time: {
                created: now,
                completed: now,
              },
              agent: "control",
              providerID: "mock-control",
              modelID: "control",
              cost: 0,
              tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              path: { cwd: tmp.path, root: tmp.path },
            },
            parts: [],
          } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
        })

        const result = await ControlMessage.handle({
          surface: "panel",
          taskID,
          text: "继续这个任务，先检查日志。",
          metadata: {
            ui_context: "task_thread",
          },
        })

        expect(result.kind).toBe("message")
        await expect(Session.get(controlSessionID)).rejects.toThrow()

        const timeline = ControlTimeline.list({ taskID })
        expect(timeline.map((item) => item.info.role)).toEqual(["user", "assistant"])
        expect(timeline.map((item) => item.parts[0]?.type)).toEqual(["text", "text"])
        expect(timeline.map((item) => item.parts[0]?.text)).toEqual(["继续这个任务，先检查日志。", "已记录任务消息。"])
        expect(timeline.every((item) => item.info.taskID === taskID)).toBe(true)
        expect(timeline.every((item) => item.info.sessionID === root.id)).toBe(true)
      },
    })
  })
})
