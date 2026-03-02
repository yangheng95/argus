import { describe, expect, test } from "bun:test"
import { Editor } from "../../../src/cli/cmd/tui/util/editor"

describe("Editor.splitCommand", () => {
  test("splits plain editor command", () => {
    expect(Editor.splitCommand("vim -u NONE")).toEqual(["vim", "-u", "NONE"])
  })

  test("handles quoted editor path with spaces", () => {
    expect(Editor.splitCommand('"C:\\Program Files\\Microsoft VS Code\\Code.exe" --wait')).toEqual([
      "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      "--wait",
    ])
  })

  test("handles single-quoted arguments", () => {
    expect(Editor.splitCommand("nvim '+set ft=markdown'")).toEqual(["nvim", "+set ft=markdown"])
  })

  test("supports escaped spaces outside quotes", () => {
    expect(Editor.splitCommand("code\\ -insiders --wait")).toEqual(["code -insiders", "--wait"])
  })

  test("throws on unmatched quote", () => {
    expect(() => Editor.splitCommand('"code --wait')).toThrow("unmatched quote")
  })
})
