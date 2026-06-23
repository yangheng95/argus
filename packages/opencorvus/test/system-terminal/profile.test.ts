import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import type { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { TerminalProfile } from "../../src/system-terminal/profile"
import { tmpdir } from "../fixture/fixture"

function generatedBashProfile(command: string): Config.Terminal {
  return {
    default_profile_id: "bash",
    profiles: {
      bash: {
        label: "Bash",
        command,
        args: [],
        env: {
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
        icon: "bash",
      },
    },
  }
}

describe("system terminal generated profile drift", () => {
  test("detects generated profile drift when the generated command no longer resolves", () => {
    const terminal = generatedBashProfile("/definitely/missing/bash")

    expect(TerminalProfile.shouldRegenerateGeneratedProfilesForTest(terminal, () => undefined)).toBe(true)
  })

  test("does not rewrite a custom invalid profile", () => {
    const terminal = generatedBashProfile("/definitely/missing/bash")
    terminal.profiles.bash.label = "Project Bash"

    expect(TerminalProfile.shouldRegenerateGeneratedProfilesForTest(terminal, () => undefined)).toBe(false)
  })

  test("detects generated drift without treating valid custom profiles as generated", () => {
    const terminal = generatedBashProfile("/definitely/missing/bash")
    terminal.default_profile_id = "project"
    terminal.profiles.project = {
      label: "Project Shell",
      command: process.execPath,
      args: [],
      env: {},
      icon: "terminal",
    }

    expect(
      TerminalProfile.shouldRegenerateGeneratedProfilesForTest(terminal, (command) =>
        command === process.execPath ? command : undefined,
      ),
    ).toBe(true)
  })

  test("does not rewrite a generated profile that still resolves on this host", () => {
    const terminal = generatedBashProfile("/bin/bash")

    expect(TerminalProfile.shouldRegenerateGeneratedProfilesForTest(terminal, (command) => command)).toBe(false)
  })

  test("rewrites stale generated profiles in the project .opencorvus config", async () => {
    await using dir = await tmpdir({
      git: true,
      init: async (dirpath) => {
        const configDir = path.join(dirpath, ".opencorvus")
        await fs.mkdir(configDir, { recursive: true })
        await Bun.write(
          path.join(configDir, "opencorvus.jsonc"),
          JSON.stringify({ terminal: generatedBashProfile("/definitely/missing/bash") }, null, 2),
        )
      },
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await TerminalProfile.ensureProjectDefaultProfile()
        const configText = await fs.readFile(path.join(dir.path, ".opencorvus", "opencorvus.jsonc"), "utf8")

        expect(configText).not.toContain("/definitely/missing/bash")
        await expect(TerminalProfile.list()).resolves.toMatchObject({
          profiles: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
        })
      },
    })
  })

  test("preserves valid custom profiles while rewriting stale generated profiles", async () => {
    const terminal = generatedBashProfile("/definitely/missing/bash")
    terminal.default_profile_id = "project"
    terminal.profiles.project = {
      label: "Project Shell",
      command: process.execPath,
      args: [],
      env: {},
      icon: "terminal",
    }
    await using dir = await tmpdir({
      git: true,
      init: async (dirpath) => {
        const configDir = path.join(dirpath, ".opencorvus")
        await fs.mkdir(configDir, { recursive: true })
        await Bun.write(path.join(configDir, "opencorvus.jsonc"), JSON.stringify({ terminal }, null, 2))
      },
    })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await TerminalProfile.ensureProjectDefaultProfile()
        const list = await TerminalProfile.list()
        const configText = await fs.readFile(path.join(dir.path, ".opencorvus", "opencorvus.jsonc"), "utf8")

        expect(list.defaultProfileID).toBe("project")
        expect(list.profiles.some((profile) => profile.id === "project")).toBe(true)
        expect(configText).toContain("Project Shell")
        expect(configText).not.toContain("/definitely/missing/bash")
      },
    })
  })
})
