# Message Pane Rail Header Scrollbar Repair

## Recall

- User request on 2026-07-08: the agent rail appears in the upper-left and has uneven spacing; the top-right right-panel button should stay on the side opposite the Open in VS Code control, token usage should move to the left of Open in VS Code, the message panel should be wider, the scrollbar should show only on hover, and the message scroll center must align with the composer input center.
- Acceptance criteria:
  - The agent rail remains the single `ConversationAgentRail` source backed by `conversationAgentRecordsForSource(boardStore.selectedSource)`.
  - The rail no longer shifts the message lane off the composer center axis.
  - Rail ticks use a stable, even vertical rhythm and do not visually start as a loose upper-left list.
  - Chat header action order is token usage, Open in editor launcher, right-toolbar toggle, with the right-toolbar toggle at the far edge.
  - The message lane is wider than the previous `920px` contract while staying centered.
  - The primary transcript scrollbar is visually hidden until hover/focus, without removing scrollability.
  - No fallback path, duplicate history source, hover-only toolbar open path, or DOM overlay hack is introduced.
- Hard constraints:
  - `AGENTS.md`: no fallback/compatibility paths, no blind patches, inspect persisted plans before edits, write Recall before implementation, preserve unrelated dirty worktree changes, pair code changes with tests, and visually verify frontend changes with screenshots.
  - Do not restart or kill the user's running OpenCorvus/overlay process. Browser verification must use an isolated fixture.
  - Playwright/browser verification on Windows must run through Node, not Bun.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/artifacts/长程编排测试.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-07/2026-07-08-message-pane-agent-rail-geometry-toolbar-alignment.md`
  - `specs/records/2026-07/2026-07-08-codex-message-panel-titlebar-toolbar.md`
  - `specs/records/2026-07/2026-07-08-conversation-agent-history-left-rail.md`
  - `packages/overlay/src/index.html`
  - `packages/overlay/src/styles/surfaces/conversation.css`
  - `packages/overlay/src/styles/surfaces/composer.css`
  - `packages/overlay/src/styles/surfaces/activity.css`
  - `packages/overlay/src/styles/surfaces/header.css`
  - `packages/overlay/src/styles/surfaces/workspace.css`
  - `packages/overlay/src/components/ConversationAgentRail.tsx`
  - `packages/overlay/test/conversation-agent-rail.test.ts`
  - `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
  - `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`
  - `packages/overlay/test/visible-scrollbar-whitelist.test.ts`
  - `packages/overlay/test/workspace-composer-density.test.ts`
  - `packages/overlay/test/acceptance-panel-mount.test.ts`
- Whole-repository grep evidence:
  - `rg -n "conversation-agent-rail|conversation-main|conversation-scroll|chat-header|open.*editor|Open in|usage|token|right-toolbar|activity-toolbar|side.*panel|message-lane|composer|scrollbar" packages/overlay/src packages/overlay/test -S`
  - `rg -n "chat-composer-stack|chat-textarea|chat-compose|chat-composer-max-width|chat-message-pane|chat-content-frame|chat-header|oc-surface-header|scrollbar|session-content" packages/overlay/src/styles/surfaces packages/overlay/test -S`
  - `rg -n "ConversationAgentRail|conversation-agent-rail|chat-header-meta|chat-usage|conversation-message-lane-width|chat-composer-max-width|chat-scroll|scrollbar-width: none|right-toolbar-toggle|workspace-editor" packages/overlay/test packages/overlay/src/styles/surfaces/conversation.css packages/overlay/src/index.html packages/overlay/src/main.tsx -S`
- Independent agent feedback:
  - None. The defect is local to the overlay conversation/header layout and already has direct source and browser-test ownership.

## Diagnosis

`#solidConversationAgentRailMount` is currently a real flex child before `.conversation-scroll-shell`. That makes `.chat-scroll` center itself inside the remaining width after the rail is removed, while the composer centers inside the full chat column. The result is a message lane shifted right by roughly half the rail width relative to the input.

The rail appears uneven because adjacent same-agent stacks use `grid-auto-rows: 12px` while each locate button has a `14px` height. Multi-record stacks therefore compress and overlap their own visual rhythm. The rail is also vertically centered as a whole, which reads as a loose top-left mini-list in tall transcripts after scrolling.

The chat header currently orders action mounts as editor launcher, right-toolbar toggle, and then `.chat-usage`. That puts token usage at the far right. Reordering the existing DOM keeps one header source and one right-toolbar state source.

`#chatScroll` is part of the global visible-scrollbar whitelist in `base.css`, so the transcript scrollbar stays visible. The request is for the transcript scrollbar to appear on hover/focus only; that belongs to the same canonical `#chatScroll` selector group rather than a second per-theme override.

## Plan

1. Add a rail mirror spacer to `.conversation-body` only when the rail mount has content, so the message shell remains centered on the same full chat axis as the composer.
2. Increase the message lane width and, if needed, the composer max width through their existing single geometry tokens.
3. Normalize rail tick row height and stack row height to the same tokenized value so adjacent stacks keep a consistent rhythm.
4. Reorder the chat header DOM to place `.chat-usage` before the editor launcher and leave the right-toolbar toggle as the far-edge action.
5. Move `#chatScroll` scrollbar chrome from always-visible to hover/focus-visible in the canonical scrollbar source, keeping scrollability intact.
6. Update focused source/browser tests to assert center-axis alignment, stable rail rhythm, header action order, wider lane, and hover-revealed scrollbar behavior.
7. Run focused tests and Node browser screenshots in an isolated fixture, then perform a second diff review.

## Validation Targets

- `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/visible-scrollbar-whitelist.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
