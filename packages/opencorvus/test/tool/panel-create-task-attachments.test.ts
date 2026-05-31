import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { PanelTool } from "../../src/tool/panel"
import { EngineService } from "../../src/task-api"
import { Question } from "../../src/question"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: overlay-image-ingestion-fidelity-2026-05-07.md §Fix C.
 *
 * panel.create_task previously decoded only `isDecodableText` attachments
 * (template .txt, .md) and inlined them into the request prose, then called
 * EngineService.createTask WITHOUT passing the binary attachments. Image
 * uploads dropped through panel/message/stream — the overlay control-plane
 * path AND every channel-runtime IM ingress (slack/feishu/...) — silently
 * disappeared before reaching task.attachments, so the build agent saw no
 * visual reference and produced fidelity-0 deliverables.
 *
 * The fix forwards binary attachments as TaskAttachmentInput
 * (`{mime, data, filename}`) so EngineService.createTask runs the same
 * AttachmentStore.write + persistQueuedTask path that POST /task uses.
 */
describe("panel.create_task attachment forwarding", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("forwards image attachments to EngineService.createTask as base64 data", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Spy intercepts before the heavy createTask machinery runs.
        // Returning a stub task ID lets the panel tool finish without
        // touching the DB or session pipeline.
        const stubTaskID = Identifier.ascending("task")
        const createSpy = spyOn(EngineService, "createTask").mockResolvedValue(stubTaskID)

        const tool = await PanelTool.init()
        // 1×1 transparent PNG (smallest valid image bytes).
        const PNG_BYTES_BASE64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        const dataUrl = `data:image/png;base64,${PNG_BYTES_BASE64}`

        await tool.execute(
          {
            action: "create_task",
            request: "Replicate the attached design.",
            allow_create: true,
            queue: false,
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
              attachments: [
                { mime: "image/png", url: dataUrl, filename: "target.png" },
              ],
            },
          },
        )

        expect(createSpy).toHaveBeenCalledTimes(1)
        const args = createSpy.mock.calls[0]?.[0] as
          | { attachments?: Array<{ mime: string; data: string; filename?: string }> }
          | undefined
        expect(args).toBeDefined()
        expect(Array.isArray(args?.attachments)).toBe(true)
        expect(args!.attachments).toHaveLength(1)
        const passed = args!.attachments![0]
        expect(passed.mime).toBe("image/png")
        // The data URL prefix MUST be stripped — the engine schema rejects
        // anything with a `data:...,` head.
        expect(passed.data).toBe(PNG_BYTES_BASE64)
        expect(passed.filename).toBe("target.png")
      },
    })
  })

  test("asks the panel user for queue decision when create_task omits queue", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stubTaskID = Identifier.ascending("task")
        const createSpy = spyOn(EngineService, "createTask").mockResolvedValue(stubTaskID)

        const tool = await PanelTool.init()
        const sessionID = Identifier.ascending("session")
        const pending = tool.execute(
          {
            action: "create_task",
            request: "Build a focused task.",
            allow_create: true,
          },
          {
            sessionID,
            messageID: Identifier.ascending("message"),
            callID: "call_queue_prompt",
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )

        let questionID: string | undefined
        for (let i = 0; i < 50 && !questionID; i++) {
          await new Promise((resolve) => setTimeout(resolve, 10))
          questionID = (await Question.list()).find((item) => item.sessionID === sessionID)?.id
        }
        expect(questionID).toBeDefined()
        await Question.reply({ requestID: questionID!, answers: [["排队等待"]] })
        await pending

        const args = createSpy.mock.calls[0]?.[0] as { queue?: boolean } | undefined
        expect(args?.queue).toBe(true)
      },
    })
  })

  test("inlines text attachments into request prose AND forwards binary attachments separately", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stubTaskID = Identifier.ascending("task")
        const createSpy = spyOn(EngineService, "createTask").mockResolvedValue(stubTaskID)

        const tool = await PanelTool.init()
        const prdText = "## Spec\nBuild an Apple-style stocks dashboard."
        const prdBase64 = Buffer.from(prdText, "utf8").toString("base64")
        const prdUrl = `data:text/markdown;base64,${prdBase64}`
        const PNG_BASE64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        const pngUrl = `data:image/png;base64,${PNG_BASE64}`

        await tool.execute(
          {
            action: "create_task",
            request: "See attachments.",
            allow_create: true,
            queue: false,
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
              attachments: [
                { mime: "text/markdown", url: prdUrl, filename: "template.md" },
                { mime: "image/png", url: pngUrl, filename: "design.png" },
              ],
            },
          },
        )

        const args = createSpy.mock.calls[0]?.[0] as {
          request: string
          attachments?: Array<{ mime: string; data: string; filename?: string }>
        }
        // Text gets inlined into the request prose so the executor session
        // sees template content directly.
        expect(args.request).toContain("## Spec")
        expect(args.request).toContain("Apple-style stocks")
        // Binary attachments only — text must NOT be duplicated as base64
        // attachment (that would be a double-source violation per rule 8).
        expect(args.attachments).toHaveLength(1)
        expect(args.attachments![0].mime).toBe("image/png")
        expect(args.attachments![0].filename).toBe("design.png")
        expect(args.attachments![0].data).toBe(PNG_BASE64)
      },
    })
  })

  test("rejects non-data-URL attachments instead of silently writing garbage bytes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const createSpy = spyOn(EngineService, "createTask").mockResolvedValue("never_called")

        const tool = await PanelTool.init()

        let thrown: unknown
        try {
          await tool.execute(
            {
              action: "create_task",
              request: "Build it.",
              allow_create: true,
              queue: false,
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
                // server-relative URL — this is the AttachmentStore-served form,
                // NOT a base64 data URL. Pre-fix this got cast to "the user's
                // reference image" with corrupted bytes.
                attachments: [
                  { mime: "image/png", url: "/attachment/proj/abc.png", filename: "bad.png" },
                ],
              },
            },
          )
        } catch (err) {
          thrown = err
        }

        // The strict decoder must throw so the operator sees the bad
        // ingress instead of getting a silently corrupted task.
        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).toContain("bad.png")
        expect((thrown as Error).message).toContain("data URL")
        // createTask must NOT be called with the broken bytes.
        expect(createSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("does not pass attachments field when only text attachments are supplied", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stubTaskID = Identifier.ascending("task")
        const createSpy = spyOn(EngineService, "createTask").mockResolvedValue(stubTaskID)

        const tool = await PanelTool.init()
        const prdText = "Plain spec body."
        const prdUrl = `data:text/plain;base64,${Buffer.from(prdText, "utf8").toString("base64")}`

        await tool.execute(
          {
            action: "create_task",
            request: "See attachment.",
            allow_create: true,
            queue: false,
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
              attachments: [
                { mime: "text/plain", url: prdUrl, filename: "spec.txt" },
              ],
            },
          },
        )

        const args = createSpy.mock.calls[0]?.[0] as {
          request: string
          attachments?: unknown[]
        }
        expect(args.attachments).toBeUndefined()
        expect(args.request).toContain("Plain spec body.")
      },
    })
  })
})
