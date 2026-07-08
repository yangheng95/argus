import { describe, expect, mock, test } from "bun:test"
import { PassThrough } from "node:stream"
import { tmpdir } from "../../fixture/fixture"

const killedSignals: string[] = []

mock.module("../../../src/runtime/ripgrep", () => ({
  resolveRipgrepRuntime: async () => ({ filepath: "mock-rg", packaged: false }),
}))

mock.module("../../../src/util/process", () => ({
  Process: {
    spawn: () => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      let resolveExit!: (code: number) => void
      const exited = new Promise<number>((resolve) => {
        resolveExit = resolve
      })
      const child = {
        stdout,
        stderr,
        exited,
        exitCode: null as number | null,
        signalCode: null as string | null,
        kill(signal: string = "SIGTERM") {
          killedSignals.push(signal)
          child.signalCode = signal
          stdout.end()
          stderr.end()
          resolveExit(1)
          return true
        },
      }
      queueMicrotask(() => stdout.write("first.txt\nsecond.txt\n"))
      return child
    },
  },
}))

const { Ripgrep } = await import("../../../src/file/ripgrep")

describe("ripgrep early stop", () => {
  test("terminates the child process when files iteration stops early", async () => {
    await using tmp = await tmpdir()

    for await (const file of Ripgrep.files({ cwd: tmp.path })) {
      expect(file).toBe("first.txt")
      break
    }

    expect(killedSignals).toContain("SIGTERM")
  })
})
