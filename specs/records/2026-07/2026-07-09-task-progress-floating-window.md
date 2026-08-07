# Task Progress Floating Window

## Recall

- User request on 2026-07-09: make the screenshot GOALS progress surface a draggable, resizable window that can move freely inside the message panel and is slightly transparent.
- Acceptance criteria:
  - The existing conversation `TaskProgressBar` remains the single goal progress surface and still reads `boardStore.board.goalWorkflows`.
  - The progress surface can be dragged by its header inside the message panel bounds.
  - The progress surface can be resized from a visible handle inside message panel bounds.
  - The window is slightly transparent while keeping goal pills, progress count, and fold controls readable.
  - Goal pill click-to-locate behavior and whole-window fold behavior remain intact.
  - No fallback path, duplicate goals strip, iframe/local-signal overlay, or hidden second source is introduced.
- Hard constraints:
  - `AGENTS.md`: no fallback/compatibility logic, no blind patching, inspect persisted plans before edits, keep a Recall section before implementation, preserve unrelated dirty worktree changes, pair code changes with tests, and visually verify frontend changes with screenshots.
  - Do not restart, close, or refresh the user's running OpenCorvus/overlay process. Browser verification must use an isolated test page or isolated dev target.
  - Playwright/browser verification on Windows must run through Node, not Bun.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
  - `specs/artifacts/长程编排测试.md`
  - `specs/current/architecture/07-panel.md`
  - `specs/records/2026-07/2026-07-08-message-pane-rail-header-scrollbar-repair.md`
  - `specs/records/2026-07/2026-07-08-message-pane-agent-rail-geometry-toolbar-alignment.md`
  - `specs/records/2026-07/2026-07-05-goal-progress-overlay-workflow-selection-repair.md`
  - `packages/overlay/src/components/TaskProgressBar.tsx`
  - `packages/overlay/src/components/Conversation.tsx`
  - `packages/overlay/src/styles/surfaces/card.css`
  - `packages/overlay/test/task-progress-collapse.test.ts`
  - `packages/overlay/test/browser/task-progress-pill-focus-browser.test.ts`
- Whole-repository grep evidence:
  - `rg -n "GOALS|Goals|goals" packages/overlay/src packages/overlay/test specs/records/2026-07`
  - `rg -n "task-progress|TaskProgressBar|progress\\.heading|expand_card|collapse_card" packages/overlay/src packages/overlay/test`
  - `rg -n "draggable|drag|resize|pointerdown|setPointerCapture|ResizeObserver|splitter|resizable|reshape|window" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test -g "*.tsx" -g "*.ts" -g "*.css"`
- Independent agent feedback:
  - None. The requested change is local to the overlay conversation progress surface and has direct source, CSS, unit, and browser-test ownership.

## Diagnosis

The screenshot matches `TaskProgressBar`, not the right-side `GoalsBoardPanel`. `TaskProgressBar` is currently rendered once at the top of `Conversation`, positioned sticky, and owns the progress count, fold control, row measurement, and goal pill locate behavior. Turning a different DOM node into a movable overlay would violate the single-source progress surface rule and would risk splitting click-to-locate behavior.

The correct owner is therefore `TaskProgressBar` itself. Its header can become the drag handle because the fold button and goal pills already own their own click actions. Resizing belongs to one explicit handle in the same component, bounded by the nearest `.chat-scroll` message panel container.

## Plan

1. Replace the sticky-only progress strip with a floating task-progress window state inside `TaskProgressBar`.
2. Use pointer capture for drag and resize sessions, clamping position and size to the message panel client rectangle.
3. Keep state local to the component instance so the current selected task/session does not introduce a second persisted layout source.
4. Add CSS for the floating window, header drag affordance, active drag/resize state, explicit bottom-right resize handle, and slight transparency.
5. Extend source tests to assert single-source ownership plus drag/resize mechanics, and add a Node browser test that drags and resizes the window in an isolated fixture with screenshot evidence.
6. Run focused unit/browser tests, spec-link validation, `git diff --check`, and a second diff review.

## Validation Targets

- `bun test packages/overlay/test/task-progress-collapse.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
