import { describe, expect, test } from "bun:test"
import { CodingCli } from "../../src/coding-cli"
import { Instance } from "../../src/project/instance"
import { SystemTerminal } from "../../src/system-terminal"
import { tmpdir } from "../fixture/fixture"

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

  test("builds a system terminal command for an external coding CLI", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "wt.exe",
      command: "C:\\Tools\\Codex CLI\\codex.cmd",
      args: [],
      keepOpen: true,
    })

    expect(command.command).toBe("wt.exe")
    expect(command.args).toContain("-d")
    expect(command.args).toContain("C:\\repo")
    expect(command.args).toContain("cmd.exe")
    expect(command.args).toContain("/k")
    expect(command.args.join(" ")).toContain("codex.cmd")
    expect(command.args.join(" ")).not.toContain("profileID")
  })

  test("open rejects unknown CLI and outside cwd before spawning", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })
    await using outside = await tmpdir({ git: true })

    const previous = process.env.OPENCORVUS_CODING_CLI_CODEX_BIN
    process.env.OPENCORVUS_CODING_CLI_CODEX_BIN = process.execPath
    try {
      await Instance.provide({
        directory: dir.path,
        fn: async () => {
          await expect(CodingCli.open({ cliID: "missing", cwd: dir.path })).rejects.toBeInstanceOf(
            CodingCli.ConfigError,
          )
          await expect(CodingCli.open({ cliID: "codex", cwd: outside.path })).rejects.toBeInstanceOf(
            SystemTerminal.ConfigError,
          )
        },
      })
    } finally {
      if (previous === undefined) delete process.env.OPENCORVUS_CODING_CLI_CODEX_BIN
      else process.env.OPENCORVUS_CODING_CLI_CODEX_BIN = previous
    }
  })
})
