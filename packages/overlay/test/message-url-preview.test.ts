import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

test("conversation and tool-output text share markdown url preview rendering", () => {
  const markdown = readText("src/utils/markdown.ts")
  const textPart = readText("src/components/TextPart.tsx")
  const toolPart = readText("src/components/InlineToolPart.tsx")
  const main = readText("src/main.tsx")

  expect(markdown).toContain("data-browser-preview-url")
  expect(markdown).toContain("isHttpUrl(raw)")
  expect(textPart).toContain("createStreamingTextPartModel(props, renderMarkdown)")
  expect(toolPart).toContain("<StaticTextPart text={text} />")
  expect(toolPart).toContain("<StaticTextPart text={error()} />")
  expect(main).toContain("openBrowserPreviewFromMessage()")
  expect(main).not.toContain("saveTaskBrowserPreviewTarget")
})
