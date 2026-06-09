import { afterEach, describe, expect, test } from "bun:test"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { Message, Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { mirrorSessionBusEvent } from "../../src/protocol/session-mirror"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("session mirror", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("mirrors right sidebar assistant sessions but not ordinary assistant sessions", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const ordinary = await Session.create({ kind: "assistant" })
        const mirrored: string[] = []
        const stop = ProtocolStore.subscribeEvents(
          (event) => {
            mirrored.push(`${event.sessionID}:${event.type}`)
          },
          { aggregate: "session" },
        )

        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info: {
                id: "msg_sidebar",
                sessionID: sidebar.id,
                role: "assistant",
                time: { created: Date.now() },
              },
            },
          },
          sidebar.id,
        )
        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info: {
                id: "msg_ordinary",
                sessionID: ordinary.id,
                role: "assistant",
                time: { created: Date.now() },
              },
            },
          },
          ordinary.id,
        )

        await new Promise((resolve) => setTimeout(resolve, 50))
        stop()

        expect(mirrored).toContain(`${sidebar.id}:message.updated`)
        expect(mirrored).not.toContain(`${ordinary.id}:message.updated`)
      },
    })
  })
})
