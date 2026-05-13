import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("ConversationAgentRail reads workflow through the projection and lane helper", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("buildAgentWorkflow(")
  expect(source).toContain("buildAgentWorkflowLanes")
  expect(source).not.toContain("payload.report")
  expect(source).not.toContain("event.kind")
})

test("ConversationAgentRail locates cards through renderedCardID and CSS.escape", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("record.renderedCardID")
  expect(source).toContain("CSS.escape(record.renderedCardID")
  expect(source).toContain("setCardExpanded(parentID, true")
})

test("AgentReportDialog renders markdown report content through the central renderer", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/AgentReportDialog.tsx"), "utf8")
  expect(source).toContain("renderMarkdown")
  expect(source).toContain("traceReport.detail")
  expect(source).toContain("md-content")
  expect(source).not.toContain("displaySummary")
})
