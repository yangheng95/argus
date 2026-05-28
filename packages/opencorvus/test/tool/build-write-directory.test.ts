import { describe, expect, test } from "bun:test"
import path from "path"
import type { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { assertBuildWriteDirectory } from "../../src/tool/external-directory"
import { BashTool } from "../../src/tool/bash"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const baseCtx: Omit<Tool.Context, "ask" | "sessionID"> = {
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

describe("tool.assertBuildWriteDirectory", () => {
  test("blocks build sessions from writing outside their assigned directory", async () => {
    await using tmp = await tmpdir()
    await resetDatabase()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({
            kind: "build",
            goalID: Identifier.ascending("goal"),
            title: "build",
          })
          const ctx: Tool.Context = {
            ...baseCtx,
            sessionID: session.id,
            ask: async () => {
              throw new Error("permission ask should not be used")
            },
          }

          await assertBuildWriteDirectory(ctx, path.join(tmp.path, "inside.txt"))
          await expect(
            assertBuildWriteDirectory(ctx, path.join(path.dirname(tmp.path), `${path.basename(tmp.path)}-outside.txt`)),
          ).rejects.toThrow("cannot write outside its assigned directory")
        },
      })
    } finally {
      await Instance.disposeAll()
      await resetDatabase()
    }
  })

  test("blocks build bash commands from running outside their assigned directory", async () => {
    await using tmp = await tmpdir()
    await resetDatabase()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({
            kind: "build",
            goalID: Identifier.ascending("goal"),
            title: "build",
          })
          const ctx: Tool.Context = {
            ...baseCtx,
            sessionID: session.id,
            ask: async () => {
              throw new Error("permission ask should not be used")
            },
          }
          const bash = await BashTool.init()

          await expect(
            bash.execute(
              {
                command: "pwd",
                description: "Print current directory",
                workdir: path.dirname(tmp.path),
              },
              ctx,
            ),
          ).rejects.toThrow("cannot write outside its assigned directory")
        },
      })
    } finally {
      await Instance.disposeAll()
      await resetDatabase()
    }
  })

  test("blocks build bash commands from cd-ing outside their assigned directory", async () => {
    await using tmp = await tmpdir()
    await resetDatabase()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({
            kind: "build",
            goalID: Identifier.ascending("goal"),
            title: "build",
          })
          const ctx: Tool.Context = {
            ...baseCtx,
            sessionID: session.id,
            ask: async () => {
              throw new Error("permission ask should not be used")
            },
          }
          const bash = await BashTool.init()
          const outside = path.dirname(tmp.path).replaceAll("\\", "/")

          await expect(
            bash.execute(
              {
                command: `cd "${outside}" && git status --porcelain`,
                description: "Check git status outside worktree",
              },
              ctx,
            ),
          ).rejects.toThrow("cannot write outside its assigned directory")
        },
      })
    } finally {
      await Instance.disposeAll()
      await resetDatabase()
    }
  })
})
