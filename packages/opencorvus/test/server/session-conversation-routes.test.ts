import { afterEach, describe, expect, test } from "bun:test"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { Question } from "../../src/question"
import { protocolSessionEvent } from "../../src/server/routes/session"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { timelineOrderKey } from "../../src/timeline/order"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function sessionOrderKey(sessionID: string, timeCreated: number) {
  return timelineOrderKey({ domain: "session", time: timeCreated, id: sessionID })
}

function sseReader(response: Response): () => Promise<any> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("SSE response body missing")
  const decoder = new TextDecoder()
  let buffer = ""
  return async () => {
    while (true) {
      let boundary = buffer.indexOf("\n\n")
      let delimiterLength = 2
      const crlfBoundary = buffer.indexOf("\r\n\r\n")
      if (boundary < 0 || (crlfBoundary >= 0 && crlfBoundary < boundary)) {
        boundary = crlfBoundary
        delimiterLength = 4
      }
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + delimiterLength)
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n")
        if (data) return JSON.parse(data)
        continue
      }
      const next = await reader.read()
      if (next.done) throw new Error("SSE stream ended before the expected event")
      buffer += decoder.decode(next.value, { stream: true })
    }
  }
}

describe("session conversation routes", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("session event stream owns write failures", async () => {
    const source = await Bun.file(new URL("../../src/server/routes/session.ts", import.meta.url)).text()
    const eventsStart = source.indexOf('"/:sessionID/events"')
    const sessionGetStart = source.indexOf('"/:sessionID"', eventsStart + 1)
    const eventsRoute = source.slice(eventsStart, sessionGetStart)

    expect(eventsRoute).toContain("cleanup({ closeStream: true, error })")
    expect(eventsRoute).toContain("await finished")
    expect(eventsRoute).toContain("if (closed) return")
  })

  test("GET /session/:sessionID/conversation hydrates mission session conversation shape", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "mission", title: "Mission Control" })
        const created = Date.now()
        const user = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created },
          agent: "user",
          model: { providerID: "test", modelID: "test-model" },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "wake mission",
        })
        const mission = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: { created: created + 1 },
          parentID: user.id,
          agent: "mission",
          modelID: "test-model",
          providerID: "test",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: mission.id,
          type: "text",
          text: "mission awake",
        })
        const user2 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: created + 2 },
          parentID: mission.id,
          agent: "user",
          model: { providerID: "test", modelID: "test-model" },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: user2.id,
          type: "text",
          text: "continue mission",
        })
        const mission2 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: { created: created + 3 },
          parentID: user2.id,
          agent: "mission",
          modelID: "test-model",
          providerID: "test",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: mission2.id,
          type: "text",
          text: "mission continues",
        })

        const response = await Server.App().request(`/session/${session.id}/conversation`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as any
        expect(body.board).toMatchObject({
          kind: "session",
          sessionID: session.id,
          title: "Mission Control",
          directory: tmp.path,
        })
        expect(body.timeline).toEqual([])
        expect(body.events).toEqual([])
        expect(body.transcript).toHaveLength(4)
        expect(body.transcript[0].info.channel).toBe("main")
        expect(body.transcript[0].info.resolvedRole).toBe("user")
        expect(body.transcript.map((message: any) => [message.info.id, message.info.channel])).toEqual([
          [user.id, "main"],
          [mission.id, "mission"],
          [user2.id, "main"],
          [mission2.id, "mission"],
        ])
        expect(body.view.topLevelSessionIDs).toContain(session.id)
        expect(body.view.messages.map((message: any) => [message.messageID, message.stage])).toEqual([
          [user.id, "user"],
          [mission.id, "mission"],
          [user2.id, "user"],
          [mission2.id, "mission"],
        ])
        expect(body.agentView.sessions).toContainEqual(
          expect.objectContaining({
            sessionID: session.id,
            stage: "mission",
            status: "pending",
          }),
        )
      },
    })
  })

  test("GET /session/:sessionID/conversation returns explicit positive empty history state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "Empty Assistant" })

        const response = await Server.App().request(`/session/${session.id}/conversation`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as any
        expect(body.transcript).toEqual([])
        expect(body.agentView).toBeDefined()
        expect(body.history).toEqual({
          oldestTimestamp: null,
          oldestOrderKey: null,
          oldestMessageID: null,
          hasMore: false,
          limit: 1,
        })
      },
    })
  })

  test("GET /session/:sessionID/conversation agentView includes child execution sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "mission", title: "Mission Root" })
        const child = await Session.create({
          kind: "assistant",
          parentID: session.id,
          title: "child assistant",
        })
        const childUserMessage = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: child.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model: { providerID: "test", modelID: "test-model" },
        } as any)
        const childMessage = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: child.id,
          role: "assistant",
          time: { created: Date.now() + 1 },
          parentID: childUserMessage.id,
          agent: "assistant",
          modelID: "test-model",
          providerID: "test",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            total: 0,
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: child.id,
          messageID: childMessage.id,
          type: "text",
          text: "child assistant output",
        })
        const emittedAt = Date.now() + 10
        const childOrderKey = sessionOrderKey(child.id, child.time.created)
        await ProtocolStore.appendEvent({
          kind: "event",
          type: "session.status",
          aggregate: "session",
          aggregate_id: child.id,
          session_id: child.id,
          source: "test",
          emitted_at: emittedAt,
          order_key: childOrderKey,
          payload: {
            orderKey: childOrderKey,
            sessionID: child.id,
            channel: "assistant",
            parentSessionID: session.id,
            status: { type: "streaming" },
          },
        })

        const response = await Server.App().request(`/session/${session.id}/conversation`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as any
        expect(body.transcript.map((message: any) => message.info.id)).toEqual([childMessage.id])
        expect(body.view.messages).toContainEqual(
          expect.objectContaining({
            messageID: childMessage.id,
            sessionID: child.id,
            stage: "assistant",
          }),
        )
        expect(body.agentView.sessions).toContainEqual(
          expect.objectContaining({
            sessionID: child.id,
            stage: "assistant",
            parentSessionID: session.id,
            messageIDs: [childMessage.id],
            lastDisplayMessageID: childMessage.id,
            status: "running",
            lastObservedAt: emittedAt,
          }),
        )
      },
    })
  })

  test("GET /session/:sessionID/conversation hydrates right sidebar message channel metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          kind: "assistant",
          title: "Right sidebar",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const created = Date.now()
        const user = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created },
          agent: "coding-assistant",
          model: { providerID: "test", modelID: "test-model" },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "inspect this",
        })
        const assistant = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: { created: created + 1 },
          parentID: user.id,
          modelID: "test-model",
          providerID: "test",
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
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistant.id,
          type: "text",
          text: "inspection complete",
        })
        const user2 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: created + 2 },
          parentID: assistant.id,
          agent: "coding-assistant",
          model: { providerID: "test", modelID: "test-model" },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: user2.id,
          type: "text",
          text: "inspect more",
        })
        const assistant2 = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          time: { created: created + 3 },
          parentID: user2.id,
          modelID: "test-model",
          providerID: "test",
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
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistant2.id,
          type: "text",
          text: "second inspection complete",
        })

        const response = await Server.App().request(`/session/${session.id}/conversation`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as any
        const transcript = body.transcript as Array<{ info: any; parts: any[] }>
        expect(transcript.map((message) => [message.info.id, message.info.channel, message.info.resolvedRole])).toEqual(
          [
            [user.id, "main", "user"],
            [assistant.id, "assistant", "assistant"],
            [user2.id, "main", "user"],
            [assistant2.id, "assistant", "assistant"],
          ],
        )
        expect(transcript.map((message) => message.parts[0]?.channel)).toEqual([
          undefined,
          undefined,
          undefined,
          undefined,
        ])
        expect(transcript.map((message) => message.parts[0]?.resolvedRole)).toEqual([
          undefined,
          undefined,
          undefined,
          undefined,
        ])
        expect(body.view.topLevelSessionIDs).toContain(session.id)
        expect(body.view.messages.map((message: any) => [message.messageID, message.stage])).toEqual([
          [user.id, "user"],
          [assistant.id, "assistant"],
          [user2.id, "user"],
          [assistant2.id, "assistant"],
        ])
      },
    })
  })

  test("GET /session/:sessionID/events emits mirrored mission message events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "mission", title: "Mission SSE" })
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort("timed out waiting for message.updated"), 6_000)
        try {
          const response = await Server.App().request(`/session/${session.id}/events`, {
            headers: { "x-opencorvus-directory": tmp.path },
            signal: abort.signal,
          })
          expect(response.status).toBe(200)
          const readEvent = sseReader(response)
          expect((await readEvent()).type).toBe("session.connected")

          await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "assistant",
            time: { created: Date.now() },
            parentID: "",
            modelID: "test-model",
            providerID: "test",
            mode: "agent",
            agent: "mission",
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: {
              total: 0,
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          } as any)

          let mirrored: any
          while (!mirrored) {
            const event = await readEvent()
            if (event.type === "message.updated") mirrored = event
          }
          expect(mirrored.session_id).toBe(session.id)
          expect(mirrored.payload.info.sessionID).toBe(session.id)
          expect(mirrored.payload.info.channel).toBe("mission")
          expect(mirrored.payload.info.resolvedRole).toBe("mission")
        } finally {
          clearTimeout(timeout)
          abort.abort("test complete")
        }
      },
    })
  })

  test("GET /session/:sessionID/events enriches plain assistant message events for tree-writer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "Cloud assistant SSE" })
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort("timed out waiting for assistant message.updated"), 6_000)
        try {
          const response = await Server.App().request(`/session/${session.id}/events`, {
            headers: { "x-opencorvus-directory": tmp.path },
            signal: abort.signal,
          })
          expect(response.status).toBe(200)
          const readEvent = sseReader(response)
          expect((await readEvent()).type).toBe("session.connected")

          await Session.updateMessage({
            id: Identifier.ascending("message"),
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
              total: 0,
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          } as any)

          let mirrored: any
          while (!mirrored) {
            const event = await readEvent()
            if (event.type === "message.updated") mirrored = event
          }
          expect(mirrored.session_id).toBe(session.id)
          expect(mirrored.payload.info.sessionID).toBe(session.id)
          expect(mirrored.payload.info.channel).toBe("assistant")
          expect(mirrored.payload.info.resolvedRole).toBe("assistant")
          expect(mirrored.payload.channel).toBe("assistant")
          expect(mirrored.payload.resolvedRole).toBe("assistant")
          expect(mirrored.orderKey).toBe(mirrored.payload.orderKey)
          expect(mirrored.payload.orderKey).toBe(mirrored.payload.info.orderKey)
        } finally {
          clearTimeout(timeout)
          abort.abort("test complete")
        }
      },
    })
  })

  test("GET /session/:sessionID/events enriches plain assistant session status events for rail", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "Cloud assistant SSE status" })
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort("timed out waiting for assistant session.status"), 6_000)
        try {
          const response = await Server.App().request(`/session/${session.id}/events`, {
            headers: { "x-opencorvus-directory": tmp.path },
            signal: abort.signal,
          })
          expect(response.status).toBe(200)
          const readEvent = sseReader(response)
          expect((await readEvent()).type).toBe("session.connected")

          SessionStatus.set(session.id, { type: "streaming" })

          let mirrored: any
          while (!mirrored) {
            const event = await readEvent()
            if (event.type === "session.status") mirrored = event
          }
          expect(mirrored.session_id).toBe(session.id)
          expect(mirrored.summary).toBe("session status: streaming")
          expect(mirrored.payload.sessionID).toBe(session.id)
          expect(mirrored.payload.status).toEqual({ type: "streaming" })
          expect(mirrored.payload.channel).toBe("assistant")
          expect(mirrored.payload.resolvedRole).toBe("assistant")
          expect(mirrored.orderKey).toBe(mirrored.payload.orderKey)
          expect(mirrored.orderKey).toContain(":session:")
        } finally {
          SessionStatus.set(session.id, { type: "idle" }, { publish: false })
          clearTimeout(timeout)
          abort.abort("test complete")
        }
      },
    })
  })

  test("GET /session/:sessionID/events gives standalone question cards a top-level orderKey", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "Cloud assistant SSE question" })
        const requestID = Identifier.ascending("question")
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort("timed out waiting for question.asked"), 6_000)
        let pending: Promise<unknown> = Promise.resolve([])
        try {
          const response = await Server.App().request(`/session/${session.id}/events`, {
            headers: { "x-opencorvus-directory": tmp.path },
            signal: abort.signal,
          })
          expect(response.status).toBe(200)
          const readEvent = sseReader(response)
          expect((await readEvent()).type).toBe("session.connected")

          pending = Question.ask({
            sessionID: session.id,
            requestID,
            questions: [
              {
                header: "Deploy",
                question: "Deploy now?",
                options: [{ label: "Yes", description: "Proceed" }],
              },
            ],
          }).catch(() => [])

          let mirrored: any
          while (!mirrored) {
            const event = await readEvent()
            if (event.type === "question.asked") mirrored = event
          }
          expect(mirrored.session_id).toBe(session.id)
          expect(mirrored.payload.id).toBe(requestID)
          expect(mirrored.payload.sessionID).toBe(session.id)
          expect(mirrored.orderKey).toBe(mirrored.payload.orderKey)
          expect(mirrored.orderKey).toContain(":interaction:")
          expect(mirrored.payload.channel).toBe("assistant")
          expect(mirrored.payload.resolvedRole).toBe("assistant")
        } finally {
          clearTimeout(timeout)
          abort.abort("test complete")
          await Question.reject(requestID).catch(() => undefined)
          await pending
        }
      },
    })
  })

  test("standalone session event envelopes reject missing orderKey instead of emitting unordered UI events", () => {
    expect(() =>
      protocolSessionEvent({
        id: "ephemeral-missing-order-key",
        kind: "event",
        type: "session.status",
        aggregate: "session",
        aggregateID: "ses_missing_order_key",
        sessionID: "ses_missing_order_key",
        sequence: 12,
        summary: "session status: streaming",
        payload: { sessionID: "ses_missing_order_key", status: { type: "streaming" } },
        time: {
          emitted: 1_780_900_000_000,
          created: 1_780_900_000_000,
          updated: 1_780_900_000_000,
        },
      } as any),
    ).toThrow(/orderKey|expected string/)

    const messageOrderKey =
      "v1:0001780900000000:0000000000000030:0000000000000000:message:msg_wrong_session_status"
    expect(() =>
      protocolSessionEvent({
        id: "ephemeral-wrong-domain-order-key",
        kind: "event",
        type: "session.status",
        aggregate: "session",
        aggregateID: "ses_wrong_domain_order_key",
        sessionID: "ses_wrong_domain_order_key",
        sequence: 13,
        orderKey: messageOrderKey,
        summary: "session status: streaming",
        payload: {
          orderKey: messageOrderKey,
          sessionID: "ses_wrong_domain_order_key",
          status: { type: "streaming" },
        },
        time: {
          emitted: 1_780_900_000_000,
          created: 1_780_900_000_000,
          updated: 1_780_900_000_000,
        },
      } as any),
    ).toThrow(/expected session orderKey/)
  })
})
