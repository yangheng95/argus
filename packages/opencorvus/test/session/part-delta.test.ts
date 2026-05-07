import { afterEach, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("updatePartDelta publishes ephemeral stream deltas without mutating transcript reads", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "part-delta-persistence" })
      const messageID = Identifier.ascending("message")
      const textPartID = Identifier.ascending("part")
      const toolPartID = Identifier.ascending("part")

      await Session.updateMessage({
        id: messageID,
        sessionID: session.id,
        role: "assistant",
        time: { created: Date.now() },
        parentID: "",
        modelID: "agent",
        providerID: "agent",
        mode: "agent",
        agent: "executor",
        path: { cwd: "", root: "" },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      } as any)

      await Session.updatePart({
        id: textPartID,
        messageID,
        sessionID: session.id,
        type: "text",
        text: "",
      })
      await Session.updatePart({
        id: toolPartID,
        messageID,
        sessionID: session.id,
        type: "tool",
        tool: "bash",
        callID: "call-1",
        state: {
          status: "pending",
          input: {},
          raw: "",
        },
      })

      const deltas: Array<{ partID: string; field: string; delta: string }> = []
      const unsubscribe = Bus.subscribe(Message.Event.PartDelta, (event) => {
        deltas.push({
          partID: event.properties.partID,
          field: event.properties.field,
          delta: event.properties.delta,
        })
      })

      await Session.updatePartDelta({
        sessionID: session.id,
        messageID,
        partID: textPartID,
        field: "text",
        delta: "hello",
      })
      await Session.updatePartDelta({
        sessionID: session.id,
        messageID,
        partID: textPartID,
        field: "text",
        delta: " world",
      })
      await Session.updatePartDelta({
        sessionID: session.id,
        messageID,
        partID: toolPartID,
        field: "raw",
        delta: '{"cmd":"echo',
      })
      await Session.updatePartDelta({
        sessionID: session.id,
        messageID,
        partID: toolPartID,
        field: "raw",
        delta: ' hi"}',
      })
      unsubscribe()

      expect(deltas).toEqual([
        { partID: textPartID, field: "text", delta: "hello" },
        { partID: textPartID, field: "text", delta: " world" },
        { partID: toolPartID, field: "raw", delta: '{"cmd":"echo' },
        { partID: toolPartID, field: "raw", delta: ' hi"}' },
      ])

      const messages = await Session.messages({ sessionID: session.id })
      expect(messages).toHaveLength(1)

      const textPart = messages[0]?.parts.find((part) => part.id === textPartID)
      expect(textPart?.type).toBe("text")
      expect((textPart as any)?.text).toBe("")

      const toolPart = messages[0]?.parts.find((part) => part.id === toolPartID)
      expect(toolPart?.type).toBe("tool")
      expect((toolPart as any)?.state?.raw).toBe("")
    },
  })
})
