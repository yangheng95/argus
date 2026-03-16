import { describe, expect, test } from "bun:test"
import { Shell } from "../src/shell/shell"

describe("shell selection", () => {
  test("ignores powershell from SHELL on windows", () => {
    expect(Shell.fromEnv("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "win32")).toBeUndefined()
  })

  test("accepts bash from SHELL on windows", () => {
    expect(Shell.fromEnv("C:\\Program Files\\Git\\bin\\bash.exe", "win32")).toBe(
      "C:\\Program Files\\Git\\bin\\bash.exe",
    )
  })

  test("keeps user shell on non-windows platforms", () => {
    expect(Shell.fromEnv("/bin/zsh", "darwin")).toBe("/bin/zsh")
  })
})
