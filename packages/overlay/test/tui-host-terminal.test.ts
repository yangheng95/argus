import { describe, expect, test } from "bun:test"
import {
  hasTuiHostTerminalSizeChanged,
  writeTuiHostTerminalOutput,
  type TuiHostTerminalWriter,
} from "../src/services/tui-host-terminal"

function writer() {
  const calls: Array<{ method: "write" | "reset"; data?: string }> = []
  const terminal: TuiHostTerminalWriter = {
    write(data) {
      calls.push({ method: "write", data })
    },
    reset() {
      calls.push({ method: "reset" })
    },
  }
  return { terminal, calls }
}

describe("tui host terminal helpers", () => {
  test("writes cursor output onto the terminal without replaying old buffer", () => {
    const { terminal, calls } = writer()
    const rendered = writeTuiHostTerminalOutput({
      terminal,
      renderedBuffer: "hello",
      output: { data: " world", truncated: false },
    })

    expect(rendered).toBe("hello world")
    expect(calls).toEqual([{ method: "write", data: " world" }])
  })

  test("does not write when cursor output is empty", () => {
    const { terminal, calls } = writer()
    const rendered = writeTuiHostTerminalOutput({
      terminal,
      renderedBuffer: "same",
      output: { data: "", truncated: false },
    })

    expect(rendered).toBe("same")
    expect(calls).toEqual([])
  })

  test("resets the terminal before writing truncated cursor output", () => {
    const { terminal, calls } = writer()
    const rendered = writeTuiHostTerminalOutput({
      terminal,
      renderedBuffer: "old prompt",
      output: { data: "new prompt", truncated: true },
    })

    expect(rendered).toBe("new prompt")
    expect(calls).toEqual([
      { method: "reset" },
      { method: "write", data: "new prompt" },
    ])
  })

  test("detects real terminal size changes and ignores duplicate resize events", () => {
    expect(hasTuiHostTerminalSizeChanged(undefined, { cols: 100, rows: 30 })).toBe(true)
    expect(hasTuiHostTerminalSizeChanged({ cols: 100, rows: 30 }, { cols: 100, rows: 30 })).toBe(false)
    expect(hasTuiHostTerminalSizeChanged({ cols: 100, rows: 30 }, { cols: 101, rows: 30 })).toBe(true)
    expect(hasTuiHostTerminalSizeChanged({ cols: 100, rows: 30 }, { cols: 100, rows: 31 })).toBe(true)
  })
})
