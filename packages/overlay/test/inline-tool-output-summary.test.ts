import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const INLINE_TOOL_PART = path.resolve(import.meta.dir, "..", "src", "components", "InlineToolPart.tsx")

function outputSummarySource(): string {
  const source = readFileSync(INLINE_TOOL_PART, "utf8")
  const match = source.match(/<summary class="msg-tool-output-summary"[\s\S]*?<\/summary>/)
  if (!match) throw new Error("Tool output summary markup not found")
  return match[0]
}

describe("inline tool output summary", () => {
  test("does not render line or character counters", () => {
    const summary = outputSummarySource()

    expect(summary).toContain('aria-label="Toggle tool output"')
    expect(summary).not.toMatch(/\bline(?:s|Count)?\b/i)
    expect(summary).not.toMatch(/\bchars?\b/i)
    expect(summary).not.toContain("text.length")
  })
})
