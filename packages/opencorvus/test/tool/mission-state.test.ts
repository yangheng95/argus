import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { ensureMissionSession } from "../../src/mission/session"
import { MissionStateTool, MISSION_STATE_FILES } from "../../src/tool/mission-state"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: gateway-mission-split-2026-05-28.md.
 *
 * mission_state is path-confined I/O for the Mission agent. The boundary is
 * the protection — Mission cannot read or write outside
 * `.opencorvus/runtime/mission/<missionID>/<file>` where file is one of the
 * four hard-coded names.
 *
 * The missionID is NOT an agent parameter: it is resolved from the mission
 * session's `metadata.mission.id` (single source — same field panel.create_task
 * uses for provenance). The mission-e2e smoke test proved that taking it from
 * the LLM let the agent fabricate ids ("smoke-test", "mission_001") and write
 * its durable memory to a directory no later wake could find. These tests pin
 * the server-derived behaviour.
 */

/** A tool ctx bound to a real mission session (so resolveMissionID can read its metadata). */
async function missionCtx(missionID: string) {
  const session = await ensureMissionSession({ missionID, defaultCwd: Instance.directory })
  return ctxForSession(session.id)
}

function ctxForSession(sessionID: string) {
  return {
    sessionID,
    messageID: Identifier.ascending("message"),
    agent: "mission",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
  } as any
}

describe("mission_state — missionID is resolved from the session, not the agent", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("rejects when the session is not a mission session (no metadata.mission.id)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const plain = await Session.createNext({ kind: "assistant", directory: tmp.path, title: "plain" })
        await expect(
          tool.execute({ action: "read", file: "frontier.md" } as any, ctxForSession(plain.id)),
        ).rejects.toThrow(/not a mission session/)
      },
    })
  }, 30_000)

  test("defense in depth: a malformed missionID in session metadata is rejected by the path guard", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        // ensureMissionSession does not re-validate the id format (the wake
        // route does), so corrupt the metadata directly and prove the tool's
        // own missionDir() guard still blocks traversal / bad ids.
        for (const bad of ["../escape", "a/b", "a\\b", "FOO", "foo.bar", "foo bar", "a".repeat(65)]) {
          const session = await ensureMissionSession({
            missionID: `ok-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            defaultCwd: tmp.path,
          })
          await Session.mergeMetadata({ sessionID: session.id, patch: { mission: { id: bad } } })
          await expect(
            tool.execute({ action: "read", file: "frontier.md" } as any, ctxForSession(session.id)),
          ).rejects.toThrow()
        }
      },
    })
  }, 30_000)

  test("rejects file names outside the fixed vocabulary (Zod enum)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const ctx = await missionCtx("m1")
        await expect(tool.execute({ action: "read", file: "random.md" } as any, ctx)).rejects.toThrow()
        await expect(tool.execute({ action: "read", file: "../etc/passwd" } as any, ctx)).rejects.toThrow()
      },
    })
  }, 30_000)

  test("exposes exactly the four fixed file names", () => {
    expect([...MISSION_STATE_FILES].sort()).toEqual(["frontier.md", "handoff.md", "notes.md", "tasks.md"])
  })
})

describe("mission_state read / write / list", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("read on a fresh mission returns empty string (no error)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const result = await tool.execute({ action: "read", file: "frontier.md" } as any, await missionCtx("tv-replay"))
        expect(result.output).toBe("")
        expect((result.metadata as any).exists).toBe(false)
      },
    })
  })

  test("write creates directory + file under the session's missionID; read returns content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const ctx = await missionCtx("tv-replay")
        const body = "## Outstanding\n- /chart\n- /screener\n"
        await tool.execute({ action: "write", file: "frontier.md", content: body } as any, ctx)
        // The file MUST land under the session's missionID, not any id the caller imagined.
        const onDisk = await fs.readFile(
          path.join(tmp.path, ".opencorvus", "runtime", "mission", "tv-replay", "frontier.md"),
          "utf8",
        )
        expect(onDisk).toBe(body)
        const result = await tool.execute({ action: "read", file: "frontier.md" } as any, ctx)
        expect(result.output).toBe(body)
      },
    })
  })

  test("write is atomic: temp file does not leak after success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        await tool.execute(
          { action: "write", file: "tasks.md", content: "task list" } as any,
          await missionCtx("tv-replay"),
        )
        const dir = path.join(tmp.path, ".opencorvus", "runtime", "mission", "tv-replay")
        const entries = await fs.readdir(dir)
        expect(entries.sort()).toEqual(["tasks.md"])
      },
    })
  })

  test("write rejects content exceeding 256 KB", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const oversize = "x".repeat(256 * 1024 + 1)
        await expect(
          tool.execute({ action: "write", file: "notes.md", content: oversize } as any, await missionCtx("tv-replay")),
        ).rejects.toThrow(/exceeds limit/)
      },
    })
  })

  test("list returns only the files that currently exist with size + mtime", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const ctx = await missionCtx("m1")
        await tool.execute({ action: "write", file: "frontier.md", content: "A" } as any, ctx)
        await tool.execute({ action: "write", file: "handoff.md", content: "BB" } as any, ctx)
        const result = await tool.execute({ action: "list" } as any, ctx)
        const parsed = JSON.parse(result.output) as { files: Array<{ file: string; size: number; mtime: number }> }
        expect(parsed.files.map((f) => f.file).sort()).toEqual(["frontier.md", "handoff.md"])
        const frontier = parsed.files.find((f) => f.file === "frontier.md")!
        expect(frontier.size).toBe(1)
        expect(typeof frontier.mtime).toBe("number")
      },
    })
  })

  test("write of same file twice does not corrupt — second wins", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const ctx = await missionCtx("m1")
        await tool.execute({ action: "write", file: "notes.md", content: "first" } as any, ctx)
        await tool.execute({ action: "write", file: "notes.md", content: "second" } as any, ctx)
        const result = await tool.execute({ action: "read", file: "notes.md" } as any, ctx)
        expect(result.output).toBe("second")
      },
    })
  })

  test("missions are isolated from each other (each session writes its own directory)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const c1 = await missionCtx("m1")
        const c2 = await missionCtx("m2")
        await tool.execute({ action: "write", file: "notes.md", content: "alpha" } as any, c1)
        await tool.execute({ action: "write", file: "notes.md", content: "beta" } as any, c2)
        const r1 = await tool.execute({ action: "read", file: "notes.md" } as any, c1)
        const r2 = await tool.execute({ action: "read", file: "notes.md" } as any, c2)
        expect(r1.output).toBe("alpha")
        expect(r2.output).toBe("beta")
      },
    })
  })
})
