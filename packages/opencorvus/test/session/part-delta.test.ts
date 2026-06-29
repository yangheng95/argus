import { afterEach, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { PartTable } from "../../src/session/session.sql"
import { Message } from "../../src/session/message"
import { Database } from "../../src/storage/db"
import { timelineOrderKey } from "../../src/timeline/order"
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
          total: 0,
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
          time: { start: Date.now() },
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

test("updatePart waits for live part event before callers emit deltas", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "part-event-order" })
      const messageID = Identifier.ascending("message")
      const partID = Identifier.ascending("part")

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
          total: 0,
          cache: { read: 0, write: 0 },
        },
      } as any)

      let partEventDelivered = false
      let partEventOrderKey = ""
      let partOrderKey = ""
      const unsubscribe = Bus.subscribe(Message.Event.PartUpdated, async (event) => {
        if (event.properties.part.id !== partID) return
        partEventOrderKey = event.properties.orderKey
        partOrderKey = event.properties.part.orderKey
        await Bun.sleep(10)
        partEventDelivered = true
      })

      await Session.updatePart({
        id: partID,
        messageID,
        sessionID: session.id,
        type: "text",
        text: "",
      })
      unsubscribe()

      expect(partEventDelivered).toBe(true)
      expect(partEventOrderKey).toContain(":message:")
      expect(partOrderKey).toContain(":part:")
      expect(partOrderKey).not.toBe(partEventOrderKey)
    },
  })
})

test("updatePart rejects caller-provided part orderKey drift", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "part-order-key-drift" })
      const messageID = Identifier.ascending("message")
      const partID = Identifier.ascending("part")

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
          total: 0,
          cache: { read: 0, write: 0 },
        },
      } as any)

      await expect(
        Session.updatePart({
          id: partID,
          messageID,
          sessionID: session.id,
          orderKey: timelineOrderKey({ domain: "message", time: Date.now(), id: messageID }),
          type: "text",
          text: "wrong domain should not be silently discarded",
        }),
      ).rejects.toThrow(/orderKey drift/)
    },
  })
})

test("visible message.part.updated bus events reject missing part orderKey", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(
        Bus.publish(Message.Event.PartUpdated, {
          orderKey: "v1:0001776100000000:0000000000000030:0000000000000000:message:msg_missing_visible_part_key",
          part: {
            id: "prt_missing_visible_part_key",
            messageID: "msg_missing_visible_part_key",
            sessionID: "ses_missing_visible_part_key",
            type: "text",
            text: "missing part-domain key",
          } as any,
        }),
      ).rejects.toThrow(/orderKey/)
    },
  })
})

test("persisted pending tool parts require backend start time before transcript reads", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "persisted-part-contract" })
      const messageID = Identifier.ascending("message")
      const partID = Identifier.ascending("part")

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
          total: 0,
          cache: { read: 0, write: 0 },
        },
      } as any)

      Database.use((db) => {
        db.insert(PartTable)
          .values({
            id: partID,
            message_id: messageID,
            session_id: session.id,
            time_created: Date.now(),
            data: {
              type: "tool",
              tool: "register_decision",
              callID: "register_decision:36",
              state: {
                status: "pending",
                input: {},
                raw: "",
              },
            } as any,
          })
          .run()
      })

      await expect(Session.messages({ sessionID: session.id })).rejects.toThrow(
        /persisted part .* violates Message\.VisiblePart: state\.time/,
      )
    },
  })
})
