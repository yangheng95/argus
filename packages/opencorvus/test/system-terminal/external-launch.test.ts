import { describe, expect, test } from "bun:test"
import { SystemTerminal } from "../../src/system-terminal"

describe("system terminal external launch command", () => {
  test("Windows opens the selected shell through the system console launcher", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "cmd.exe",
      profile: { command: "powershell.exe", args: ["-NoLogo"], icon: "powershell" },
    })

    expect(command).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", "/D", "C:\\repo", "powershell.exe", "-NoLogo"],
    })
  })

  test("Windows coding CLI opens inside the system console without PTY", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "cmd.exe",
      profile: { command: "cmd.exe", args: [], icon: "command-prompt" },
      command: "C:\\Tools\\Codex CLI\\codex.cmd",
      args: ["--dangerously-bypass-approvals-and-sandbox"],
      keepOpen: true,
    })

    expect(command.command).toBe("cmd.exe")
    expect(command.args).toEqual([
      "/d",
      "/s",
      "/c",
      "start",
      "",
      "/D",
      "C:\\repo",
      "cmd.exe",
      "/k",
      "C:\\Tools\\Codex CLI\\codex.cmd",
      "--dangerously-bypass-approvals-and-sandbox",
    ])
    expect(command.args.join(" ")).not.toContain("pty")
  })

  test("Windows coding CLI unwraps user-supplied executable quotes before argv handoff", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "cmd.exe",
      profile: { command: "cmd.exe", args: [], icon: "command-prompt" },
      command: `'"C:\\Users\\hengu\\.local\\bin\\claude.exe"'`,
      args: [],
      keepOpen: true,
    })

    expect(command.args.at(-1)).toBe("C:\\Users\\hengu\\.local\\bin\\claude.exe")
    expect(command.args.at(-1)).not.toContain("'")
    expect(command.args.at(-1)).not.toContain('"')
  })

  test("Windows PowerShell profile receives a PowerShell command, not cmd.exe quoting", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "cmd.exe",
      profile: { command: "powershell.exe", args: ["-NoLogo"], icon: "powershell" },
      command: "C:\\Users\\chuan\\.local\\bin\\claude.exe",
      args: ["--version"],
      keepOpen: true,
    })

    expect(command.args).toEqual([
      "/d",
      "/s",
      "/c",
      "start",
      "",
      "/D",
      "C:\\repo",
      "powershell.exe",
      "-NoLogo",
      "-NoExit",
      "-Command",
      "& 'C:\\Users\\chuan\\.local\\bin\\claude.exe' '--version'",
    ])
  })

  test("macOS opens Terminal.app through osascript", () => {
    const command = SystemTerminal.buildCommand({
      platform: "darwin",
      cwd: "/repo/app",
      terminalApp: "/usr/bin/osascript",
      profile: { command: "/bin/zsh", args: ["-l"], icon: "terminal" },
    })

    expect(command.command).toBe("/usr/bin/osascript")
    expect(command.args).toContain("-e")
    expect(command.args.join("\n")).toContain('tell application "Terminal"')
    expect(command.args.join("\n")).toContain("cd '/repo/app'; exec '/bin/zsh' '-l'")
  })

  test("Linux opens the configured terminal emulator with a shell command", () => {
    const command = SystemTerminal.buildCommand({
      platform: "linux",
      cwd: "/repo/app",
      terminalApp: "x-terminal-emulator",
      profile: { command: "/bin/bash", args: ["-l"], icon: "bash" },
    })

    expect(command).toEqual({
      command: "x-terminal-emulator",
      args: ["-e", "sh", "-lc", "cd '/repo/app'; exec '/bin/bash' '-l'"],
    })
  })

  test("Linux coding CLI keeps the selected terminal profile after command exit", () => {
    const command = SystemTerminal.buildCommand({
      platform: "linux",
      cwd: "/repo/app",
      terminalApp: "x-terminal-emulator",
      profile: { command: "/bin/zsh", args: ["-l"], icon: "terminal" },
      command: "/usr/local/bin/claude",
      args: ["--version"],
      keepOpen: true,
    })

    expect(command).toEqual({
      command: "x-terminal-emulator",
      args: ["-e", "sh", "-lc", "cd '/repo/app' && '/usr/local/bin/claude' '--version'; exec '/bin/zsh' '-l' '-i'"],
    })
  })
})
