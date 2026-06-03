/**
 * Session.updatePart write-boundary guard.
 *
 * Specs: specs/acceptance-attachment-store-single-source-2026-05-11.md
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
            time: { start: Date.now(), end: Date.now() },
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
})
