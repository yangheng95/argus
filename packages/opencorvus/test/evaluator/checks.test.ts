import { afterEach, expect, test } from "bun:test"
import { commandResult } from "../../src/evaluator/checks"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const POWERSHELL = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : "powershell.exe"

afterEach(() => {
  delete process.env.SHELL
})

test("commandResult falls back from powershell for chained Windows commands", async () => {
  if (process.platform !== "win32") return
  await using tmp = await tmpdir({ git: true })
  process.env.SHELL = POWERSHELL

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await commandResult(
        {
          command: "echo alpha && echo beta",
          cwd: tmp.path,
        },
        5_000,
      )

      expect(result.code).toBe(0)
      expect(result.output).toContain("alpha")
      expect(result.output).toContain("beta")
    },
  })
})
