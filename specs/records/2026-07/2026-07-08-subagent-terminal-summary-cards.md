# 2026-07-08 Subagent Terminal Summary Cards

## Recall

User request:

- Add a summary section for every subagent.
- When the subagent card is collapsed, show a first-person summary explaining
  what that agent did and what result it got.
- The rendering must feel designed and must not be an ad hoc patch.
- The request may require a schema change.

Acceptance criteria:

- Subagent completion summary comes from the agent execution result path, not
  from overlay text scraping, latest-activity preview, or AgentTrace-only data.
- The lifecycle schema carries the summary through `session.status` terminal
  events so live Server-Sent Events and hydrated replay share the same source.
- `CardNode` owns one explicit `agentSummary` field consumed by both
  `ChatBubble` and generic `CardHeader` surfaces.
- Collapsed cards render a visually distinct summary block. Running cards do
  not show stale terminal summaries.
- Existing collapsed preview and activity counters remain available; the new
  summary is an additional structured section, not a replacement or fallback.
- Tests cover backend schema/event propagation, overlay projection, static
  component/Cascading Style Sheets contracts, and browser screenshot review.

Hard constraints:

- No fallback, compatibility branch, hidden synthetic message, or second
  rendered tree.
- Do not restart or refresh the user's running OpenCorvus or overlay process.
- Browser verification must run with Node on Windows, not Bun.
- Preserve this Recall so context compaction cannot shrink the task.

Sources read before implementation:

- `AGENTS.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-07/2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`
- `specs/records/2026-07/README.md`
- `packages/opencorvus/src/session/status.ts`
- `packages/opencorvus/src/protocol/session-mirror.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/agent/report.ts`
- `packages/opencorvus/src/tool/task.ts`
- `packages/overlay/src/store/card-tree.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/CardHeader.tsx`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/overlay/test/card-collapsed-preview.test.ts`
- `packages/overlay/test/tree-writer-hierarchy.test.ts`
- `packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`

Whole-repository search evidence:

- `rg -n --glob '!packages/opencorvus/src/provider/models-snapshot.ts' --glob '!**/dist/**' --glob '!**/node_modules/**' 'CardNode|summary|AgentSummary|subagent|sub-agent|session\.status|message\.updated|tree-writer' packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S`
- `rg -n 'mapSessionBusEvent|session\.status|SessionStatus|terminal' packages/opencorvus/test packages/opencorvus/src/protocol -S`
- `rg -n 'function buildTraceReport|buildTraceReport\(|recordAgentTraceReportForSession|traceReport|displaySummary|AgentTrace' packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S --glob '!packages/opencorvus/src/provider/models-snapshot.ts'`
- `rg -n 'SessionStatus\.Info|SessionStatus\.set\(|mapSessionBusEvent|projectSessionStatus|applyProjectedSessionStatus|agentSummary|collapsedPreview|chat-bubble__' packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S --glob '!packages/opencorvus/src/provider/models-snapshot.ts'`
- `rg -n 'conversation-scroll-bottom|chat.scroll_bottom|card.activity_summary|chat-bubble__|card__collapsed-preview|card__preview-row|summary' packages/overlay/src/i18n packages/overlay/src/styles packages/overlay/src/components packages/overlay/test -S`

Independent agent feedback:

- Not spawned. The current task did not request independent agent delegation;
  direct source and test evidence is sufficient for this scoped schema and
  overlay projection change.

Diagnosis:

- `SessionStatus.Info` terminal events currently carry only `reason` and
  optional `error`; completed subagents publish a terminal lifecycle signal
  without their execution report.
- `runAgentSession` already obtains each agent toolkit's `AgentReport`, but
  it records that report only into AgentTrace. AgentTrace can be disabled and
  is not the conversation card source, so it cannot be the summary source.
- The generic `Task` tool creates/resumes subagent sessions directly through
  `SessionPrompt.prompt`; it also sets terminal status without a summary.
- Overlay `tree-writer.ts` is the only `CardNode` writer and already maps
  `session.status` into card status, terminal reason, error reason, and
  completion time. This is the correct single source for adding the summary
  projection.
- `ChatBubble` handles top-level agent/message cards, while `CardHeader`
  handles step/phase surfaces; build subagents may be absorbed into phase
  cards, so both renderers must consume the same `CardNode.agentSummary`.

Implementation plan:

1. Extend `SessionStatus.Info` terminal schema with optional non-empty
   `summary`.
2. In `runAgentSession`, build the existing `AgentReport` before publishing
   terminal status and attach `report.summary` to success/error terminal
   lifecycle events.
3. In the generic `Task` tool, attach a summary derived from the subagent's
   final text or caught error to terminal lifecycle events, and turn empty
   final text into a visible terminal error instead of inventing substitute
   text.
4. Add `CardNode.agentSummary` and project it from
   `session.status.status.summary` inside `tree-writer.ts`.
5. Render a reusable collapsed `AgentSummaryBlock` from both `ChatBubble` and
   `CardHeader`, with dedicated styles and localized label text.
6. Add focused tests plus a Node-driven browser visual fixture, then run
   typecheck/build/i18n and screenshot review.
