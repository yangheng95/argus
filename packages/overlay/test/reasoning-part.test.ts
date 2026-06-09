import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REASONING_PART_TSX = readFileSync(join(import.meta.dir, "..", "src", "components", "ReasoningPart.tsx"), "utf8")

test("ReasoningPart defaults to full-height reasoning text and can be collapsed", () => {
  expect(REASONING_PART_TSX).toContain("const [expanded, setExpanded] = createSignal(true)")
  expect(REASONING_PART_TSX).toContain('data-expanded={expanded() ? "true" : "false"}')
  expect(REASONING_PART_TSX).toContain('type="button"')
  expect(REASONING_PART_TSX).toContain("aria-expanded={expanded()}")
  expect(REASONING_PART_TSX).toContain("event.stopPropagation();")
  expect(REASONING_PART_TSX).toContain("setExpanded(!expanded())")
  expect(REASONING_PART_TSX).toContain('<div class="reasoning-text md-content" innerHTML={renderedHtml()} />')
  expect(REASONING_PART_TSX).toContain('<div class="reasoning-text reasoning-text--streaming">{text()}</div>')
})
