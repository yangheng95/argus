import { describe, expect, test } from "bun:test"
import { extractMessageMarkdown, extractMessageText, relativeTime } from "../../src/cli/cmd/tui/feature-plugins/session/util"
import type { Part } from "@opencorvus-ai/sdk"

describe("OpenCode session switcher preview utils", () => {
  const parts = [
    { type: "text", text: "first line", id: "part_1", messageID: "msg_1", sessionID: "ses_1" },
    { type: "text", text: "ignored", synthetic: true, id: "part_2", messageID: "msg_1", sessionID: "ses_1" },
    { type: "text", text: "second line", id: "part_3", messageID: "msg_1", sessionID: "ses_1" },
  ] as Part[]

  test("extracts user-visible text parts for preview rows", () => {
    expect(extractMessageText(parts, 80)).toBe("first line second line")
  })

  test("truncates markdown previews and closes open fences", () => {
    const markdown = extractMessageMarkdown(
      [{ type: "text", text: "```ts\nconst answer = 1\nconst next = 2", id: "part_4", messageID: "msg_2", sessionID: "ses_1" } as Part],
      2,
      80,
    )

    expect(markdown).toContain("```ts")
    expect(markdown).toContain("```")
    expect(markdown).toContain("…")
  })

  test("formats recent timestamps without requiring locale fixtures", () => {
    expect(relativeTime(Date.now())).toBe("just now")
  })
})
