import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { Message, Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import {
  enrichStandaloneSessionTranscript,
  mapSessionBusEvent,
  mirrorSessionBusEvent,
  subscribeSessionMirror,
} from "../../src/protocol/session-mirror"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { expectNoProcessErrors } from "../fixture/process-errors"

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

  test("mirrors standalone assistant sessions but not unrelated session kinds", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const plainAssistant = await Session.create({ kind: "assistant" })
        const architect = await Session.create({ kind: "architect" })
        const mirrored: Array<{ key: string; payload: Record<string, any> }> = []
        const stop = ProtocolStore.subscribeEvents(
          (event) => {
            mirrored.push({ key: `${event.sessionID}:${event.type}`, payload: event.payload ?? {} })
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
                id: "msg_plain_assistant",
                sessionID: plainAssistant.id,
                role: "assistant",
                time: { created: Date.now() },
              },
            },
          },
          plainAssistant.id,
        )
        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info: {
                id: "msg_architect",
                sessionID: architect.id,
                role: "assistant",
                time: { created: Date.now() },
              },
            },
          },
          architect.id,
        )

        await new Promise((resolve) => setTimeout(resolve, 50))
        stop()

        expect(mirrored.map((event) => event.key)).toContain(`${sidebar.id}:message.updated`)
        const plain = mirrored.find((event) => event.key === `${plainAssistant.id}:message.updated`)
        expect(plain?.payload.info.channel).toBe("assistant")
        expect(plain?.payload.info.resolvedRole).toBe("assistant")
        expect(mirrored.map((event) => event.key)).not.toContain(`${architect.id}:message.updated`)
      },
    })
  })

  test("enriches cloud container assistant update payload before session SSE dispatch", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "cloud coding assistant" })
        const mirrored: Array<{ type: string; payload: Record<string, any> }> = []
        const stop = ProtocolStore.subscribeEvents(
          (event) => {
            mirrored.push({ type: event.type, payload: event.payload ?? {} })
          },
          { aggregate: "session", sessionID: session.id },
        )

        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info: {
                id: "msg_cloud_assistant",
                sessionID: session.id,
                role: "assistant",
                time: { created: 1781241865042 },
                parentID: "msg_cloud_user",
                modelID: "cy-claude-sonnet-4-6",
                providerID: "hexin",
                agent: "coding-assistant",
                path: {
                  cwd: "/workspace/nova-vibecoding-template",
                  root: "/workspace/nova-vibecoding-template",
                },
                cost: 0,
                tokens: {
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              },
              summary: "Message updated: assistant",
            },
          },
          session.id,
        )
        await waitFor(() => mirrored.some((event) => event.type === "message.updated"))
        stop()

        const updated = mirrored.find((event) => event.type === "message.updated")
        expect(updated?.payload.info.channel).toBe("assistant")
        expect(updated?.payload.info.resolvedRole).toBe("assistant")
        expect(updated?.payload.channel).toBe("assistant")
        expect(updated?.payload.resolvedRole).toBe("assistant")
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
            total: 0,
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
        const part = await Session.updatePart({
          id: "prt_sidebar_assistant",
          messageID: info.id,
          sessionID: sidebar.id,
          type: "text",
          text: "stream body",
        })
        const partUpdatedEvent = {
          type: Message.Event.PartUpdated.type,
          properties: { part },
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
        expect(partUpdated?.payload.channel).toBe("assistant")
        expect(partUpdated?.payload.resolvedRole).toBe("assistant")
        expect(partUpdated?.payload.orderKey).toContain(":part:")
        expect(partUpdated?.payload.part.orderKey).toBe(partUpdated?.payload.orderKey)
        expect(partUpdated?.payload.orderKey).not.toBe(updated?.payload.info.orderKey)
        expect(partUpdated?.payload.part.channel).toBeUndefined()
        expect(partUpdated?.payload.part.resolvedRole).toBeUndefined()
        expect(delta?.payload.channel).toBe("assistant")
        expect(delta?.payload.resolvedRole).toBe("assistant")
      },
    })
  })

  test("stamps right sidebar assistant session errors for lifecycle-only cards", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const mapped = mapSessionBusEvent(
          {
            type: Session.Event.Error.type,
            properties: {
              sessionID: sidebar.id,
              error: {
                name: "UnknownError",
                data: { message: "queue execution failed before assistant output" },
              },
            },
          },
          { sessionID: sidebar.id },
        )

        expect(mapped?.type).toBe("session.error")
        expect(mapped?.payload?.channel).toBe("assistant")
        expect(mapped?.payload?.resolvedRole).toBe("assistant")
        expect(mapped?.payload?.sessionID).toBe(sidebar.id)
      },
    })
  })

  test("stamps right sidebar assistant session status for live execution rail", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const mapped = mapSessionBusEvent(
          {
            type: SessionStatus.Event.Status.type,
            properties: {
              sessionID: sidebar.id,
              status: { type: "streaming" },
            },
          },
          { sessionID: sidebar.id },
        )

        expect(mapped?.type).toBe("session.status")
        expect(mapped?.summary).toBe("session status: streaming")
        expect(mapped?.payload?.channel).toBe("assistant")
        expect(mapped?.payload?.resolvedRole).toBe("assistant")
        expect(mapped?.payload?.sessionID).toBe(sidebar.id)
        expect(mapped?.payload?.status).toEqual({ type: "streaming" })
      },
    })
  })

  test("subscription boundary records mirror failures without process-level rejection", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const stop = subscribeSessionMirror(sidebar.id)
        try {
          await expectNoProcessErrors(async () => {
            GlobalBus.emit("event", {
              directory: tmp.path,
              payload: {
                type: Message.Event.PartUpdated.type,
                properties: {
                  part: {
                    id: "prt_missing",
                    sessionID: sidebar.id,
                    messageID: "msg_missing",
                    type: "text",
                    text: "late chunk",
                  },
                },
              },
            })
          })
        } finally {
          stop()
        }
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
            total: 0,
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
        expect((transcript[0]!.parts[0] as any).channel).toBeUndefined()
        expect((transcript[0]!.parts[0] as any).resolvedRole).toBeUndefined()
        expect((transcript[1]!.info as any).channel).toBe("assistant")
        expect((transcript[1]!.info as any).resolvedRole).toBe("assistant")
        expect((transcript[1]!.parts[0] as any).channel).toBeUndefined()
        expect((transcript[1]!.parts[0] as any).resolvedRole).toBeUndefined()
      },
    })
  })
})
