/**
 * POST /gateway/master/wake — mission supervisor wake entry tests.
 *
 * Spec: gateway-master-supervisor-2026-05-26.md §2.5.
 *
 * The route MUST:
 *   - generate a missionID when none is supplied (regex-conformant)
 *   - reuse the same gateway session when an existing missionID is supplied
 *   - hand the prompt to SessionWake.wake with agent="gateway-master"
 *   - reject malformed missionID + empty / overlong text
 */
import { afterEach, describe, expect, test, mock, spyOn } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SessionWake } from "../../src/session/wake"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

async function post(body: unknown) {
  // /gateway/* is a project-scoped route — server middleware demands
  // ?directory= or x-opencorvus-directory; every test runs inside
  // Instance.provide so we forward the directory there.
  return Server.App().request("/gateway/master/wake", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-opencorvus-directory": Instance.directory,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /gateway/master/wake — happy path", () => {
  test("auto-generates missionID when omitted; returns {missionID, sessionID, created:true}", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // SessionWake.wake actually starts a SessionPrompt.loop which
        // resolves a model — stub it to keep the route test focused on
        // route mechanics, not LLM pipeline integration.
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post({ text: "kick off the TV replay mission" })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { missionID: string; sessionID: string; created: boolean }
        expect(body.missionID).toMatch(/^[a-z0-9-]+$/)
        expect(body.missionID.length).toBeGreaterThanOrEqual(8)
        expect(body.sessionID).toMatch(/^ses_/)
        expect(body.created).toBe(true)
        expect(wakeSpy).toHaveBeenCalledTimes(1)
        expect(wakeSpy.mock.calls[0]?.[0]?.agent).toBe("gateway-master")
        expect(wakeSpy.mock.calls[0]?.[0]?.prompt).toBe("kick off the TV replay mission")
      },
    })
  })

  test("reuses session when same missionID wakes twice; created:false on second call", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const first = await post({ missionID: "tv-replay", text: "kick off" })
        expect(first.status).toBe(200)
        const firstBody = (await first.json()) as { missionID: string; sessionID: string; created: boolean }
        expect(firstBody.created).toBe(true)
        expect(firstBody.missionID).toBe("tv-replay")

        const second = await post({ missionID: "tv-replay", text: "wake again" })
        expect(second.status).toBe(200)
        const secondBody = (await second.json()) as { missionID: string; sessionID: string; created: boolean }
        expect(secondBody.created).toBe(false)
        expect(secondBody.missionID).toBe("tv-replay")
        expect(secondBody.sessionID).toBe(firstBody.sessionID)
      },
    })
  })

  test("accepts operator-supplied lowercase / hyphen / digit missionID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post({ missionID: "abc-123-xyz", text: "go" })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { missionID: string }
        expect(body.missionID).toBe("abc-123-xyz")
      },
    })
  })
})

describe("POST /gateway/master/wake — input validation", () => {
  test.each([
    ["uppercase letters", { missionID: "FOO", text: "go" }],
    ["dots", { missionID: "foo.bar", text: "go" }],
    ["slashes", { missionID: "a/b", text: "go" }],
    ["spaces", { missionID: "foo bar", text: "go" }],
    ["underscores (regex disallows)", { missionID: "foo_bar", text: "go" }],
    ["empty text", { missionID: "ok", text: "" }],
    ["missing text", { missionID: "ok" } as any],
  ])("rejects %s", async (_label, body) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // SessionWake must never be called for invalid input.
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post(body)
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(wakeSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("rejects missionID > 64 chars", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post({ missionID: "a".repeat(65), text: "go" })
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(wakeSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("rejects text > 32_000 chars (DoS / token-cost guard)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const oversized = "x".repeat(32_001)
        const res = await post({ text: oversized })
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(wakeSpy).not.toHaveBeenCalled()
      },
    })
  })
})
