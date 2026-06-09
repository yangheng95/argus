import { describe, expect, test } from "bun:test"
import { extractInformationMissingBlock, messageHasInformationMissing } from "../../src/agent/runner"

/**
 * Pure-function tests for the INFORMATION MISSING detection helpers
 * called by `runAgentSession` immediately before host process.exit.
 * The runner's exit wiring itself is not tested here (process.exit
 * cannot be stubbed without spawning a child process); the contract
 * is "if helper returns true, host exits", and the helper is the unit
 * under test.
 */

describe("messageHasInformationMissing", () => {
  test("text part with the open tag → true", () => {
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "<INFORMATION MISSING>\n  <item>retry reason absent</item>\n</INFORMATION MISSING>" },
        ],
      }),
    ).toBe(true)
  })

  test("text part containing the tag in the middle of other content → true", () => {
    // Edge: an LLM that didn't follow "emit ONLY this block" would still
    // hit detection. The host's job is to surface ANY emit, even a
    // non-compliant one — the diagnostic value of the tag is the same.
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "Sure, I'll explain. <INFORMATION MISSING><item>x</item></INFORMATION MISSING>" },
        ],
      }),
    ).toBe(true)
  })

  test("multiple text parts, only one carries the tag → true", () => {
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "first part" },
          { type: "text", text: "<INFORMATION MISSING><item>x</item></INFORMATION MISSING>" },
          { type: "text", text: "third part" },
        ],
      }),
    ).toBe(true)
  })

  test("no text part contains the tag → false", () => {
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Normal output without the tag." }],
      }),
    ).toBe(false)
  })

  test("zero parts → false", () => {
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [],
      }),
    ).toBe(false)
  })

  test("non-assistant role → false (defensive — host only stamps it on assistant)", () => {
    expect(
      messageHasInformationMissing({
        info: { role: "user" },
        parts: [{ type: "text", text: "<INFORMATION MISSING><item>x</item></INFORMATION MISSING>" }],
      }),
    ).toBe(false)
  })

  test("non-text part type with the tag in some other field → false", () => {
    // Tool-call parts / structured parts with the tag in a sibling field
    // are not the contract. Only assistant text emits trigger the host
    // exit.
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [{ type: "tool_use", text: "<INFORMATION MISSING><item>x</item></INFORMATION MISSING>" } as any],
      }),
    ).toBe(false)
  })

  test("text part with text=undefined → false (defensive)", () => {
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [{ type: "text", text: undefined }],
      }),
    ).toBe(false)
  })

  test("case-sensitive: lowercase 'information missing' does NOT trigger", () => {
    // The tag is a structured marker the prompt instructs the LLM to
    // emit verbatim — case variants are LLM natural-language phrasing
    // about the topic, not the structured signal. Don't false-positive.
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [{ type: "text", text: "I am missing information about the contract." }],
      }),
    ).toBe(false)
  })

  test("partial tag (open without close) → still true (LLM may stream-truncate)", () => {
    // If the close tag never arrived (provider stream cut), we still
    // exit because the open tag alone proves the LLM committed to the
    // diagnostic.
    expect(
      messageHasInformationMissing({
        info: { role: "assistant" },
        parts: [{ type: "text", text: "<INFORMATION MISSING>\n  <item>truncated mid-stream" }],
      }),
    ).toBe(true)
  })
})

describe("extractInformationMissingBlock", () => {
  test("returns the verbatim block including both tags", () => {
    const block = extractInformationMissingBlock({
      info: { role: "assistant" },
      parts: [
        {
          type: "text",
          text: "preamble\n<INFORMATION MISSING>\n  <item>retry reason absent</item>\n  <item>goal contract empty</item>\n</INFORMATION MISSING>\npostamble",
        },
      ],
    })
    expect(block).not.toBeNull()
    expect(block!).toContain("<INFORMATION MISSING>")
    expect(block!).toContain("</INFORMATION MISSING>")
    expect(block!).toContain("<item>retry reason absent</item>")
    expect(block!).toContain("<item>goal contract empty</item>")
    expect(block!).not.toContain("preamble")
    expect(block!).not.toContain("postamble")
  })

  test("returns the block from the first matching part when multiple parts have one", () => {
    const block = extractInformationMissingBlock({
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "<INFORMATION MISSING><item>first</item></INFORMATION MISSING>" },
        { type: "text", text: "<INFORMATION MISSING><item>second</item></INFORMATION MISSING>" },
      ],
    })
    expect(block).toContain("first")
    expect(block).not.toContain("second")
  })

  test("returns null when no part carries the tag", () => {
    expect(
      extractInformationMissingBlock({
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Normal output." }],
      }),
    ).toBeNull()
  })

  test("partial open-only block returns the truncated tail (helps debugging stream cuts)", () => {
    const block = extractInformationMissingBlock({
      info: { role: "assistant" },
      parts: [{ type: "text", text: "<INFORMATION MISSING>\n  <item>truncated" }],
    })
    expect(block).not.toBeNull()
    expect(block!).toContain("<INFORMATION MISSING>")
    expect(block!).toContain("truncated")
  })

  test("non-assistant role → null", () => {
    expect(
      extractInformationMissingBlock({
        info: { role: "user" },
        parts: [{ type: "text", text: "<INFORMATION MISSING><item>x</item></INFORMATION MISSING>" }],
      }),
    ).toBeNull()
  })
})
