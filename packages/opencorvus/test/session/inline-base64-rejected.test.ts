/**
 * Session.updatePart write-boundary guard.
 *
 * Attachment-store single-source contract
 *
 * Every inline-base64 producer (MCP image content, screenshot tools, future
 * visual tools) routes through Session.updatePart on the
 * way to PartTable. The guard is the single-point veto: any `data:*;base64,`
 * URL inside the persisted JSON throws InlineBase64InPartError loudly so
 * the regression is caught at the producer site instead of silently
 * bloating part.data (the OOM driver).
 *
 * rule 6.1 second branch: this is a data-integrity gate, not a state
 * machine trying to teach the LLM which path to take.
 */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { count, Database, eq } from "../../src/storage/db"
import { MessageTable, PartTable } from "../../src/session/session.sql"

async function setupSession() {
  const session = await Session.create({ kind: "orchestrator" })
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
  } as any)
  return { sessionID: session.id, messageID: message.id }
}

describe("Session.updatePart inline-base64 guard", () => {
  test("rejects a file part whose url is data:image/png;base64,...", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { sessionID, messageID } = await setupSession()
        const partID = Identifier.ascending("part")
        const promise = Session.updatePart({
          id: partID,
          messageID,
          sessionID,
          type: "file",
          mime: "image/png",
          filename: "evidence.png",
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA",
        } as any)
        await expect(promise).rejects.toThrow(/InlineBase64InPartError|inline base64/i)
      },
    })
  })

  test("rejects an attachment inside a tool part state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { sessionID, messageID } = await setupSession()
        const partID = Identifier.ascending("part")
        const callID = Identifier.ascending("part")
        const promise = Session.updatePart({
          id: partID,
          messageID,
          sessionID,
          type: "tool",
          tool: "image_probe",
          callID,
          state: {
            status: "completed",
            title: "image_probe",
            input: {},
            output: "{}",
            metadata: {},
            time: { start: Date.now(), end: Date.now() + 1 },
            attachments: [
              {
                id: Identifier.ascending("part"),
                sessionID,
                messageID,
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,iVBORw0KGgoAAAA",
              },
            ],
          },
        } as any)
        await expect(promise).rejects.toThrow(/InlineBase64InPartError|inline base64/i)
      },
    })
  })

  test("rejects uppercase, parameterized, and prefixed data URLs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { sessionID, messageID } = await setupSession()
        for (const [index, url] of [
          "DATA:image/png;base64,UE5H",
          "data:image/png;charset=utf-8;base64,UE5H",
          "prefix data:image/png;base64,UE5H",
        ].entries()) {
          await expect(
            Session.updatePart({
              id: Identifier.ascending("part"),
              messageID,
              sessionID,
              type: "file",
              mime: "image/png",
              filename: `inline-${index}.png`,
              url,
            } as any),
          ).rejects.toThrow(/InlineBase64InPartError|inline base64/i)
        }
      },
    })
  })

  test("persistMessage rejects inline base64 without committing a header-only message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "orchestrator" })
        const messageID = Identifier.ascending("message")

        await expect(
          Session.persistMessage({
            info: {
              id: messageID,
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "user",
              model: { providerID: "test", modelID: "test" },
            } as any,
            parts: [
              {
                id: Identifier.ascending("part"),
                messageID,
                sessionID: session.id,
                type: "file",
                mime: "image/png",
                filename: "inline.png",
                url: "data:image/png;charset=utf-8;base64,UE5H",
              } as any,
            ],
          }),
        ).rejects.toThrow(/InlineBase64InPartError|inline base64/i)

        expect(
          Database.use((db) =>
            db.select({ count: count() }).from(MessageTable).where(eq(MessageTable.id, messageID)).get()!.count,
          ),
        ).toBe(0)
        expect(Database.use((db) => db.select({ count: count() }).from(PartTable).get()!.count)).toBe(0)
      },
    })
  })

  test("accepts a part whose url is a canonical /attachment/<sha>.<ext> ref", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { sessionID, messageID } = await setupSession()
        const partID = Identifier.ascending("part")
        await Session.updatePart({
          id: partID,
          messageID,
          sessionID,
          type: "file",
          mime: "image/png",
          filename: "evidence.png",
          url: `/attachment/${Instance.project.id}/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890.png`,
        } as any)
        // No throw — accepted.
      },
    })
  })

  test("updatePartData rejects inline base64 on repaired persisted part data", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { sessionID, messageID } = await setupSession()
        const partID = Identifier.ascending("part")
        const originalUrl = `/attachment/${Instance.project.id}/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890.png`
        await Session.updatePart({
          id: partID,
          messageID,
          sessionID,
          type: "file",
          mime: "image/png",
          filename: "evidence.png",
          url: originalUrl,
        } as any)

        await expect(
          Session.updatePartData({
            partID,
            data: {
              type: "file",
              mime: "image/png",
              filename: "evidence.png",
              url: "data:image/png;base64,UE5H",
            },
          }),
        ).rejects.toThrow(/InlineBase64InPartError|inline base64/i)

        const row = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, partID)).get())
        expect((row?.data as { url?: string } | undefined)?.url).toBe(originalUrl)
      },
    })
  })
})
