import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("ConversationAgentRail reads workflow through the projection and lane helper", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("buildAgentWorkflow(")
  expect(source).toContain("buildAgentWorkflowLanes")
  expect(source).not.toContain("compactAgentWorkflowLanesForNarrowRail")
  expect(source).not.toContain("LaneAvatarStack")
  expect(source).not.toContain("conversation-agent-rail__stack")
  expect(source).not.toContain("payload.report")
  expect(source).not.toContain("event.kind")
})

test("ConversationAgentRail locates cards through renderedCardID and CSS.escape", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("record.renderedCardID")
  expect(source).toContain("CSS.escape(record.renderedCardID")
  expect(source).toContain("setCardExpanded(parentID, true")
  expect(source).toContain("renderedCardHead(target)")
  expect(source).toContain("chat-bubble__head")
  expect(source).toContain("card__head")
  expect(source).toContain('scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" })')
  expect(source).not.toContain('scrollIntoView({ block: "center"')
})

test("ConversationAgentRail uses bottom-strip height resizing instead of left-column width", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  const html = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
  expect(source).toContain("--conversation-agent-rail-height")
  expect(source).toContain("startY - move.clientY")
  expect(source).not.toContain("--conversation-agent-rail-width")
  expect(css).toContain("border-top: var(--oc-border-width) solid color-mix(in srgb, var(--border) 82%, transparent)")
  expect(css).toContain("height: calc(var(--conversation-agent-rail-height, 42) * 1px * var(--ui-scale))")
  expect(css).toContain("flex-direction: row")
  expect(css).toContain("overflow-x: auto")
  expect(css).toContain(".conversation-agent-rail .chat-avatar")
  expect(css).toContain("border-left: calc(2px * var(--ui-scale)) solid color-mix(in srgb, var(--card-stage, var(--accent)) 72%, transparent)")
  expect(html.indexOf('id="conversationBody"')).toBeLessThan(html.indexOf('id="solidConversationAgentRailMount"'))
})

test("ConversationAgentRail hides the bottom strip when there are no workflow lanes", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  expect(source).toContain("const hasLanes = createMemo(() => lanes().length > 0)")
  expect(source).toContain("<Show when={hasLanes()}>")
  expect(source).not.toContain("conversation-agent-rail__empty")
  expect(css).toContain(".conversation-agent-rail-host:empty")
  expect(css).toContain("display: none;")
})

test("ConversationAgentRail only polls task trace for the wide report surface", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("const shouldFetchTrace = createMemo(() => wide())")
  expect(source).toContain("if (!taskID || !shouldFetchTrace) return { ok: true as const, events: [], traceDir: \"\", enabled: true }")
  expect(source).toContain("if (!id || !shouldFetchTrace() || trace.loading")
})

test("AgentReportDialog renders markdown report content through the central renderer", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/AgentReportDialog.tsx"), "utf8")
  expect(source).toContain("renderMarkdown")
  expect(source).toContain("traceReport.detail")
  expect(source).toContain("md-content")
  expect(source).not.toContain("displaySummary")
})
