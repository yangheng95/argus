import { describe, expect, test } from "bun:test"
import { hasTuiHostTerminalSizeChanged } from "../src/plugins/coding-agent-tui/terminal-size"

describe("tui host terminal helpers", () => {
  test("detects real terminal size changes and ignores duplicate resize events", () => {
    expect(hasTuiHostTerminalSizeChanged(undefined, { cols: 100, rows: 30 })).toBe(true)
    expect(hasTuiHostTerminalSizeChanged({ cols: 100, rows: 30 }, { cols: 100, rows: 30 })).toBe(false)
    expect(hasTuiHostTerminalSizeChanged({ cols: 100, rows: 30 }, { cols: 101, rows: 30 })).toBe(true)
    expect(hasTuiHostTerminalSizeChanged({ cols: 100, rows: 30 }, { cols: 100, rows: 31 })).toBe(true)
  })
})
