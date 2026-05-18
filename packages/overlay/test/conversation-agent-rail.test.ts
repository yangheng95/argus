import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("ConversationAgentRail reads workflow through the projection and lane helper", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("buildAgentWorkflow(")
  expect(source).toContain("buildAgentWorkflowLanes")
  expect(source).toContain("Index")
  expect(source).not.toContain("compactAgentWorkflowLanesForNarrowRail")
  expect(source).not.toContain("LaneAvatarStack")
  expect(source).not.toContain("conversation-agent-rail__stack")
  expect(source).not.toContain("<For each={lanes()}>")
  expect(source).not.toContain("<For each={lane.records}>")
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

test("ConversationAgentRail keeps a fixed bottom-strip layout instead of a resizable expansion rail", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  const html = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
  expect(source).not.toContain("setHeight(")
  expect(source).not.toContain("beginResize")
  expect(source).not.toContain("--conversation-agent-rail-height")
  expect(source).not.toContain("data-wide=")
  expect(css).toContain("border-top: var(--oc-border-width) solid color-mix(in srgb, var(--border) 82%, transparent)")
  expect(css).toContain("height: calc(42px * var(--ui-scale))")
  expect(css).not.toContain("conversation-agent-rail__resize")
  expect(css).toContain("flex-direction: row")
  expect(css).toContain("overflow-x: auto")
  expect(css).toContain(".conversation-agent-rail .chat-avatar")
  expect(css).toContain("animation: none;")
  expect(html.indexOf('id="conversationBody"')).toBeLessThan(html.indexOf('id="solidConversationAgentRailMount"'))
})

test("ConversationAgentRail keeps avatar DOM stable across workflow refreshes", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  expect(source).toContain("<Index each={lanes()}>")
  expect(source).toContain("<Index each={lane().records}>")
  expect(source).toContain("record: Accessor<AgentWorkflowRecord>")
  expect(css).toContain(".conversation-agent-rail .chat-avatar")
  expect(css).toContain("animation: none;")
  expect(css).toContain(".conversation-agent-rail .chat-avatar::after")
})

test("ConversationAgentRail stays compact and does not keep a widened detail mode", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  expect(source).not.toContain("props.wide")
  expect(source).not.toContain("conversation-agent-rail__run")
  expect(source).toContain('class="conversation-agent-rail__report"')
  expect(css).toContain(".conversation-agent-rail__row")
  expect(css).toContain("grid-template-columns: calc(26px * var(--ui-scale)) calc(24px * var(--ui-scale))")
  expect(css).not.toContain(".conversation-agent-rail__run")
  expect(css).not.toContain("[data-wide=\"true\"]")
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

test("ConversationAgentRail keeps task trace available for the compact report surface", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).not.toContain("shouldFetchTrace")
  expect(source).toContain("if (!taskID) return { ok: true as const, events: [], traceDir: \"\", enabled: true }")
  expect(source).toContain("if (!id || trace.loading")
})

test("ConversationAgentRail does not use streamed card text as workflow summary input", () => {
  const workflow = readFileSync(join(import.meta.dir, "../src/utils/agent-workflow.ts"), "utf8")
  const rail = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(workflow).not.toContain("textFromCard")
  expect(workflow).not.toContain("textFromPart")
  expect(workflow).not.toContain('source: "card_output"')
  expect(rail).toContain("compactLabel(record())")
  expect(rail).not.toContain("No summary")
})

test("AgentReportDialog renders markdown report content through the central renderer", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/AgentReportDialog.tsx"), "utf8")
  expect(source).toContain("renderMarkdown")
  expect(source).toContain("traceReport.detail")
  expect(source).toContain("md-content")
  expect(source).not.toContain("displaySummary")
})
