# Conversation Agent History Left Rail

## Recall

User request:

- Show agent execution history on the left side of the message box in a compact rail similar to the provided screenshot.
- Hovering an item must show the agent name and execution summary.
- Adjacent agent entries with the same identity must stack at the same horizontal position.

Acceptance criteria:

- The conversation workflow history moves from the previous bottom horizontal strip into the left side of the message pane.
- The rail continues to read `conversationAgentRecordsForSource(boardStore.selectedSource)` and keeps the existing locate-on-click behavior.
- Hover/focus uses a real tooltip surface with agent name, status, attempt, and summary from `AgentWorkflowRecord.displaySummary`; backend `session.status.summary` is the hydrate/live source for that field.
- Consecutive records with the same normalized agent identity render in a shared stack group and expose one stable horizontal lane.
- The rail does not create a second agent-history source, does not scan rendered card text for summaries, and does not fetch task trace.
- Existing empty-state behavior remains: no rail when there are no workflow records.
- Tests cover source ownership, tooltip summary rendering, stack grouping, left-side placement, browser geometry, hover tooltip visibility, click locate, and visual screenshot review.

Hard constraints:

- No fallback, compatibility branch, gate, or dual-source rendered tree.
- Preserve unrelated dirty overlay changes already present in the worktree.
- Use existing `conversationAgentStore`, `Button`, `Avatar`, Kobalte Tooltip, and token-driven CSS.
- Do not restart, refresh, kill, or otherwise interfere with the user's running OpenCorvus / overlay process.
- Playwright/browser verification must run through Node on Windows, not Bun.
- Update this monthly record index and run the docs link test after adding this spec.

Sources read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-05-agent-rail-build-hydrate-live-retention.md`
- `specs/records/2026-07/2026-07-05-overlay-build-card-sse-teardown-verification.md`
- `specs/records/2026-07/2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`
- `specs/records/2026-07/2026-07-08-work-ledger-row-alignment.md`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/Conversation.tsx`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/src/components/CardHeaderChrome.tsx`
- `packages/overlay/src/components/Avatar.tsx`
- `packages/overlay/src/store/conversation-agents.ts`
- `packages/overlay/src/utils/agent-workflow.ts`
- `packages/overlay/src/utils/agent-workflow-lanes.ts`
- `packages/overlay/src/utils/card-color.ts`
- `packages/overlay/src/index.html`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/test/conversation-agent-rail.test.ts`
- `packages/overlay/test/conversation-agent-rail-records.test.ts`
- `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- `packages/overlay/package.json`

Whole-repository search evidence:

- `rg -n "agent|Agent|execution|history|message box|message|timeline|hover|tooltip|popover|rail|stack|summary" specs packages .opencorvus -g "*.md" -g "*.ts" -g "*.tsx" -g "*.css" -g "*.txt"` showed existing workflow history ownership in `ConversationAgentRail`, `conversation-agents`, and current July records.
- `rg -n "ConversationAgentRail|conversation-agent-rail|agent_rail|agent workflow|agent-workflow" packages/overlay/src packages/overlay/test specs/records/2026-07 specs/current/architecture -g "*.tsx" -g "*.ts" -g "*.css" -g "*.md" -g "*.json"` showed the bottom-strip rail, its tests, i18n keys, and prior retention records.
- `rg -n "Tooltip|tooltip|Popover|popover|Kobalte|@kobalte|floating|HoverCard|title=|aria-describedby" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test -g "*.tsx" -g "*.ts" -g "*.css"` identified `CardHeaderChrome.tsx` as the existing Kobalte Tooltip owner pattern and `card-meta-tooltip` as the reusable visual treatment.
- `rg -n "conversationBody|solidConversationAgentRailMount|conversation-scroll-shell|chat-scroll|chat" packages/overlay/src/index.html packages/overlay/src/main.tsx packages/overlay/src/styles/surfaces/conversation.css packages/overlay/test -g "*.html" -g "*.ts" -g "*.tsx" -g "*.css"` showed the current DOM order places the rail mount after `conversationBody`, which is why the rail can only be a bottom strip today.

Independent agent feedback:

- None requested in this round. The change is local to the overlay conversation rail and is based on the existing persisted records and focused source inspection.

## Diagnosis

The existing `ConversationAgentRail` is already the correct data and action path:

- It reads `conversationAgentRecordsForSource(boardStore.selectedSource)`.
- It does not rebuild workflow history from rendered card text.
- It preserves click-to-locate through `renderedCardID`, lazy history loading, `setCardExpanded`, and `requestConversationCardScroll`.
- It already has tests proving the rail survives hydrate/live target updates.

The current defect relative to the new request is the presentation contract:

- `index.html` mounts `#solidConversationAgentRailMount` after `#conversationBody`.
- `conversation.css` makes `.conversation-agent-rail-host` a full-width bottom strip with `border-top`, fixed `42px` height, horizontal overflow, and drag-to-scroll.
- `conversation-agent-rail.test.ts` explicitly rejects stack rendering and pins the old bottom-strip geometry.
- The rail button uses only native `title={compactLabel(record())}`, so hover does not expose a structured summary surface.

Therefore the correct repair is to replace the old bottom-strip presentation while preserving the existing store and locate behavior.

## Plan

1. Move the static rail mount into `#conversationBody` before `.conversation-scroll-shell`, making the rail physically live on the left side of the message pane.
2. Replace horizontal drag-strip behavior with a compact vertical rail. The rail remains hidden when empty through the existing host empty rule.
3. Add a render helper that groups adjacent records with the same normalized agent identity into `conversation-agent-rail__stack` groups. Each item in a stack uses the same column/lane, satisfying the horizontal-position requirement without introducing a second layout source.
4. Replace native title-only hover detail with a Kobalte Tooltip per locate button. Tooltip content includes agent name, status, attempt, and execution summary from `displaySummary.text`. `displaySummary` is populated by the durable `session.status.summary` projection, not by rendered card text or task trace polling.
5. Update CSS under `surfaces/conversation.css` only. Use existing token variables and no raw colors.
6. Rewrite focused unit tests from the old bottom-strip contract to the new left-rail contract.
7. Update the browser test fixture to assert left-side geometry, tooltip visibility, stacked same-agent x alignment, locate behavior, and screenshot evidence.
8. Run focused unit tests, Node browser test, overlay typecheck/i18n/build where needed, docs link test, raw color scan on changed files, and `git diff --check`.

## Validation Targets

- `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
