import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { Identifier } from "../../src/id/id"
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

function assistantMessageFixture(input: {
  id: string
  sessionID: string
  created: number
  parentID: string
  modelID: string
  providerID: string
  agent: string
  cwd: string
}): Message.Assistant {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    time: { created: input.created },
    parentID: input.parentID,
    modelID: input.modelID,
    providerID: input.providerID,
    agent: input.agent,
    path: { cwd: input.cwd, root: input.cwd },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
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
        const sidebarInfo = await Session.updateMessage(
          assistantMessageFixture({
            id: "msg_sidebar",
            sessionID: sidebar.id,
            created: Date.now(),
            parentID: "msg_sidebar_user",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "coding-assistant",
            cwd: tmp.path,
          }),
        )
        const plainAssistantInfo = await Session.updateMessage(
          assistantMessageFixture({
            id: "msg_plain_assistant",
            sessionID: plainAssistant.id,
            created: Date.now() + 1,
            parentID: "msg_plain_user",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "coding-assistant",
            cwd: tmp.path,
          }),
        )
        const architectInfo = await Session.updateMessage(
          assistantMessageFixture({
            id: "msg_architect",
            sessionID: architect.id,
            created: Date.now() + 2,
            parentID: "msg_architect_user",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "architect",
            cwd: tmp.path,
          }),
        )

        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info: sidebarInfo,
            },
          },
          sidebar.id,
        )
        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info: plainAssistantInfo,
            },
          },
          plainAssistant.id,
        )
        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info: architectInfo,
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
        const info = await Session.updateMessage(
          assistantMessageFixture({
            id: "msg_cloud_assistant",
            sessionID: session.id,
            created: 1781241865042,
            parentID: "msg_cloud_user",
            modelID: "cy-claude-sonnet-4-6",
            providerID: "hexin",
            agent: "coding-assistant",
            cwd: "/workspace/nova-vibecoding-template",
          }),
        )

        await mirrorSessionBusEvent(
          {
            type: Message.Event.Updated.type,
            properties: {
              info,
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
        const info = await Session.updateMessage(
          assistantMessageFixture({
            id: "msg_sidebar_assistant",
            sessionID: sidebar.id,
            created: Date.now(),
            parentID: "msg_sidebar_user",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "coding-assistant",
            cwd: tmp.path,
          }),
        )

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
        expect(updated?.payload.orderKey).toBe(updated?.payload.info.orderKey)
        expect(partUpdated?.payload.channel).toBe("assistant")
        expect(partUpdated?.payload.resolvedRole).toBe("assistant")
        expect(partUpdated?.payload.orderKey).toBe(updated?.payload.info.orderKey)
        expect(partUpdated?.payload.part.orderKey).toContain(":part:")
        expect(partUpdated?.payload.part.orderKey).not.toBe(partUpdated?.payload.orderKey)
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
        expect(mapped?.payload?.orderKey).toContain(":session:")
      },
    })
  })

  test("preserves terminal status summary for collapsed subagent cards", async () => {
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
              status: {
                type: "terminal",
                reason: "completed",
                summary: "I checked the implementation and recorded the passing visual evidence.",
              },
            },
          },
          { sessionID: sidebar.id },
        )

        expect(mapped?.type).toBe("session.status")
        expect(mapped?.summary).toBe("session status: terminal (completed)")
        expect(mapped?.payload?.status).toEqual({
          type: "terminal",
          reason: "completed",
          summary: "I checked the implementation and recorded the passing visual evidence.",
        })
      },
    })
  })

  test("stamps session diff and config changes with session order keys", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const diff = mapSessionBusEvent(
          {
            type: Session.Event.Diff.type,
            properties: {
              sessionID: sidebar.id,
              diff: [],
            },
          },
          { sessionID: sidebar.id },
        )
        const configChanged = mapSessionBusEvent(
          {
            type: Session.Event.ConfigChanged.type,
            properties: {
              sessionID: sidebar.id,
            },
          },
          { sessionID: sidebar.id },
        )

        expect(diff?.type).toBe("session.diff")
        expect(diff?.payload?.orderKey).toContain(":session:")
        expect(diff?.payload?.channel).toBe("assistant")
        expect(diff?.payload?.resolvedRole).toBe("assistant")
        expect(diff?.payload?.diff).toEqual([])
        expect(configChanged?.type).toBe("config.changed")
        expect(configChanged?.payload?.orderKey).toContain(":session:")
        expect(configChanged?.payload?.channel).toBe("assistant")
        expect(configChanged?.payload?.resolvedRole).toBe("assistant")
      },
    })
  })

  test("does not default-project unsupported session bus events", async () => {
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
            type: "session.unsupported",
            properties: {
              sessionID: sidebar.id,
            },
          },
          { sessionID: sidebar.id },
        )

        expect(mapped).toBeUndefined()
      },
    })
  })

  test("session diff does not stop later assistant part mirroring", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const info = await Session.updateMessage(
          assistantMessageFixture({
            id: "msg_sidebar_diff_assistant",
            sessionID: sidebar.id,
            created: Date.now(),
            parentID: "msg_sidebar_diff_user",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "coding-assistant",
            cwd: tmp.path,
          }),
        )
        const mirrorErrors: string[] = []
        const mirrored: Array<{ type: string; payload: Record<string, any> }> = []
        const stopProtocol = ProtocolStore.subscribeEvents(
          (event) => {
            mirrored.push({ type: event.type, payload: event.payload ?? {} })
          },
          { aggregate: "session", sessionID: sidebar.id },
        )
        const stopMirror = subscribeSessionMirror(sidebar.id, (error) => {
          mirrorErrors.push(error instanceof Error ? error.message : String(error))
        })

        try {
          await expectNoProcessErrors(async () => {
            GlobalBus.emit("event", {
              directory: tmp.path,
              payload: {
                type: Session.Event.Diff.type,
                properties: {
                  sessionID: sidebar.id,
                  diff: [],
                },
              },
            })
            await Session.updatePart({
              id: "prt_sidebar_after_diff",
              messageID: info.id,
              sessionID: sidebar.id,
              type: "text",
              text: "assistant text after diff",
            })
            await waitFor(() => mirrored.some((event) => event.type === "message.part.updated"))
          })

          expect(mirrorErrors).toEqual([])
          expect(mirrored.map((event) => event.type)).toContain("session.diff")
          const partUpdated = mirrored.find((event) => event.type === "message.part.updated")
          expect(partUpdated?.payload.part.text).toBe("assistant text after diff")
        } finally {
          stopMirror()
          stopProtocol()
        }
      },
    })
  })

  test("stamps standalone question events with a top-level interaction order key", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const requestID = Identifier.ascending("question")
        const mapped = mapSessionBusEvent(
          {
            type: "question.asked",
            properties: {
              id: requestID,
              sessionID: sidebar.id,
              questions: [
                {
                  header: "Deploy",
                  question: "Deploy now?",
                  options: [{ label: "Yes", description: "Proceed" }],
                },
              ],
            },
          },
          { sessionID: sidebar.id },
        )

        expect(mapped?.type).toBe("question.asked")
        expect(mapped?.payload?.orderKey).toContain(":interaction:")
        expect(mapped?.payload?.id).toBe(requestID)
        expect(mapped?.payload?.channel).toBe("assistant")
        expect(mapped?.payload?.resolvedRole).toBe("assistant")
      },
    })
  })

  test("subscription boundary reports mirror failures through an explicit error handler", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sidebar = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const mirrorErrors: string[] = []
        const mirrorEventTypes: string[] = []
        const stop = subscribeSessionMirror(sidebar.id, (error, event) => {
          mirrorErrors.push(error instanceof Error ? error.message : String(error))
          mirrorEventTypes.push(event.type)
        })
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
            await waitFor(() => mirrorErrors.length > 0)
          })
          expect(mirrorErrors[0]).toContain("msg_missing")
          expect(mirrorEventTypes[0]).toBe("message.part.updated")
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
