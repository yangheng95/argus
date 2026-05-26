import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { MissionStateTool, MISSION_STATE_FILES } from "../../src/tool/mission-state"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: gateway-master-supervisor-2026-05-26.md §2.2.
 *
 * mission_state is path-confined I/O for the gateway-master supervisor.
 * The boundary is the protection — master cannot read or write outside
 * `.opencorvus/runtime/gateway-master/<missionID>/<file>` where file is
 * one of the four hard-coded names.
 */
describe("mission_state validation", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("rejects malformed missionID (separators / case / length) AND non-vocabulary file names", async () => {
    // Batch all validation assertions into a single tmpdir/Instance to
    // amortize the (slow) git-init fixture; spinning a fresh tmpdir per
    // assertion was timing out at 5 s on Windows runners.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const exec = (action: unknown) => tool.execute(action as any, fakeCtx())

        // missionID with path separator / uppercase / special chars / length
        for (const bad of ["../escape", "a/b", "a\\b", "FOO", "foo.bar", "foo bar", "a".repeat(65), ""]) {
          await expect(exec({ action: "read", missionID: bad, file: "frontier.md" })).rejects.toThrow()
        }

        // file name outside the fixed vocabulary (Zod enum rejects)
        await expect(exec({ action: "read", missionID: "m1", file: "random.md" })).rejects.toThrow()
        await expect(exec({ action: "read", missionID: "m1", file: "../etc/passwd" })).rejects.toThrow()
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
        const result = await tool.execute(
          { action: "read", missionID: "tv-replay", file: "frontier.md" } as any,
          fakeCtx(),
        )
        expect(result.output).toBe("")
        expect((result.metadata as any).exists).toBe(false)
      },
    })
  })

  test("write creates directory + file; subsequent read returns content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        const body = "## Outstanding\n- /chart\n- /screener\n"
        await tool.execute(
          { action: "write", missionID: "tv-replay", file: "frontier.md", content: body } as any,
          fakeCtx(),
        )
        const onDisk = await fs.readFile(
          path.join(tmp.path, ".opencorvus", "runtime", "gateway-master", "tv-replay", "frontier.md"),
          "utf8",
        )
        expect(onDisk).toBe(body)
        const result = await tool.execute(
          { action: "read", missionID: "tv-replay", file: "frontier.md" } as any,
          fakeCtx(),
        )
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
          { action: "write", missionID: "tv-replay", file: "tasks.md", content: "task list" } as any,
          fakeCtx(),
        )
        const dir = path.join(tmp.path, ".opencorvus", "runtime", "gateway-master", "tv-replay")
        const entries = await fs.readdir(dir)
        // Only the durable file should remain — no .tmp leftovers from atomicWrite.
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
          tool.execute(
            { action: "write", missionID: "tv-replay", file: "notes.md", content: oversize } as any,
            fakeCtx(),
          ),
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
        await tool.execute({ action: "write", missionID: "m1", file: "frontier.md", content: "A" } as any, fakeCtx())
        await tool.execute({ action: "write", missionID: "m1", file: "handoff.md", content: "BB" } as any, fakeCtx())
        const result = await tool.execute({ action: "list", missionID: "m1" } as any, fakeCtx())
        const parsed = JSON.parse(result.output) as {
          files: Array<{ file: string; size: number; mtime: number }>
        }
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
        await tool.execute({ action: "write", missionID: "m1", file: "notes.md", content: "first" } as any, fakeCtx())
        await tool.execute({ action: "write", missionID: "m1", file: "notes.md", content: "second" } as any, fakeCtx())
        const result = await tool.execute({ action: "read", missionID: "m1", file: "notes.md" } as any, fakeCtx())
        expect(result.output).toBe("second")
      },
    })
  })

  test("missions are isolated from each other", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await MissionStateTool.init()
        await tool.execute({ action: "write", missionID: "m1", file: "notes.md", content: "alpha" } as any, fakeCtx())
        await tool.execute({ action: "write", missionID: "m2", file: "notes.md", content: "beta" } as any, fakeCtx())
        const r1 = await tool.execute({ action: "read", missionID: "m1", file: "notes.md" } as any, fakeCtx())
        const r2 = await tool.execute({ action: "read", missionID: "m2", file: "notes.md" } as any, fakeCtx())
        expect(r1.output).toBe("alpha")
        expect(r2.output).toBe("beta")
      },
    })
  })
})

function fakeCtx() {
  return {
    sessionID: Identifier.ascending("session"),
    messageID: Identifier.ascending("message"),
    agent: "gateway-master",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
  } as any
}
