# 2026-06-26 CWD Detected Project Scroll

## Problem

The top project directory popover can render many automatically detected
projects, but the detected-project area is visually clipped and cannot be
scrolled like other primary lists. The screenshot shows the popover opened from
the CWD breadcrumb, not the first-run workspace onboarding dialog.

## Recall

| Source                                                     | Constraint                                                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                | No fallback, no duplicate source, inspect disk plans before edits, test changes, visually verify frontend work, do not restart the user's live overlay process. |
| `2026-06-26-coding-assistant-directory-status-contract.md` | Overlay verification must use isolated browser evidence and avoid touching the live overlay process.                                                            |
| `2026-06-24-overlay-task-deep-link.md`                     | Task/project directory ownership remains strict and single-source. This UI fix must not introduce another directory source.                                     |

## Call Point Inventory

| Surface                                                      | Evidence                                                                                                                                                                                                       | Repair                                                                                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/components/TaskDirBar.tsx`             | `TaskDirContent` renders discovered projects inside a generic `.recent-dir-list` without a data-kind marker; the recent directory list already has `data-kind="recent"`.                                       | Mark the detected-project section/list as `data-kind="discovered"` so layout and tests can target the exact scroll surface.                                                                                        |
| `packages/overlay/src/styles/surfaces/conversation.css`      | `.recent-dir-panel` has `max-height` and `overflow: hidden`; `.recent-dir-panel-shell` does not carry `max-height: inherit` / `min-height: 0`; global scrollbar CSS hides scrollbar UI for `.recent-dir-list`. | Constrain the shell, allow the detected section to shrink, keep the detected list scrollable, and opt the detected list into visible scrollbar chrome.                                                             |
| `packages/overlay/test/task-cwd-row-layout.test.ts`          | Static cwd popup tests cover structure and row primitives, not the detected-project scroll contract.                                                                                                           | Add CSS/source assertions for the discovered data-kind and scroll constraints.                                                                                                                                     |
| `packages/overlay/test/browser/task-dirbar-keyboard.test.ts` | Browser cwd popup tests cover open semantics and discovery error state, not overflowing detected projects; the shared fixture also missed the startup `/skill/mounts` route now called by the overlay.         | Add an isolated browser test with many discovered projects, assert the detected list has overflow, can scroll, stays within the panel, save a screenshot, and return an empty skill-mount matrix from the fixture. |

## Acceptance

- The automatically detected project list in the CWD popover has its own
  scrollable region when detected projects overflow.
- Scrolling detected projects does not rely on the outer popover clipping.
- Recent directory behavior remains unchanged.
- Verification uses focused unit/browser tests and a screenshot from an
  isolated browser fixture, not the user's running overlay window.
