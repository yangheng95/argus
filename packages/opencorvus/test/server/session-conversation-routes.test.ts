import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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

  test("GET /session/:sessionID/conversation hydrates gateway session conversation shape", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "gateway", title: "Gateway mission" })
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

        const response = await Server.App().request(`/session/${session.id}/conversation`, {
          headers: { "x-opencorvus-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = await response.json() as any
        expect(body.board).toMatchObject({
          kind: "session",
          sessionID: session.id,
          title: "Gateway mission",
          directory: tmp.path,
        })
        expect(body.timeline).toEqual([])
        expect(body.events).toEqual([])
        expect(body.agentView).toEqual(body.view)
        expect(body.transcript).toHaveLength(1)
        expect(body.transcript[0].info.channel).toBe("main")
        expect(body.transcript[0].info.resolvedRole).toBe("user")
        expect(body.view.topLevelSessionIDs).toContain(session.id)
      },
    })
  })

  test("GET /session/:sessionID/events emits mirrored gateway message events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "gateway", title: "Gateway SSE mission" })
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
            agent: "gateway",
            path: { cwd: tmp.path, root: tmp.path },
            cost: 0,
            tokens: {
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
          expect(mirrored.payload.info.channel).toBe("gateway")
          expect(mirrored.payload.info.resolvedRole).toBe("gateway")
        } finally {
          clearTimeout(timeout)
          abort.abort("test complete")
        }
      },
    })
  })
})
