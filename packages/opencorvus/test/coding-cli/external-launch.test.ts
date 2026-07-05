import { describe, expect, test } from "bun:test"
import { CodingCli } from "../../src/coding-cli"
import { Instance } from "../../src/project/instance"
import { SystemTerminal } from "../../src/system-terminal"
import { tmpdir } from "../fixture/fixture"

const INSTANCE_STARTUP_TIMEOUT_MS = 60_000

function terminalConfig() {
  return {
    terminal: {
      default_profile_id: "powershell",
      profiles: {
        powershell: {
          label: "PowerShell",
          command: process.platform === "win32" ? "powershell.exe" : "bash",
          args: [],
          env: { TERM: "xterm-256color" },
          icon: process.platform === "win32" ? "powershell" : "bash",
        },
      },
    },
  }
}

describe("coding CLI external launch", () => {
  test("lists installed coding CLIs from explicit command env without adding PTY profiles", async () => {
    const previous = process.env.OPENCORVUS_CODING_CLI_CODEX_BIN
    process.env.OPENCORVUS_CODING_CLI_CODEX_BIN = process.execPath
    try {
      const listed = await CodingCli.list()

      expect(listed.profiles).toContainEqual({ id: "codex", label: "Codex", icon: "codex" })
      expect(listed.profiles.every((profile) => !profile.id.startsWith("coding-"))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_CODING_CLI_CODEX_BIN
      else process.env.OPENCORVUS_CODING_CLI_CODEX_BIN = previous
    }
  })

  test("accepts quoted explicit CLI command env paths", async () => {
    const previous = process.env.OPENCORVUS_CODING_CLI_CLAUDE_CODE_BIN
    process.env.OPENCORVUS_CODING_CLI_CLAUDE_CODE_BIN = `'"${process.execPath}"'`
    try {
      const listed = await CodingCli.list()

      expect(listed.profiles).toContainEqual({ id: "claude-code", label: "Claude Code", icon: "claude-code" })
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_CODING_CLI_CLAUDE_CODE_BIN
      else process.env.OPENCORVUS_CODING_CLI_CLAUDE_CODE_BIN = previous
    }
  })

  test("builds a system terminal command for an external coding CLI", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "cmd.exe",
      profile: { command: "cmd.exe", args: [], icon: "command-prompt" },
      command: "C:\\Tools\\Codex CLI\\codex.cmd",
      args: [],
      keepOpen: true,
    })

    expect(command.command).toBe("cmd.exe")
    expect(command.args).toEqual([
      "/d",
      "/s",
      "/k",
      '"C:\\Tools\\Codex CLI\\codex.cmd"',
    ])
    expect(command.windowsVerbatimArguments).toBe(true)
  })

  test(
    "open rejects unknown CLI and outside cwd before spawning",
    async () => {
      await using dir = await tmpdir({ git: true, config: terminalConfig() })
      await using outside = await tmpdir({ git: true })

      const previous = process.env.OPENCORVUS_CODING_CLI_CODEX_BIN
      process.env.OPENCORVUS_CODING_CLI_CODEX_BIN = process.execPath
      try {
        await Instance.provide({
          directory: dir.path,
          fn: async () => {
            await expect(
              CodingCli.open({ cliID: "missing", terminalProfileID: "powershell", cwd: dir.path }),
            ).rejects.toBeInstanceOf(CodingCli.ConfigError)
            await expect(
              CodingCli.open({ cliID: "codex", terminalProfileID: "powershell", cwd: outside.path }),
            ).rejects.toBeInstanceOf(SystemTerminal.ConfigError)
            await expect(
              CodingCli.open({ cliID: "codex", terminalProfileID: "missing", cwd: dir.path }),
            ).rejects.toBeInstanceOf(SystemTerminal.ConfigError)
          },
        })
      } finally {
        if (previous === undefined) delete process.env.OPENCORVUS_CODING_CLI_CODEX_BIN
        else process.env.OPENCORVUS_CODING_CLI_CODEX_BIN = previous
      }
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )
})
