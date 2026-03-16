import { afterEach, expect, test } from "bun:test"
import { commandResult, dependencyInstallPlan } from "../../src/evaluator/checks"
import { Instance } from "../../src/project/instance"
import { which } from "../../src/util/which"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"
import path from "path"

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

test("dependencyInstallPlan prefers the workspace root for pnpm monorepos", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.mkdir(path.join(tmp.path, "apps", "server"), { recursive: true })
  await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ name: "root", private: true }))
  await Bun.write(path.join(tmp.path, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n")
  await Bun.write(path.join(tmp.path, "apps", "server", "package.json"), JSON.stringify({ name: "server" }))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await dependencyInstallPlan(path.join(tmp.path, "apps", "server"))
      expect(plan?.cwd).toBe(tmp.path)
      expect(plan?.command).toBe(which("pnpm") ? "pnpm install" : "npm install")
    },
  })
})

test("dependencyInstallPlan skips installs when node_modules already exists at the install root", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.mkdir(path.join(tmp.path, "apps", "server"), { recursive: true })
  await fs.mkdir(path.join(tmp.path, "node_modules"), { recursive: true })
  await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ name: "root", private: true }))
  await Bun.write(path.join(tmp.path, "package-lock.json"), "{}")
  await Bun.write(path.join(tmp.path, "apps", "server", "package.json"), JSON.stringify({ name: "server" }))
  await Bun.write(path.join(tmp.path, "node_modules", ".keep"), "")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const plan = await dependencyInstallPlan(path.join(tmp.path, "apps", "server"))
      expect(plan).toBeUndefined()
    },
  })
})
