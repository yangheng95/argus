/**
 * POST /mission/wake — Mission agent wake entry tests.
 *
 * Spec: gateway-mission-split-2026-05-28.md.
 *
 * The route MUST:
 *   - generate a missionID when none is supplied (regex-conformant)
 *   - reuse the same mission session when an existing missionID is supplied
 *   - hand the prompt to SessionWake.wake with agent="mission"
 *   - create a session of kind "mission" carrying metadata.mission.id
 *   - reject malformed missionID + empty / overlong text
 *
 * The old upper-level wake route /gateway/master/wake MUST be gone (404):
 * the gateway namespace is infrastructure-only now.
 */
import { $ } from "bun"
import { afterEach, describe, expect, test, mock, spyOn } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionWake } from "../../src/session/wake"
import { Log } from "../../src/util/log"
import { Filesystem } from "../../src/util/filesystem"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

async function post(path: string, body: unknown) {
  return Server.App().request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-opencorvus-directory": Instance.directory,
    },
    body: JSON.stringify(body),
  })
}

async function postWithDirectory(path: string, directory: string, body: unknown) {
  return Server.App().request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-opencorvus-directory": directory,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /mission/wake — happy path", () => {
  test("auto-generates missionID when omitted; returns {missionID, sessionID, created:true}", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // SessionWake.wake actually starts a SessionPrompt.loop which
        // resolves a model — stub it to keep the route test focused on
        // route mechanics, not LLM pipeline integration.
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post("/mission/wake", { text: "kick off the TV replay mission" })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { missionID: string; sessionID: string; created: boolean }
        expect(body.missionID).toMatch(/^[a-z0-9-]+$/)
        expect(body.missionID.length).toBeGreaterThanOrEqual(8)
        expect(body.sessionID).toMatch(/^ses_/)
        expect(body.created).toBe(true)
        expect(wakeSpy).toHaveBeenCalledTimes(1)
        expect(wakeSpy.mock.calls[0]?.[0]?.agent).toBe("mission")
        expect(wakeSpy.mock.calls[0]?.[0]?.prompt).toBe("kick off the TV replay mission")
        expect(wakeSpy.mock.calls[0]?.[0]?.reason).toEqual({
          source: "mission.operator",
          missionID: body.missionID,
        })
      },
    })
  })

  test("creates a session of kind 'mission' carrying metadata.mission.id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post("/mission/wake", { missionID: "tv-replay", text: "go" })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { sessionID: string; missionID: string }
        const session = await Session.get(body.sessionID)
        expect(session.kind).toBe("mission")
        const mission = (session.metadata as { mission?: { id?: string; channelKey?: string } } | undefined)?.mission
        expect(mission?.id).toBe("tv-replay")
        expect(mission?.channelKey).toBe("mission:tv-replay")
      },
    })
  })

  test("reuses session when same missionID wakes twice; created:false on second call", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const first = await post("/mission/wake", { missionID: "tv-replay", text: "kick off" })
        expect(first.status).toBe(200)
        const firstBody = (await first.json()) as { missionID: string; sessionID: string; created: boolean }
        expect(firstBody.created).toBe(true)
        expect(firstBody.missionID).toBe("tv-replay")

        const second = await post("/mission/wake", { missionID: "tv-replay", text: "wake again" })
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
        const res = await post("/mission/wake", { missionID: "abc-123-xyz", text: "go" })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { missionID: string }
        expect(body.missionID).toBe("abc-123-xyz")
      },
    })
  })

  test("passes explicit model reference to SessionWake", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post("/mission/wake", {
          missionID: "tv-replay",
          text: "go",
          model: "opencorvus/gpt-5-nano",
        })
        expect(res.status).toBe(200)
        expect(wakeSpy).toHaveBeenCalledTimes(1)
        expect(wakeSpy.mock.calls[0]?.[0]?.model).toEqual({
          providerID: "opencorvus",
          modelID: "gpt-5-nano",
        })
      },
    })
  })

  test("expands home directory in project-scoped wake header", async () => {
    const dir = await mkdtemp(path.join(homedir(), "opencorvus-home-test-"))
    try {
      await $`git init`.cwd(dir).quiet()
      await $`git commit --allow-empty -m "root commit"`.cwd(dir).quiet()
      const shorthand = `~/${path.basename(dir)}`
      spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")

      const res = await postWithDirectory("/mission/wake", shorthand, { missionID: "home-dir", text: "go" })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { sessionID: string }
      const session = await Session.get(body.sessionID)
      expect(session.directory).toBe(Filesystem.resolve(shorthand))
      expect(session.directory).not.toContain(`${path.sep}~${path.sep}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("legacy /gateway/master/wake is gone", () => {
  test("POST /gateway/master/wake returns 404 — gateway namespace is infra-only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post("/gateway/master/wake", { text: "go" })
        expect(res.status).toBe(404)
        expect(wakeSpy).not.toHaveBeenCalled()
      },
    })
  })
})

describe("POST /mission/wake — input validation", () => {
  test.each([
    ["uppercase letters", { missionID: "FOO", text: "go" }],
    ["dots", { missionID: "foo.bar", text: "go" }],
    ["slashes", { missionID: "a/b", text: "go" }],
    ["spaces", { missionID: "foo bar", text: "go" }],
    ["underscores (regex disallows)", { missionID: "foo_bar", text: "go" }],
    ["malformed model", { missionID: "ok", text: "go", model: "gpt-5-nano" }],
    ["empty text", { missionID: "ok", text: "" }],
    ["missing text", { missionID: "ok" } as any],
  ])("rejects %s", async (_label, body) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // SessionWake must never be called for invalid input.
        const wakeSpy = spyOn(SessionWake, "wake").mockResolvedValue("ses_stub")
        const res = await post("/mission/wake", body)
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
        const res = await post("/mission/wake", { missionID: "a".repeat(65), text: "go" })
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
        const res = await post("/mission/wake", { text: oversized })
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(wakeSpy).not.toHaveBeenCalled()
      },
    })
  })
})
