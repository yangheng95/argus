# Task Progress Floating Overlay Repair

## Recall

- User request on 2026-07-09: the GOALS window is still stuck to the edge, cannot be freely positioned as expected, and appears to disrupt the message layout. The GOALS surface should float above the message panel, not compete with message cards for space.
- Acceptance criteria:
  - `TaskProgressBar` remains the single conversation goal progress surface backed by `boardStore.board.goalWorkflows`.
  - The GOALS window is mounted as an overlay layer over `.chat-scroll`, not as a flex-flow child before the virtualized message list.
  - Default placement is not the panel's top-left inset; it should open as a floating panel over the message lane with room to drag in any direction inside the message panel bounds.
  - Drag and resize remain bounded by `.chat-scroll`.
  - Message cards and the virtualized conversation window do not shift down or reserve space because the GOALS window exists.
  - No fallback, duplicate goal surface, persisted layout source, local signal bridge, iframe overlay, or hidden second state source is introduced.
- Hard constraints:
  - Preserve unrelated dirty worktree changes.
  - Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus / overlay process.
  - Browser verification must use an isolated Node Playwright runner on Windows, not Bun.
  - Frontend completion requires real screenshot review.
- Sources read before implementation:
  - `specs/artifacts/长程编排测试.md`
  - `specs/records/2026-07/2026-07-09-task-progress-floating-window.md`
  - `specs/records/2026-07/2026-07-09-task-progress-window-visual-redesign.md`
  - `packages/overlay/src/components/TaskProgressBar.tsx`
  - `packages/overlay/src/components/task-progress-floating-frame.ts`
  - `packages/overlay/src/components/Conversation.tsx`
  - `packages/overlay/src/styles/surfaces/card.css`
  - `packages/overlay/src/styles/surfaces/conversation.css`
  - `packages/overlay/test/task-progress-collapse.test.ts`
  - `packages/overlay/test/task-progress-floating-frame.test.ts`
  - `packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- Whole-repository grep evidence:
  - `rg -n "task-progress-floating|TaskProgressBar|Portal mount|conversation-progress|chat-scroll|position:\\s*fixed|position:\\s*absolute|initialTaskProgressFloatingFrame|floatingFrame|task-progress" packages/overlay/src packages/overlay/test specs/records/2026-07 -S`
  - Findings: `TaskProgressBar` is rendered once by `Conversation.tsx`; `.task-progress` is currently `position: fixed`; frame initialization is owned by `initialTaskProgressFloatingFrame`; browser coverage exists in `task-progress-floating-window-browser.test.ts`.
  - `rg -n "centerWorkbenchGoals|centerWorkbench|GoalsBoardPanel|goalWorkflowsSection|solidGoalsPanelMount|goals-panel|goal-board" packages/overlay/src packages/overlay/test specs/records/2026-07 -S`
  - Finding: the screenshot surface is not `GoalsBoardPanel`; the correct owner remains `TaskProgressBar`.
- Independent agent feedback:
  - None. The repair is localized to the existing single goal progress surface and its browser fixture.

## Diagnosis

The current implementation computes fixed viewport coordinates from the `.chat-scroll` rectangle and initializes the frame at `{ x: inset, y: inset }`. That makes every initial render attach to the panel edge, which violates the free-floating interaction requirement even though subsequent pointer movement is bounded correctly.

The component is also rendered as the first child of `Conversation` before the virtualized message list. CSS fixed positioning removes it from normal layout, but in a flex scroll container this DOM ownership still places the progress surface in the message content sequence seen by measurement and scroll code. The correct ownership is a `conversation-scroll-shell` overlay mount positioned against the `.chat-scroll` message panel bounds: same component, same store source, but not a conversation card or virtualized item sibling that can influence message-flow measurement or scroll with transcript content.

## Plan

1. Move `TaskProgressBar` rendering through a `Portal` mounted to the `.conversation-scroll-shell` that owns the `.chat-scroll` element passed into `Conversation`.
2. Change `.task-progress` from fixed viewport positioning to absolute positioning relative to that shell while using `.chat-scroll` for movement bounds.
3. Change frame style generation to use panel-local `x/y` coordinates rather than adding viewport rect offsets.
4. Change `initialTaskProgressFloatingFrame` to open at a centered upper overlay position within bounds, not at the inset.
5. Extend source tests to lock the portal/absolute ownership and initial non-edge placement.
6. Extend the Node browser test to assert the first message card does not move when the GOALS window is present, and to save screenshots.

## Validation Targets

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/task-progress-floating-frame.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Verification Results

- Passed: `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/task-progress-floating-frame.test.ts`
- Passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- Passed: `bun run --cwd packages/overlay typecheck`
- Passed: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Passed: `git diff --check`
- Visual review passed:
  - `packages/overlay/.scratch/task-progress-floating-window/dark-window-idle-mixed-states.png`
  - `packages/overlay/.scratch/task-progress-floating-window/dark-window-after-drag-resize.png`

The first browser run failed after the initial non-edge placement change because the previous default window width consumed 78% of the message panel, leaving too little horizontal travel before clamping. That was a real interaction defect, not a test artifact. The frame default width ratio is now 64%, which keeps the panel compact enough to move freely while preserving multi-column goal pills.
