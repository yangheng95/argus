import { describe, expect, test } from "bun:test"
import {
  excerptUserRequest,
  renderUserRequestSection,
  USER_REQUEST_BUNDLE_PATH,
  USER_REQUEST_PROMPT_WORD_LIMIT,
} from "../../src/intent/request-prompt"

describe("user request prompt injection", () => {
  test("truncates prompt-visible request to 500 words and points at request.md", () => {
    const request = Array.from({ length: USER_REQUEST_PROMPT_WORD_LIMIT + 2 }, (_, index) => `word${index + 1}`).join(" ")
    const section = renderUserRequestSection({ heading: "# User Request", request })

    expect(section).toContain("word500")
    expect(section).not.toContain("word501")
    expect(section).toContain(USER_REQUEST_BUNDLE_PATH)
    expect(section).toContain("grep/read")
    expect(section).toContain("2 word(s) omitted")
  })

  test("counts CJK text as bounded tokens instead of one unbounded whitespace word", () => {
    const request = "需求".repeat(400)
    const excerpt = excerptUserRequest(request)

    expect(excerpt.truncated).toBe(true)
    expect(excerpt.text.length).toBeLessThan(request.length)
  })
})
