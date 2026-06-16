import { describe, expect, test } from "bun:test"
import { renderUserRequestSection, USER_REQUEST_BUNDLE_PATH } from "../../src/intent/request-prompt"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

describe("user request prompt injection", () => {
  test("injects the full user request and points at request.md audit copy", () => {
    const request = `${Array.from({ length: 700 }, (_, index) => `word${index + 1}`).join(" ")}\nTAIL   `
    const section = renderUserRequestSection({ heading: "# User Request", request })

    expect(section).toContain("Full user request:")
    expect(section).toContain("word700")
    expect(section).toContain("TAIL   \n\nAudit copy:")
    expect(section).toContain(USER_REQUEST_BUNDLE_PATH)
    expect(section).not.toContain("omitted from prompt injection")
    expect(section).not.toContain("Request excerpt")
  })

  test("uses the concrete task-scoped intent path when taskID is known", () => {
    const section = renderUserRequestSection({
      heading: "# User Request",
      request: "ship the requested feature",
      taskID: "tsk_prompt_path",
    })

    expect(section).toContain(ProjectRuntimePaths.intentPaths("", "tsk_prompt_path").relative)
    expect(section).not.toContain("<taskID>")
  })

  test("does not truncate CJK text before forwarding to agents", () => {
    const request = "\u9700\u6c42".repeat(400)
    const section = renderUserRequestSection({ heading: "# User Request", request })

    expect(section).toContain(request)
    expect(section).not.toContain("omitted")
  })
})
