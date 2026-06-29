import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const INLINE_TOOL_PART = path.resolve(import.meta.dir, "..", "src", "components", "InlineToolPart.tsx")
const MESSAGES_CSS = path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "messages.css")

describe("inline tool output", () => {
  test("renders completed plain output directly without nested disclosure", () => {
    const source = readFileSync(INLINE_TOOL_PART, "utf8")

    expect(source).toContain('<div class="msg-tool-output">')
    expect(source).toContain("<StaticTextPart text={text} />")
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
    expect(source).toContain(
      "<BrowserEvidenceImage url={evidence().screenshotUrl} alt={browserEvidenceAlt(evidence())} />",
    )
    expect(source).not.toContain('alt="Browser observation"')
    expect(source).not.toContain("src={resolveResourceUrl(evidence().screenshotUrl)}")
  })

  test("generic tool image attachments render through file parts", () => {
    const source = readFileSync(INLINE_TOOL_PART, "utf8")
    const css = readFileSync(MESSAGES_CSS, "utf8")

    expect(source).toContain('import { FilePart } from "./FilePart"')
    expect(source).toContain("function toolImageAttachments")
    expect(source).toContain("function browserEvidenceScreenshotUrlFromState")
    expect(source).toContain("Array.isArray(state.attachments)")
    expect(source).toContain("Array.isArray(part?.attachments)")
    expect(source).toContain("if (browserScreenshotUrl && url === browserScreenshotUrl) return []")
    expect(source).toContain("toolImageAttachments(props.part, state(), browserEvidenceScreenshotUrl())")
    expect(source).toContain('<section class="msg-tool-attachments">')
    expect(source).toContain("<For each={attachmentImages()}>")
    expect(source).toContain("<FilePart part={attachment} />")
    expect(css).toContain(".msg-tool-attachments")
    expect(css).toContain(".msg-tool-attachments .msg-img-wrap")
    expect(css).toContain('.msg-tool-attachments .oc-button[data-ui="image-preview-trigger"].msg-image-trigger')
    expect(css).toContain(".msg-tool-attachments .md-img")
  })

  test("tool diff file openers use the Button primitive", () => {
    const source = readFileSync(INLINE_TOOL_PART, "utf8")
    const css = readFileSync(MESSAGES_CSS, "utf8")

    expect(source).toContain('import { Button } from "./ui/Button"')
    expect(source).toContain('data-ui="tool-diff-open-file"')
    expect(source).toContain("data-file-path={item.openPath}")
    expect(source).toContain('tc("files.changed", props.items.length)')
    expect(source).not.toContain('props.items.length === 1 ? "file" : "files"')
    expect(source).toContain('variant="ghost"')
    expect(source).toContain('tone="accent"')
    expect(source).not.toContain('class="msg-tool-diff-link"')
    expect(source).not.toContain('href="#" data-file-path={item.openPath}')
    expect(css).toContain('.oc-button[data-ui="tool-diff-open-file"]')
    expect(css).not.toContain(".msg-tool-diff-link")
  })
})
