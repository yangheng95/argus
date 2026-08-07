# Task Progress Side Gutter Drag Repair

## Recall

- User request on 2026-07-09 after the first floating overlay repair: "只能横向拉长，不能纵向拖拽，而且不能拖出消息区" and then clarified with a screenshot: "要支持拖到两侧的空白".
- Acceptance criteria:
  - `TaskProgressBar` remains the single conversation GOALS surface backed by `boardStore.board.goalWorkflows`.
  - The GOALS window can be moved into the blank gutters on both sides of the transcript lane.
  - The GOALS window remains bounded by the conversation message area and cannot leave into the composer, title/header, right panel, or outside the overlay window.
  - Resizing is horizontal only; dragging the resize handle vertically must not change the window height budget.
  - Message cards still do not shift down or reserve layout space because the GOALS window exists.
  - No fallback, duplicate GOALS surface, persisted layout source, local signal bridge, iframe overlay, hidden state source, or gate is introduced.
- Hard constraints:
  - Preserve unrelated dirty worktree changes.
  - Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus / overlay process.
  - Browser verification must use an isolated Node Playwright runner on Windows, not Bun.
  - Frontend completion requires real screenshot review.
- Sources read before implementation:
  - User screenshot `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-19ab1aeb-f3b5-4a78-a95a-f1126a2fe044.png`
  - `specs/records/2026-07/2026-07-09-task-progress-floating-overlay-repair.md`
  - `packages/overlay/src/components/Conversation.tsx`
  - `packages/overlay/src/components/TaskProgressBar.tsx`
  - `packages/overlay/src/components/task-progress-floating-frame.ts`
  - `packages/overlay/src/styles/surfaces/conversation.css`
  - `packages/overlay/src/styles/surfaces/card.css`
  - `packages/overlay/test/task-progress-collapse.test.ts`
  - `packages/overlay/test/task-progress-floating-frame.test.ts`
  - `packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- Whole-repository grep evidence:
  - `rg -n "TaskProgressBar|taskProgressFloatingBounds|resizeTaskProgressFloatingFrame|conversation-scroll-shell|conversation-body|task-progress-resize|task-progress-floating" packages/overlay/src packages/overlay/test specs/records/2026-07 -S`
  - Findings: `TaskProgressBar` is mounted through `Conversation.tsx`; `TaskProgressBar` still computes movement bounds from `props.messagePanel.clientWidth/clientHeight`; `.conversation-body` is the real message-area grid that owns the transcript lane plus both blank gutters; resize currently consumes both `deltaX` and `deltaY`.
- Independent agent feedback:
  - None. The repair is a direct follow-up to the existing single GOALS overlay surface.

## Diagnosis

The prior repair correctly removed `TaskProgressBar` from the transcript flex flow and changed the surface to an absolute overlay. It still used `.chat-scroll` as both the visual transcript source and the movement bound. On wide layouts `.chat-scroll` is intentionally constrained and centered, while the visible blank gutters belong to `.conversation-body`. Clamping to `.chat-scroll` therefore prevents the window from moving into the side blank areas even though those areas are still part of the message area.

The resize handle also still applies `deltaY` to the height budget, which contradicts the updated interaction requirement. Resize should adjust width only; vertical placement is handled by moving the window with the header.

## Plan

1. Mount the GOALS overlay into `.conversation-body`, not `.conversation-scroll-shell`.
2. Make `.conversation-body` the positioned movement boundary and compute floating bounds from `overlayMount.clientWidth/clientHeight`.
3. Keep `.chat-scroll` as the transcript scroll container and message layout owner, but stop using it as the movement clamp source.
4. Change `resizeTaskProgressFloatingFrame` to preserve height and consume only horizontal delta.
5. Restyle the resize affordance as an east-west width handle instead of a diagonal corner resize grip.
6. Extend unit tests and the Node browser fixture to prove side-gutter dragging, horizontal-only resize, and no message-flow displacement.

## Validation Targets

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/task-progress-floating-frame.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Verification Results

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/task-progress-floating-frame.test.ts` passed with 13 tests and 129 expectations.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-progress-floating-window-browser.test.ts` passed and produced screenshots for idle, right-gutter drag, left-gutter drag, and post-resize states under `packages/overlay/.scratch/task-progress-floating-window/`.
- Screenshot review confirmed the GOALS surface can sit in both blank gutters, remains inside the conversation message boundary, and does not reserve space in the message-card flow.
- First `bun run --cwd packages/overlay typecheck` failed because `TaskProgressBar` still observed the removed `props.messagePanel`; the repair removed that stale source and added a source guard rejecting `messagePanel` in the floating component.
- Final `bun run --cwd packages/overlay typecheck` passed.
