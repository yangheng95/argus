import { describe, expect, test } from "bun:test"
import { collapseToolOutput } from "../../src/cli/cmd/tui/util/collapse-tool-output"

describe("OpenCode-derived collapseToolOutput", () => {
  test("keeps short output unchanged", () => {
    expect(collapseToolOutput("one\ntwo", 3, 20)).toEqual({
      output: "one\ntwo",
      overflow: false,
    })
  })

  test("collapses output that exceeds the line budget", () => {
    expect(collapseToolOutput("one\ntwo\nthree\nfour", 3, 100)).toEqual({
      output: "one\ntwo\nthree\n…",
      overflow: true,
    })
  })

  test("collapses long preview text by character budget", () => {
    expect(collapseToolOutput("abcdefghij", 3, 5)).toEqual({
      output: "abcd…",
      overflow: true,
    })
  })

  test("counts Unicode code points rather than UTF-16 code units", () => {
    expect(collapseToolOutput("ab😀cde", 3, 5)).toEqual({
      output: "ab😀c…",
      overflow: true,
    })
  })
})
