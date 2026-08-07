# 2026-07-09 Task Progress Edge Resize Density

## Recall

### User Request

- Make the GOALS floating progress window resizable from every edge, not only the right side.
- When the available window area is insufficient, automatically collapse some goals so the panel does not become crowded.
- The screenshots show a cramped small GOALS surface with too many goal pills and a scrollbar; the expected behavior is fewer visible pills plus a `+N more` summary.

### Acceptance Criteria

- The existing Overlay `TaskProgressBar` remains the single source and single UI owner for the GOALS window.
- The floating frame can resize from top, right, bottom, left, and corner handles while staying inside the message panel overlay mount.
- Top and left resize operations preserve the opposite edge as the anchor when size constraints are reached.
- Width and height are both real frame dimensions; resize no longer ignores vertical pointer movement.
- Small frame area reduces the rendered goal pills automatically and shows an accurate hidden-goal count instead of compressing pills into unreadable rows.
- Header counts and the segmented goal minimap remain visible so the collapsed state still communicates progress.
- No fallback source, compatibility branch, iframe, query override, local signal duplication, or process restart is introduced.
- Browser verification must use a real rendered page and screenshot review; Playwright must run under Node on Windows.

### Hard Constraints

- Follow `AGENTS.md`: no fallback/compatibility logic, no blind patching, no git reset, no untracked worktree workaround.
- Keep frontend validation visual: start an isolated test page, capture screenshots, inspect them, and iterate if visual output is wrong.
- Do not restart, kill, refresh, or otherwise interfere with the user's running OpenCorvus / overlay process.
- Code edits require matching tests, including behavior that prevents goal crowding.
- Commit subject must start with `dsw-33987`; push to the `legacy-remote` remote after validation.

### Hard-Disk Context Read Before Editing

- `specs/records/2026-07/2026-07-09-task-progress-floating-window.md`
- `specs/records/2026-07/2026-07-09-task-progress-window-visual-redesign.md`
- `specs/records/2026-07/README.md`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/components/task-progress-floating-frame.ts`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/test/task-progress-collapse.test.ts`
- `packages/overlay/test/task-progress-floating-frame.test.ts`
- `packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`

### Full-Repository Grep Evidence

- Command: `rg -n "task-progress|TaskProgressBar|taskProgressFloating|resizeTaskProgress|progress\\." packages/overlay/src/components packages/overlay/src/styles/surfaces/card.css packages/overlay/test specs/records/2026-07 -S`
- Relevant owners found:
  - `packages/overlay/src/components/TaskProgressBar.tsx`
  - `packages/overlay/src/components/task-progress-floating-frame.ts`
  - `packages/overlay/src/styles/surfaces/card.css`
  - `packages/overlay/test/task-progress-collapse.test.ts`
  - `packages/overlay/test/task-progress-floating-frame.test.ts`
  - `packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- Existing implementation already mounts the progress surface over the message panel through `overlayMount`; this change must extend that implementation instead of adding another floating layer.
- Existing frame resize helper only changes width from the right side and ignores vertical deltas; this is the direct implementation gap for the edge-resize requirement.
- Existing auto-collapse measures visible rows but not the actual floating frame area; this is the direct implementation gap for the density requirement shown in the screenshots.

### Independent Agent Feedback

- None requested for this focused Overlay component change.

## Implementation Plan

1. Extend the frame geometry helper with an explicit resize-handle union for all edges and corners.
2. Add a deterministic goal-capacity helper derived from floating frame width, height, and UI scale so small frames render fewer pills by default.
3. Update `TaskProgressBar` pointer handling to pass the active resize edge, render edge/corner hitboxes, and render only the visible goal slice when collapsed.
4. Update CSS to provide invisible edge hitboxes with correct resize cursors and preserve the current translucent frosted window style.
5. Update unit and browser tests for all-edge resize behavior and small-area goal collapsing.
6. Run targeted unit tests, browser screenshot tests, typecheck/i18n checks, document-link health, and `git diff --check`.
