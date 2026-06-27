import { afterEach, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { PartTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { timelineOrderKey } from "../../src/timeline/order"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

test("persisted part projections expose backend orderKey on every read path", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "part order key projection" })
      const messageID = Identifier.ascending("message")
      const partID = Identifier.ascending("part")
      const now = Date.now()

      await Session.persistMessage({
        info: {
          id: messageID,
          sessionID: session.id,
          role: "assistant",
          time: { created: now },
          parentID: "",
          providerID: "test-provider",
          modelID: "test-model",
          agent: "orchestrator",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [
          {
            id: partID,
            messageID,
            sessionID: session.id,
            type: "tool",
            callID: Identifier.ascending("call"),
            tool: "update_research_document_section",
            state: {
              status: "completed",
              input: { section: "findings" },
              output: "updated",
              title: "Update research document section",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ],
        touchSessionID: session.id,
      })

      const row = Database.use((db) =>
        db.select({ timeCreated: PartTable.time_created }).from(PartTable).where(eq(PartTable.id, partID)).get(),
      )
      if (!row) throw new Error(`persisted part row not found: ${partID}`)
      const expectedOrderKey = timelineOrderKey({ domain: "part", time: row.timeCreated, id: partID })

      const sessionMessages = await Session.messages({ sessionID: session.id })
      expect(sessionMessages[0]?.parts[0]?.orderKey).toBe(expectedOrderKey)

      const latestMessages = await Message.latestAcrossSessions({ sessionIDs: [session.id], limit: 10 })
      expect(latestMessages[0]?.parts[0]?.orderKey).toBe(expectedOrderKey)

      const parts = await Message.parts(messageID)
      expect(parts[0]?.orderKey).toBe(expectedOrderKey)
    },
  })
})
