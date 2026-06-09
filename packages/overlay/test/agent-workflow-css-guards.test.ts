import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")

test("agent rail expanded report surface stays deleted", () => {
  expect(css).not.toContain("agent-report-dialog")
  expect(css).not.toContain("conversation-agent-rail__resize")
  expect(css).not.toContain("conversation-agent-rail__report")
  expect(css).not.toContain("conversation-agent-rail__run")
})

test("old workflow report section and pre scroll rules stay deleted", () => {
  expect(css).not.toContain(".agent-workflow-report-section:last-child")
  expect(css).not.toContain(".agent-workflow-report-section pre")
  expect(css).not.toContain("max-height: calc(340px * var(--ui-scale))")
})
