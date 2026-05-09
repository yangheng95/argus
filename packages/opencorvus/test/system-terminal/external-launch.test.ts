import { describe, expect, test } from "bun:test"
import { SystemTerminal } from "../../src/system-terminal"

describe("system terminal external launch command", () => {
  test("Windows opens the selected shell through the system console launcher", () => {
    const command = SystemTerminal.buildCommand({
      platform: "win32",
      cwd: "C:\\repo",
      terminalApp: "cmd.exe",
      profile: { command: "powershell.exe", args: ["-NoLogo"] },
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
      command: "C:\\Tools\\Codex CLI\\codex.cmd",
      args: ["--dangerously-bypass-approvals-and-sandbox"],
      keepOpen: true,
    })

    expect(command.command).toBe("cmd.exe")
    expect(command.args.slice(0, 9)).toEqual(["/d", "/s", "/c", "start", "", "/D", "C:\\repo", "cmd.exe", "/k"])
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
