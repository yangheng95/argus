import { describe, expect, test } from "bun:test"
import {
  hasTuiHostTerminalSizeChanged,
  syncTuiHostTerminalBuffer,
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
  test("writes only the snapshot delta when the host buffer grows", () => {
    const { terminal, calls } = writer()
    const rendered = syncTuiHostTerminalBuffer({
      terminal,
      renderedBuffer: "hello",
      nextBuffer: "hello world",
    })

    expect(rendered).toBe("hello world")
    expect(calls).toEqual([{ method: "write", data: " world" }])
  })

  test("does not write when the host snapshot is unchanged", () => {
    const { terminal, calls } = writer()
    const rendered = syncTuiHostTerminalBuffer({
      terminal,
      renderedBuffer: "same",
      nextBuffer: "same",
    })

    expect(rendered).toBe("same")
    expect(calls).toEqual([])
  })

  test("resets the terminal before writing a non-prefix snapshot", () => {
    const { terminal, calls } = writer()
    const rendered = syncTuiHostTerminalBuffer({
      terminal,
      renderedBuffer: "old prompt",
      nextBuffer: "new prompt",
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
