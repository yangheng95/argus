# Message Composer Scrollbar Alignment

## Recall

- User request on 2026-07-09: the bottom input box and the text display area are not aligned; alignment must not count the scrollbar width.
- Acceptance criteria:
  - The visible conversation card/text lane and the bottom composer shell share the same left/right content bounds.
  - The primary transcript scrollbar remains real and scrollable, but its gutter does not shift the perceived message content center away from the composer.
  - The fix uses the existing conversation/composer CSS owners and tests; no overlay, iframe, local signal, fallback, duplicate composer, or DOM hack is introduced.
  - Existing agent rail centering remains intact.
  - Frontend verification must include real browser screenshot review.
- Hard constraints:
  - `AGENTS.md`: no fallback/compatibility paths, no blind patches, inspect persisted plans before edits, write Recall before implementation, preserve unrelated dirty worktree changes, pair code changes with tests, and visually verify frontend changes with screenshots.
  - Do not restart, kill, or refresh the user's running OpenCorvus/overlay process. Browser verification must use an isolated fixture.
  - Playwright/browser verification on Windows must run through Node, not Bun.
- Sources read before implementation:
  - User screenshot `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-adfb6383-b8ad-4ecf-8135-240b9ef80917.png`
  - `specs/records/2026-07/2026-07-08-message-pane-rail-header-scrollbar-repair.md`
  - `specs/records/2026-07/README.md`
  - `packages/overlay/src/index.html`
  - `packages/overlay/src/styles/surfaces/conversation.css`
  - `packages/overlay/src/styles/surfaces/composer.css`
  - `packages/overlay/src/styles/cascade/base.css`
  - `packages/overlay/src/styles/surfaces/messages.css`
  - `packages/overlay/test/conversation-agent-rail.test.ts`
  - `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
  - `packages/overlay/test/workspace-composer-density.test.ts`
  - `packages/overlay/test/overlay-architecture-guards.test.ts`
- Whole-repository grep evidence:
  - `rg -n "Send scoped guidance|scoped guidance|agent session|Steer|Messages 1|Continued execution|Dispatched the next blocking build goal|textarea|scrollbar" -S .`
  - `rg -n "AgentSessionReplyBox|agent-session|operator-steer|steer|chatScroll|conversation-scroll|conversation-message-lane|message-lane|chat-composer|max-width|scrollbar-gutter|scrollbar-width" packages/overlay/src packages/overlay/test -S`
  - `rg -n "scrollbar-gutter|conversation-message-lane-width|chat-composer-inline-gutter|chat-composer-max-width|chat-scroll\\s*\\{|conversation-scroll-shell\\s*\\{" packages/overlay/src/styles packages/overlay/test -S`
- Independent agent feedback:
  - None. The defect is localized to the overlay conversation/composer geometry and already has direct CSS plus browser-test ownership.

## Diagnosis

The 2026-07-08 repair made `#chatScroll` and the composer share the same outer center axis. That assertion uses the scroll container border box. The user-visible message area is not the scroll container border box: `.chat-scroll` has horizontal content padding, and the real transcript scrollbar consumes gutter on the right side. As a result, the message cards/text area are narrower and visually shifted relative to the bottom composer even while the outer scroll box center matches the composer.

The root cause is one width token serving two different geometry meanings:

- message scroll container width, which includes content padding and scrollbar gutter;
- message content/composer width, which must exclude padding and scrollbar gutter.

The browser test reinforces the wrong contract by comparing `#chatScroll.getBoundingClientRect()` directly to the composer.

## Plan

1. Introduce shared chat geometry tokens for content lane width, transcript padding, transcript scrollbar gutter, and derived scroll container width.
2. Bind `.chat-scroll` to the derived scroll container width, use the shared padding token, and reserve symmetric scrollbar gutter with `scrollbar-gutter: stable both-edges`.
3. Bind `.chat-composer-stack` to the content lane width and use a responsive inline gutter equal to transcript padding plus symmetric scrollbar gutters.
4. Update source tests that asserted the old hard-coded composer/message width coupling.
5. Update the Node browser geometry test to compare composer bounds against the computed message content bounds, not the scroll container border box.
6. Run focused unit/browser tests, inspect the generated screenshot, and perform a second diff review.

## Validation Targets

- `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/visible-scrollbar-whitelist.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Verification Results

- Passed: `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/visible-scrollbar-whitelist.test.ts`
- Passed: `bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "chat scroll layout is canonical"`
- Passed: `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts -t "window and center workbench resize paths use the shared frame scheduler"`
- Passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- Visual review passed: `.scratch/conversation-agent-rail-scroll-browser/chat-section-after-locate.png` shows the message content lane and bottom composer sharing the same left/right bounds while the transcript scrollbar stays outside that content lane.
- Passed: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Passed: `git diff --check`
- Not counted as this repair: the full `packages/overlay/test/overlay-architecture-guards.test.ts` file still reports unrelated failures from other current worktree changes, including sidebar static-action expectations, duplicate selector budgets, settings group count, and raw style literal guards.
