import { describe, expect, test } from "bun:test"
import { CodingCli } from "../../src/coding-cli"
import { Instance } from "../../src/project/instance"
import { TerminalProfile } from "../../src/pty/profile"
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

  test("builds a selected terminal command instead of a PTY profile command", () => {
    const terminal: TerminalProfile.Resolved = {
      id: "powershell",
      label: "PowerShell",
      command: process.platform === "win32" ? "powershell.exe" : "pwsh",
      args: ["-NoLogo"],
      env: { TERM: "xterm-256color" },
      icon: "powershell",
    }
    const cli: CodingCli.Resolved = {
      id: "codex",
      label: "Codex",
      icon: "codex",
      command: "C:\\Tools\\Codex CLI\\codex.cmd",
      args: [],
    }

    const command = CodingCli.buildTerminalCommand({ terminal, cli, cwd: "C:\\repo" })

    expect(command.command).toBe(terminal.command)
    expect(command.args).toContain("-NoExit")
    expect(command.args.join(" ")).toContain("codex.cmd")
    expect(command.args.join(" ")).not.toContain("profileID")
  })

  test("open rejects unknown CLI and outside cwd before spawning", async () => {
    await using dir = await tmpdir({ git: true, config: terminalConfig() })
    await using outside = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await expect(
          CodingCli.open({ cliID: "missing", terminalProfileID: "powershell", cwd: dir.path }),
        ).rejects.toBeInstanceOf(CodingCli.ConfigError)
        await expect(
          CodingCli.open({ cliID: "codex", terminalProfileID: "powershell", cwd: outside.path }),
        ).rejects.toBeInstanceOf(TerminalProfile.ConfigError)
      },
    })
  })
})
