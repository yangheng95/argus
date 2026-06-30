import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REASONING_PART_TSX = readFileSync(join(import.meta.dir, "..", "src", "components", "ReasoningPart.tsx"), "utf8")
const MESSAGES_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "surfaces", "messages.css"), "utf8")

test("ReasoningPart defaults to full-height reasoning text and can be collapsed", () => {
  expect(REASONING_PART_TSX).toContain('import { Button } from "./ui/Button"')
  expect(REASONING_PART_TSX).toContain('import { StreamingMarkdownPart } from "./TextPart"')
  expect(REASONING_PART_TSX).toContain("const [expanded, setExpanded] = createSignal(true)")
  expect(REASONING_PART_TSX).toContain('data-expanded={expanded() ? "true" : "false"}')
  expect(REASONING_PART_TSX).not.toContain("<button")
  expect(REASONING_PART_TSX).toContain("<Button")
  expect(REASONING_PART_TSX).toContain('variant="ghost"')
  expect(REASONING_PART_TSX).toContain('size="mini"')
  expect(REASONING_PART_TSX).toContain('tone="accent"')
  expect(REASONING_PART_TSX).toContain('data-ui="reasoning-toggle"')
  expect(REASONING_PART_TSX).toContain("aria-expanded={expanded()}")
  expect(REASONING_PART_TSX).toContain("event.stopPropagation()")
  expect(REASONING_PART_TSX).toContain("setExpanded(!expanded())")
  expect(REASONING_PART_TSX).toContain("<StreamingMarkdownPart")
  expect(REASONING_PART_TSX).toContain('className="reasoning-text md-content"')
  expect(REASONING_PART_TSX).toContain('activeTextClassName="md-active-text reasoning-text--streaming"')
  expect(REASONING_PART_TSX).not.toContain('innerHTML={renderedHtml()}')
  expect(REASONING_PART_TSX).not.toContain("visibleStreamingText(text())")
  expect(REASONING_PART_TSX).not.toContain("renderMarkdown(text())")
})

test("ReasoningPart toggle styling is owned by the Button primitive selector", () => {
  expect(MESSAGES_CSS).not.toMatch(/\.reasoning-label\b/)
  expect(MESSAGES_CSS).toContain('.oc-button[data-ui="reasoning-toggle"]')
  expect(MESSAGES_CSS).not.toMatch(/reasoning-toggle[^{}]*:focus-visible[\s\S]*outline:\s*none/)
})
