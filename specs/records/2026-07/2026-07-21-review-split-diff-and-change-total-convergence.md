# Review Split Diff And Change Total Convergence

Status: implemented, visually verified, and ready for delivery

## Recall

| Item | Detail |
| --- | --- |
| User request | Make Review follow the supplied Codex file-list/diff-comparison reference and fix Environment Changes showing `+0 -0` while Review shows real counts. |
| Acceptance criteria | Desktop Review renders one simultaneous diff-left/file-list-right workspace; selection, keyboard activation, filtering, grouping, virtualization and explicit programmatic diff requests continue to work. Environment totals equal Review when group aggregates are zero but per-file statistics are non-zero. Unit/source/type/i18n/build, Node-launched browser screenshot, direct visual inspection and second review pass. |
| Hard constraints | Reuse Solid/Kobalte Listbox, SearchField, SegmentedControl, Checkbox, Panel, FileRow, DiffPreviewPanel and the existing task-scoped diff API/cache. No second diff source, fallback, compatibility path, iframe, hidden state, mobile scope, or interference with running OpenCorvus processes. Preserve unrelated dirty and concurrently committed work. |
| Supplied evidence | `codex-clipboard-abbf6f79-e6dc-4d0d-9477-5882fdb030aa.png` shows Review `+2063 -185`; `codex-clipboard-fa7d5fe2-5691-4fe7-bbfa-9132864baf02.png` establishes diff-left/file-tree-right structure; `codex-clipboard-1a660773-3ff0-4c36-a7d9-d48848e9b5f0.png` shows the same task's Environment row at `+0 -0`. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshots; `specs/current/architecture/07-panel.md`; July records for Review parity, full diff ownership, shared file rows and Environment Changes; current Review/Environment components, diff service, styles and focused/browser tests. |
| Whole-repository grep | `FileChangesPanel` has one `main.tsx` mount; `ChangesPanel` owns merged Review groups; `FileChangesView` alone owns file-list filters/selection; `DiffPreviewPanel`/`DiffView` own the single-file renderer; `currentChangeGroups()` feeds Review and Environment; only Review previously called `resolveCurrentChangeGroups()`; Review reduced per-file counts while Environment reduced `ChangeGroup` aggregates; `.project-runtime-change-totals` is rendered only by `TaskDirBar`. Regression owners are `diff-change-groups`, `agent-file-changes`, `task-cwd-row-layout`, `toolbar-diff-navigation`, and `task-dirbar-keyboard`. |
| Independent agent feedback | None; the user did not request sub-agents. |

## Causal chain

The visible `+0 -0` is not a formatting defect. Review sums
`FileChange.additions/deletions`, while Environment previously summed optional
`ChangeGroup.additions/deletions`. Goal evidence can contain authoritative
`changedFileDiffs` but a missing/zero `diffStats`, producing two answers from
one group. Earlier browser coverage populated both representations with the
same values, so it could not detect drift.

## Implementation

- `services/diff.ts` exports one per-file `summarizeChangeGroups` projection.
- `TaskDirBar.tsx` uses the resolved current groups and rejects stale
  cross-task resource results before calling that shared projection.
- `FileChangesView.tsx` replaces inline row expansion with a selected-row
  `DiffPreviewPanel` beside the unchanged canonical Listbox.
- `changes.css` owns the desktop split, independent scroll regions and compact
  tree density; aggregate counts stay in the summary and diff header.
- Focused tests set group totals to zero while per-file totals remain non-zero,
  and replace obsolete inline-expansion checks with selected split-diff checks.

## Verification plan

1. Run focused source/unit tests and Overlay type/i18n/build checks.
2. Run the Node browser fixtures for Review and Environment, capture the task
   surface, inspect it directly and correct visual/interaction defects.
3. Run docs health and diff checks, perform a second owner/caller review,
   commit with `dsw-33987`, and push the current primary branch to `legacy-remote`.

## Verification results

- `bun test packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/diff-change-groups.test.ts`: 11 passed.
- Node browser `toolbar-diff-navigation`: passed; `.scratch/review-split-diff-file-tree.png` proves one diff pane on the left and one selected file tree on the right at the desktop reference width.
- Node browser `task-dirbar-keyboard`: passed; `.scratch/task-dirbar-runtime-status-panel-merged.png` shows Environment Changes at `+375,786 -211,596` while transport `diffStats` is deliberately `+0 -0`.
- Overlay TypeScript typecheck and panel i18n check: passed.
- Historical documentation link/structure health: 21 passed.
- Direct screenshot review found and corrected the initial narrow file-pane density; the final screenshot preserves readable file names, statuses, diff lines, aggregate totals, and the reference region order.

## Second review

The final caller audit confirms that Review and Environment both reduce the
same `ChangeGroup.changes` projection, while only `DiffPreviewPanel` requests
full before/after bodies for the selected file. Explicit programmatic diff
requests still use the existing dedicated view, so the change does not create
a second diff renderer or source. The browser fixture now serves the real
goal-run diff contract exercised by selection instead of suppressing that
request.
