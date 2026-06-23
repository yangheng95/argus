# Memory Panel Owner And Browser Coverage

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

Independent GUI review found two related MemoryPanel gaps:

- `surfaces/settings.css` is documented as the owner for `.knowledge-item*` and
  `.memory-detail*`, but `surfaces/activity.css` also styles the same live
  MemoryPanel row and inline-detail selectors under `.sidebar-tool-panel`.
- The mounted left Memory browser test expands the inline detail and tabs to
  the Delete button, but it does not complete the DELETE path, verify row
  removal, or capture the post-delete state.

This leaves a double-source styling path and a browser evidence gap for the
same DOM contract.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-memory-row-nested-interactions.md` | `.knowledge-item-main` is the row disclosure button and Delete is a sibling action; the left Memory panel must be verified in a real browser. |
| `2026-06-19-memory-search-field-primitive.md` | MemoryPanel already moved search chrome to a shared primitive; private Memory chrome should not reappear through side-panel overrides. |
| `overlay-architecture-guards.test.ts` | The guard states the knowledge / memory panel is owned by `surfaces/settings.css`. |
| `main.tsx` | MemoryPanel has two production mounts: Settings without `compact`, and the left activity panel with `compact`. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "MemoryPanel" packages/overlay/src` | Production mounts are `ConfigDialogHost.tsx` and `main.tsx`; the left mount passes `compact`. | Treat compact density as a MemoryPanel variant, not as an activity-owned override of Memory internals. |
| `rg -n "knowledge-item-main|memory-inline-detail|memory-detail-content" packages/overlay/src/styles/surfaces` | `settings.css` owns base selectors; `activity.css` repeats left-panel overrides for the same selectors. | Move compact Memory row/detail rules into `settings.css` under `.memory-panel[data-compact="true"]`. |
| `left-tool-panels-directory-browser.test.ts` | Real overlay browser test opens left Memory, expands detail, tabs to Delete, and saves a screenshot. It does not click Delete or verify row removal. | Extend the same mounted test to send DELETE, remove the fixture row, and verify the empty state. |
| `left-activity-toolbar.test.ts` | Static test expects activity.css to contain the compact Memory toolbar selector. | Update it to assert activity owns only side panel shell/layout while settings owns Memory compact internals. |

## Fix Plan

1. Keep `MemoryPanel.tsx` DOM unchanged: native disclosure button plus sibling
   `Button[data-action="delete-memory"]`.
2. Move left compact Memory toolbar, row, title/meta, delete button, and inline
   detail density rules from `activity.css` to `settings.css` using
   `.memory-panel[data-compact="true"]`.
3. Tighten the architecture guard so activity.css cannot restyle live
   `.knowledge-*` or `.memory-detail*` internals.
4. Extend the mounted left tool panel browser test to mutate the fixture memory
   collection on DELETE, verify the DELETE request, verify no stale row remains,
   and save a post-delete panel screenshot.

## Acceptance

- `activity.css` contains no `.sidebar-tool-panel .knowledge-*`,
  `.sidebar-tool-panel .memory-inline-detail`, `.sidebar-tool-panel
  .memory-detail-*`, or `.sidebar-tool-panel .memory-panel[data-compact]`
  Memory internals.
- `settings.css` owns both base MemoryPanel selectors and compact
  `.memory-panel[data-compact="true"]` selectors.
- Mounted browser test verifies expand, keyboard focus to Delete, DELETE
  request, row removal, empty state, and screenshot evidence.
- Existing source tests and architecture guards pass.

## Follow-up 2026-06-23: Empty Task Memory Copy

### Recall

| Source | Constraint carried forward |
| --- | --- |
| This spec | The mounted left Memory browser test already verifies the post-delete empty state. |
| `MemoryPanel.tsx` | Empty copy uses `memory.none` when a current task ID exists and `memory.none_unselected` only when no task is selected. |
| Visual QA | `.scratch/memory-panel-delete-empty-state.png` showed "No task context" after deleting the only row while the task remained selected. |

### Fix Plan

1. Keep the existing `MemoryPanel` branch owner: selected task with zero rows
   uses `memory.none`.
2. Change `memory.none` locale copy to describe an empty list, not a missing
   task.
3. Make the mounted browser test assert the exact post-delete empty copy.

### Acceptance

- With a selected task and zero memory rows, the panel says there are no context
  entries.
- With no selected task, `memory.none_unselected` remains the task-selection
  prompt.
- Browser screenshot evidence for the post-delete state is reviewed again.

### Implementation

- Updated `memory.none` in both supported locales to describe an empty context
  entry list instead of a missing task.
- The mounted browser test now asserts the exact post-delete empty copy.

### Verification

| Check | Result |
| --- | --- |
| `bun run --cwd packages/overlay check:i18n` | Pass |
| `bun run --cwd packages/overlay typecheck` | Pass |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts` | 1 pass |
| Visual QA | Reviewed `.scratch/memory-panel-delete-empty-state.png`; empty state reads "No context entries" without layout overlap. |

### Self Review

- The selected-task and no-task branches remain separate; only the selected-task
  empty copy changed.
- No new locale key, fallback, or duplicate empty-state source was added.
