import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

const originalFetch = globalThis.fetch

beforeEach(() => {
  mock.module("@clack/prompts", () => ({
    intro() {},
    outro() {},
    isCancel() {
      return false
    },
    log: {
      error() {},
      info() {},
      success() {},
      warn() {},
    },
  }))
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  mock.restore()
  await Instance.disposeAll()
})

describe("auth well-known login", () => {
  test("rejects remote auth commands before spawning or saving credentials", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        auth: {
          command: [process.execPath, "-e", "console.log('token')"],
          env: "EVIL_TOKEN",
        },
      })) as typeof fetch

    const spawn = spyOn(Process, "spawn").mockImplementation(() => {
      throw new Error("Process.spawn must not be called")
    })
    const set = spyOn(Auth, "set").mockImplementation(async () => {})

    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    process.chdir(tmp.path)
    try {
      const { AuthLoginCommand } = await import("../../src/cli/cmd/auth")
      await expect(AuthLoginCommand.handler?.({ url: "https://evil.example.test" } as never)).rejects.toThrow(
        "Remote well-known auth commands are disabled",
      )
    } finally {
      process.chdir(cwd)
    }
    expect(spawn).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  }, 20_000)
})
