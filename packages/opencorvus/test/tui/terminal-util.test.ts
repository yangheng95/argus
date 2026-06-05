import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Terminal } from "../../src/cli/cmd/tui/util/terminal"

const root = path.resolve(import.meta.dir, "../..")
const tuiRoot = path.join(root, "src/cli/cmd/tui")

describe("OpenCode terminal utility copy", () => {
  test("keeps terminal color probing in the copied utility instead of app inline code", async () => {
    const terminal = await readFile(path.join(tuiRoot, "util/terminal.ts"), "utf8")
    const app = await readFile(path.join(tuiRoot, "app.tsx"), "utf8")

    expect(terminal).toContain("Copied from OpenCode")
    expect(terminal).toContain("export namespace Terminal")
    expect(terminal).toContain("export async function colors()")
    expect(terminal).toContain("export async function getTerminalBackgroundColor()")
    expect(terminal).toContain('process.stdout.write("\\x1b]11;?\\x07")')
    expect(terminal).toContain('process.stdout.write("\\x1b]10;?\\x07")')
    expect(terminal).toContain("for (let i = 0; i < 16; i++)")

    expect(app).toContain('import { Terminal } from "./util/terminal"')
    expect(app).toContain("Terminal.getTerminalBackgroundColor()")
    expect(app).not.toContain("async function getTerminalBackgroundColor")
    expect(app).not.toContain('process.stdout.write("\\x1b]11;?\\x07")')
  })

  test("returns dark and no colors when stdin is not a TTY", async () => {
    const stdin = process.stdin as typeof process.stdin & { isTTY?: boolean }
    const original = stdin.isTTY
    Object.defineProperty(stdin, "isTTY", { configurable: true, value: false })
    try {
      await expect(Terminal.colors()).resolves.toEqual({ background: null, foreground: null, colors: [] })
      await expect(Terminal.getTerminalBackgroundColor()).resolves.toBe("dark")
    } finally {
      Object.defineProperty(stdin, "isTTY", { configurable: true, value: original })
    }
  })
})
