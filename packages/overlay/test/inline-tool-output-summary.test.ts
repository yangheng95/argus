import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const INLINE_TOOL_PART = path.resolve(import.meta.dir, "..", "src", "components", "InlineToolPart.tsx")

describe("inline tool output", () => {
  test("renders completed plain output directly without nested disclosure", () => {
    const source = readFileSync(INLINE_TOOL_PART, "utf8")

    expect(source).toContain('<div class="msg-tool-output">{text}</div>')
    expect(source).not.toContain("<details")
    expect(source).not.toContain("<summary")
    expect(source).not.toContain("msg-tool-output-summary")
    expect(source).not.toContain("msg-tool-output-details")
    expect(source).not.toContain("Toggle tool output")
    expect(source).not.toContain("text.length")
  })

  test("browser screenshot evidence uses the authenticated resource loader", () => {
    const source = readFileSync(INLINE_TOOL_PART, "utf8")

    expect(source).toContain("fetchResourceAsObjectUrl")
    expect(source).toContain("peekResourceObjectUrl")
    expect(source).toContain("function BrowserEvidenceImage")
    expect(source).toContain('<BrowserEvidenceImage url={evidence().screenshotUrl} alt="Browser observation" />')
    expect(source).not.toContain("src={resolveResourceUrl(evidence().screenshotUrl)}")
  })
})
