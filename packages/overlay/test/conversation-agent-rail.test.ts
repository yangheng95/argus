import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("ConversationAgentRail reads workflow through the projection and renders a chronological strip", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("buildAgentWorkflow(")
  expect(source).toContain("mergeAgentRecords")
  expect(source).toContain("conversationAgentRecordsForSource(boardStore.selectedSource)")
  expect(source).toContain("Index")
  expect(source).not.toContain("compactAgentWorkflowLanesForNarrowRail")
  expect(source).not.toContain("LaneAvatarStack")
  expect(source).not.toContain("conversation-agent-rail__stack")
  expect(source).not.toContain("buildAgentWorkflowLanes")
  expect(source).not.toContain("<For each={records()}>")
  expect(source).not.toContain("payload.report")
  expect(source).not.toContain("event.kind")
})

test("ConversationAgentRail avatar navigation uses the Button primitive and explicit labels", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  expect(source).toContain('import { Button } from "./ui/Button"')
  expect(source).toContain("<Button")
  expect(source).toContain('data-ui="conversation-agent-rail-locate"')
  expect(source).toContain("aria-label={compactLabel(record())}")
  expect(source).toContain("title={compactLabel(record())}")
  expect(source).not.toContain("<button")
  expect(source).not.toContain("conversation-agent-rail__avatar-button")
  expect(css).toContain('.conversation-agent-rail .oc-button[data-ui="conversation-agent-rail-locate"]')
  expect(css).not.toContain(".conversation-agent-rail__avatar-button")
  expect(css).not.toMatch(/conversation-agent-rail[^{]*\{[^}]*appearance:\s*none/)
})

test("ConversationAgentRail locates cards through renderedCardID and CSS.escape", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).toContain("record.renderedCardID")
  expect(source).toContain("record.targetMessageID")
  expect(source).toContain("conversationCardContainsMessage")
  expect(source).toContain("messageID: targetMessageID")
  expect(source).toContain("CSS.escape(record.renderedCardID")
  expect(source).toContain("setCardExpanded(record.renderedCardID, true")
  expect(source).toContain("setCardExpanded(parentID, true")
  expect(source).toContain("requestConversationCardScroll")
  expect(source).toContain('focus: "header"')
  expect(source).toContain("highlight: true")
  expect(source).not.toContain('scrollIntoView({ block: "center"')
})

test("Conversation card-scroll waits for virtualized target materialization", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")
  expect(source).toContain("CARD_SCROLL_TARGET_MAX_FRAMES")
  expect(source).toContain("waitForScrollTargetElement")
  expect(source).toContain("const target = await waitForScrollTargetElement(request)")
  expect(source).not.toContain(
    "await waitForAnimationFrame();\n    await waitForAnimationFrame();\n    const target = scrollTargetElement(request)",
  )
})

test("ConversationAgentRail stays a fixed narrow bottom strip", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  const html = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
  expect(source).not.toContain("--conversation-agent-rail-height")
  // Old vertical drag-to-resize affordance: `startY - move.clientY` is
  // its diagnostic fingerprint. Drag-to-scroll (a horizontal scroll
  // gesture on a fixed-height strip — `attachRailDragScroll` below) is
  // intentionally allowed and pinned by the positive assertions later
  // in this test.
  expect(source).not.toContain("startY - move.clientY")
  expect(source).not.toContain("data-wide")
  expect(source).not.toContain("--conversation-agent-rail-width")
  expect(css).toContain("border-top: var(--oc-border-width) solid color-mix(in srgb, var(--border) 82%, transparent)")
  expect(css).toContain("height: calc(42px * var(--ui-scale))")
  expect(css).not.toContain("max-height: calc(122px * var(--ui-scale))")
  expect(css).not.toContain("max-height: calc(220px * var(--ui-scale))")
  expect(css).not.toContain("conversation-agent-rail__resize")
  expect(css).not.toContain("data-wide")
  expect(css).toContain("flex-direction: row")
  expect(css).toContain("overflow-x: auto")
  expect(css).toContain("padding: calc(4px * var(--ui-scale)) calc(10px * var(--ui-scale))")
  expect(css).toContain("scrollbar-width: none")
  expect(css).toContain(".conversation-agent-rail__lanes::-webkit-scrollbar")
  expect(css).not.toContain("scrollbar-width: thin")
  expect(css).toMatch(/\.conversation-agent-rail__lanes\s*\{[^}]*flex-wrap:\s*nowrap/)
  expect(css).toMatch(/\.conversation-agent-rail__lane\s*\{[^}]*flex-wrap:\s*nowrap/)
  expect(css).toContain(".conversation-agent-rail .chat-avatar")
  expect(css).toContain("animation: none;")
  expect(html.indexOf('id="conversationBody"')).toBeLessThan(html.indexOf('id="solidConversationAgentRailMount"'))
  // Drag-to-scroll: horizontal press-and-drag gesture on the lanes
  // container. The drag handler is `attachRailDragScroll`, wired via
  // a `ref` callback that registers `onCleanup` for the listener pair.
  // The CSS shows the `grab` cursor when idle and `grabbing` while the
  // dataset flag `data-dragging="true"` is set by the handler.
  expect(source).toContain("attachRailDragScroll")
  expect(source).toContain("onCleanup(dispose)")
  expect(css).toContain("cursor: grab")
  expect(css).toContain('.conversation-agent-rail__lanes[data-dragging="true"]')
  expect(css).toContain("cursor: grabbing")
})

test("ConversationAgentRail keeps avatar DOM stable across workflow refreshes", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  expect(source).toContain("<Index each={records()}>")
  expect(source).toContain("record: Accessor<AgentWorkflowRecord>")
  expect(css).toContain(".conversation-agent-rail .chat-avatar")
  expect(css).toContain("animation: none;")
  expect(css).toContain(".conversation-agent-rail .chat-avatar::after")
})

test("ConversationAgentRail has no expanded detail surface", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  expect(source).not.toContain("props.wide")
  expect(source).not.toContain("conversation-agent-rail__run")
  expect(source).not.toContain("conversation-agent-rail__report")
  expect(source).not.toContain("AgentReportDialog")
  expect(css).not.toContain("conversation-agent-rail__run")
  expect(css).not.toContain("conversation-agent-rail__report")
  expect(css).not.toContain("agent-report-dialog")
})

test("ConversationAgentRail hides the bottom strip when there are no workflow lanes", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  expect(source).toContain("const hasRecords = createMemo(() => records().length > 0)")
  expect(source).toContain("<Show when={hasRecords()}>")
  expect(source).not.toContain("conversation-agent-rail__empty")
  expect(css).toContain(".conversation-agent-rail-host:empty")
  expect(css).toContain("display: none;")
})

test("ConversationAgentRail does not poll task trace for a removed expanded surface", () => {
  const source = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(source).not.toContain("fetchTaskTrace")
  expect(source).not.toContain("invalidateTraceCache")
  expect(source).not.toContain("createResource")
  expect(source).toContain("traceEvents: []")
})

test("ConversationAgentRail does not use streamed card text as workflow summary input", () => {
  const workflow = readFileSync(join(import.meta.dir, "../src/utils/agent-workflow.ts"), "utf8")
  const rail = readFileSync(join(import.meta.dir, "../src/components/ConversationAgentRail.tsx"), "utf8")
  expect(workflow).not.toContain("textFromCard")
  expect(workflow).not.toContain("textFromPart")
  expect(workflow).not.toContain('source: "card_output"')
  expect(rail).not.toContain("cardMessageSegments")
  expect(rail).not.toContain("orderedMessageParts")
  expect(rail).not.toContain("No summary")
})
