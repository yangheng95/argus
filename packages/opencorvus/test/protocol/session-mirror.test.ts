import { afterEach, describe, expect, test } from "bun:test"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { Message, Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import {
  enrichStandaloneSessionTranscript,
  mapSessionBusEvent,
  mirrorSessionBusEvent,
} from "../../src/protocol/session-mirror"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function waitFor(assertion: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (assertion()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for session mirror events")
}

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

  test("stamps right sidebar assistant live message payloads for tree-writer", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const info: Message.Assistant = {
          id: "msg_sidebar_assistant",
          sessionID: sidebar.id,
          role: "assistant",
          time: { created: Date.now() },
          parentID: "msg_sidebar_user",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "coding-assistant",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }
        await Session.saveMessage(info)

        const mirrored: Array<{ type: string; payload: Record<string, any> }> = []
        const stop = ProtocolStore.subscribeEvents(
          (event) => {
            mirrored.push({ type: event.type, payload: event.payload ?? {} })
          },
          { aggregate: "session", sessionID: sidebar.id },
        )

        const updatedEvent = {
          type: Message.Event.Updated.type,
          properties: { info },
        }
        const partUpdatedEvent = {
          type: Message.Event.PartUpdated.type,
          properties: {
            part: {
              id: "prt_sidebar_assistant",
              messageID: info.id,
              sessionID: sidebar.id,
              type: "text",
              text: "stream body",
            },
          },
        }
        const deltaEvent = {
          type: Message.Event.PartDelta.type,
          properties: {
            sessionID: sidebar.id,
            messageID: info.id,
            partID: "prt_sidebar_assistant",
            field: "text",
            delta: " chunk",
          },
        }
        expect(mapSessionBusEvent(deltaEvent, { sessionID: sidebar.id })?.payload?.channel).toBe("assistant")

        await mirrorSessionBusEvent(updatedEvent, sidebar.id)
        await mirrorSessionBusEvent(partUpdatedEvent, sidebar.id)
        await mirrorSessionBusEvent(deltaEvent, sidebar.id)
        await waitFor(() => mirrored.filter((event) => event.type.startsWith("message.")).length >= 3)
        stop()

        const updated = mirrored.find((event) => event.type === "message.updated")
        const partUpdated = mirrored.find((event) => event.type === "message.part.updated")
        const delta = mirrored.find((event) => event.type === "message.part.delta")
        expect(updated?.payload.info.channel).toBe("assistant")
        expect(updated?.payload.info.resolvedRole).toBe("assistant")
        expect(partUpdated?.payload.part.channel).toBe("assistant")
        expect(partUpdated?.payload.part.resolvedRole).toBe("assistant")
        expect(delta?.payload.channel).toBe("assistant")
        expect(delta?.payload.resolvedRole).toBe("assistant")
      },
    })
  })

  test("stamps right sidebar standalone transcript user and assistant messages", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const user: Message.User = {
          id: "msg_sidebar_user",
          sessionID: sidebar.id,
          role: "user",
          time: { created: Date.now() },
          agent: "coding-assistant",
          model: { providerID: "test-provider", modelID: "test-model" },
        }
        const assistant: Message.Assistant = {
          id: "msg_sidebar_reply",
          sessionID: sidebar.id,
          role: "assistant",
          time: { created: Date.now() + 1 },
          parentID: user.id,
          modelID: "test-model",
          providerID: "test-provider",
          agent: "coding-assistant",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }

        const transcript = enrichStandaloneSessionTranscript([
          {
            info: user,
            parts: [
              {
                id: "prt_sidebar_user",
                messageID: user.id,
                sessionID: sidebar.id,
                type: "text",
                text: "please inspect the bug",
              },
            ],
          },
          {
            info: assistant,
            parts: [
              {
                id: "prt_sidebar_reply",
                messageID: assistant.id,
                sessionID: sidebar.id,
                type: "text",
                text: "inspection complete",
              },
            ],
          },
        ])

        expect((transcript[0]!.info as any).channel).toBe("main")
        expect((transcript[0]!.info as any).resolvedRole).toBe("user")
        expect((transcript[0]!.parts[0] as any).channel).toBe("main")
        expect((transcript[1]!.info as any).channel).toBe("assistant")
        expect((transcript[1]!.info as any).resolvedRole).toBe("assistant")
        expect((transcript[1]!.parts[0] as any).channel).toBe("assistant")
      },
    })
  })
})
