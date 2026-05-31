import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionControl } from "../../src/session/control"
import { Message } from "../../src/session/message"
import { tmpdir } from "../fixture/fixture"

describe("SessionControl", () => {
  test("does not define a dormant continuation_pending control", () => {
    expect(SessionControl.Kind.options).not.toContain("continuation_pending")
  })

  test("compaction controls are durable control records, not provider-visible transcript parts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "control" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: source.id,
          type: "text",
          text: "build the thing",
        })

        SessionControl.create({
          sessionID: session.id,
          kind: "subtask_request",
          payload: { prompt: "internal subtask" },
        })
        await SessionCompaction.create({
          sessionID: session.id,
          source,
          auto: true,
          overflow: false,
        })

        const messages = await Session.messages({ sessionID: session.id })
        expect(messages.flatMap((message) => message.parts).some((part) => part.type === "compaction")).toBe(false)
        expect(messages.flatMap((message) => message.parts).some((part) => part.type === "subtask")).toBe(false)

        const controls = SessionControl.pending(session.id)
        expect(controls.map((control) => control.kind).sort()).toEqual(["compaction_request", "subtask_request"])

        const modelMessages = await Message.toModelMessages(messages, {
          id: "test-model",
          providerID: "test",
          name: "test",
          limit: { context: 100_000, output: 10_000 },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          capabilities: {
            toolcall: true,
            attachment: false,
            reasoning: false,
            temperature: true,
            input: { text: true, image: false, audio: false, video: false },
            output: { text: true, image: false, audio: false, video: false },
          },
          api: { npm: "@ai-sdk/openai" },
          options: {},
        } as any)
        const replay = JSON.stringify(modelMessages)
        expect(replay).toContain("build the thing")
        expect(replay).not.toContain("Context compaction checkpoint")
        expect(replay).not.toContain("internal subtask")
      },
    })
  })

  test("consume is single-use", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "consume once" })
        const control = SessionControl.create({
          sessionID: session.id,
          kind: "wake_reason",
          payload: { prompt: "resume" },
        })
        expect(SessionControl.consume({ id: control.id, sessionID: session.id })?.status).toBe("consumed")
        expect(SessionControl.consume({ id: control.id, sessionID: session.id })).toBeUndefined()
        expect(SessionControl.pending(session.id)).toEqual([])
      },
    })
  })
})
