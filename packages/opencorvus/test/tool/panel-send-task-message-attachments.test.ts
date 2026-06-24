import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { PanelTool } from "../../src/tool/panel"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: overlay-image-ingestion-fidelity-2026-05-07.md §Fix #3 (codex review).
 *
 * `panel.send_task_message` previously called `EngineService.handleTaskMessage`
 * with only `{text, source, user_id}`, dropping any attachments the
 * control-plane LLM session received. Follow-up screenshots on a bound task
 * disappeared at the control-plane boundary, mirroring the create_task bug.
 * This test asserts attachments are forwarded with the same strict data-URL
 * decoding as create_task.
 */
describe("panel.send_task_message attachment forwarding", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("forwards binary attachments to handleTaskMessage as raw base64", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "channel",
              title: "bound thread",
              request: "see follow-up",
              priority: "normal",
              executor: "opencorvus",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const handleSpy = spyOn(EngineService, "handleTaskMessage").mockResolvedValue({
          kind: "note",
          message: "ok",
          wake_status: "not_woken",
          should_resume: false,
          user_message: { info: { id: "msg" } as never, parts: [] },
        })

        const PNG_BASE64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        const dataUrl = `data:image/png;base64,${PNG_BASE64}`

        const tool = await PanelTool.init()
        await tool.execute(
          {
            action: "send_task_message",
            taskID,
            text: "Take another look.",
            source: "panel",
          },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: {
              surface: "panel",
              attachments: [{ mime: "image/png", url: dataUrl, filename: "follow-up.png" }],
            },
          },
        )

        expect(handleSpy).toHaveBeenCalledTimes(1)
        const args = handleSpy.mock.calls[0]?.[1] as
          | { source?: string; attachments?: Array<{ mime: string; data: string; filename?: string }> }
          | undefined
        expect(args?.source).toBe("panel")
        expect(args?.attachments).toHaveLength(1)
        const att = args!.attachments![0]
        expect(att.mime).toBe("image/png")
        expect(att.filename).toBe("follow-up.png")
        // The strict decoder must produce raw base64 (no `data:...;base64,`
        // prefix) — handleTaskMessage's `Buffer.from(att.data, "base64")` is
        // declared on raw base64 in TaskAttachmentInput.
        expect(att.data).toBe(PNG_BASE64)
      },
    })
  })

  test("rejects non-data-URL attachments instead of writing garbage", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "channel",
              title: "bound thread",
              request: "see follow-up",
              priority: "normal",
              executor: "opencorvus",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const handleSpy = spyOn(EngineService, "handleTaskMessage").mockResolvedValue({
          kind: "note",
          message: "never",
          wake_status: "not_woken",
          should_resume: false,
          user_message: { info: { id: "msg" } as never, parts: [] },
        })

        const tool = await PanelTool.init()
        let thrown: unknown
        try {
          await tool.execute(
            {
              action: "send_task_message",
              taskID,
              text: "Take a look.",
              source: "panel",
            },
            {
              sessionID: Identifier.ascending("session"),
              messageID: Identifier.ascending("message"),
              agent: "panel-test",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              async ask() {},
              extra: {
                surface: "panel",
                attachments: [{ mime: "image/png", url: "/attachment/proj/abc.png", filename: "bad.png" }],
              },
            },
          )
        } catch (err) {
          thrown = err
        }

        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toContain("bad.png")
        expect(handleSpy).not.toHaveBeenCalled()
      },
    })
  })
})
