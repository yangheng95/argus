import { describe, expect, test } from "bun:test"
import { SystemTerminal } from "../../src/system-terminal"

describe("system terminal external launch command", () => {
  test("Windows opens Windows Terminal at cwd with the selected shell profile", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "wt.exe",
      profile: { command: "powershell.exe", args: ["-NoLogo"] },
    })

    expect(command).toEqual({
      command: "wt.exe",
      args: ["-d", "C:\\repo", "powershell.exe", "-NoLogo"],
    })
  })

  test("Windows coding CLI opens inside Windows Terminal without PTY", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "wt.exe",
      command: "C:\\Tools\\Codex CLI\\codex.cmd",
      args: ["--dangerously-bypass-approvals-and-sandbox"],
      keepOpen: true,
    })

    expect(command.command).toBe("wt.exe")
    expect(command.args.slice(0, 4)).toEqual(["-d", "C:\\repo", "cmd.exe", "/k"])
    expect(command.args.join(" ")).toContain("codex.cmd")
    expect(command.args.join(" ")).not.toContain("pty")
  })

  test("macOS opens Terminal.app through osascript", () => {
    const command = SystemTerminal.buildCommand({
      platform: "darwin",
      cwd: "/repo/app",
      terminalApp: "/usr/bin/osascript",
      profile: { command: "/bin/zsh", args: ["-l"] },
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
      profile: { command: "/bin/bash", args: ["-l"] },
    })

    expect(command).toEqual({
      command: "x-terminal-emulator",
      args: ["-e", "sh", "-lc", "cd '/repo/app'; exec '/bin/bash' '-l'"],
    })
  })
})
