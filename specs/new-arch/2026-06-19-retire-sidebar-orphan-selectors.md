# Retire Sidebar Orphan Selectors

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

`sidebar.css` still defined three selectors with no production DOM owner:
`.sidebar-list-heading`, `.task-row-meta`, and `.sidebar-subtitle`.

The sidebar grouping model now renders through `ProjectLedgerGroup`, whose
content contract is `[data-ui="project-group-toggle"]`, `.project-group-copy`,
`.project-group-name`, `.project-group-parent`, and `.project-group-count`.
`TaskList` also explicitly asserts that it no longer renders
`class="task-row-meta"`, yet `overlay-architecture-guards.test.ts` still
required the dead CSS rule to exist.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-project-ledger-group-primitive.md` | `ProjectLedgerGroup` is the shared project grouping primitive and owns `project-group-*` JSX. |
| `TaskList.tsx` | Renders `ProjectLedgerGroup`; task rows render `task-row-head`, `task-row-stamp`, and action controls, not `task-row-meta`. |
| `ProjectLedgerGroup.tsx` | The live group toggle is `Button[data-ui="project-group-toggle"]`; no `.sidebar-list-heading` owner exists. |
| `index.html` | The sidebar header has `.sidebar-title` and `.sidebar-header-actions`; no `.sidebar-subtitle` markup exists. |

## Evidence Sweep

| Command | Result | Decision |
| --- | --- | --- |
| `rg -n -F "sidebar-list-heading" packages/overlay/src packages/overlay/test specs/new-arch docs` | Production hit was only `sidebar.css`; tests still protected the selector. | Delete the CSS and convert the single-source test to a retirement guard. |
| `rg -n -F "task-row-meta" packages/overlay/src packages/overlay/test specs/new-arch docs` | Production hit was only `sidebar.css`; `task-list-buttons-primitive.test.ts` already asserts `TaskList.tsx` does not render `class="task-row-meta"`. | Delete the CSS and add CSS absence coverage. |
| `rg -n -F "sidebar-subtitle" packages/overlay/src packages/overlay/test specs/new-arch docs` | Production hit was only `sidebar.css`; `index.html` renders `sidebar-title` and header actions only. | Delete the CSS and convert architecture coverage to negative. |
| `rg -n "project-group|ProjectLedgerGroup|sidebar-list-heading|task-row-meta|sidebar-subtitle" packages/overlay/src packages/overlay/test specs/new-arch --glob "*.*"` | Live project grouping is `ProjectLedgerGroup` + `Button[data-ui="project-group-toggle"]` + `.project-group*` content classes; Mission and Coding Assistant ledgers also use that primitive. | Preserve the shared toggle, `.project-group*` content classes, and ledger row styles. |

## Fix

- Remove `.sidebar-subtitle`, `.sidebar-list-heading`, and `.task-row-meta`
  from `sidebar.css`.
- Update architecture guards so live sidebar owners stay positive, while the
  retired selectors become absence guards.
- Convert the old `.sidebar-list-heading` single-source test into a retirement
  guard that verifies `ProjectLedgerGroup` is the live heading owner.
- Extend the task list primitive test so `task-row-meta` is absent from CSS as
  well as JSX.
- Repair the related task-tree source guard so it accepts the repository's
  semicolon-free handler style while still requiring `stopPropagation`,
  `preventDefault`, and `draggable={false}`.

## Acceptance

- Production source and CSS contain no `.sidebar-list-heading`,
  `.task-row-meta`, or `.sidebar-subtitle`.
- `.project-group*`, `.task-row-head`, `.task-row-stamp`, and task row action
  styles remain covered.
- Project ledger browser validation still shows task, mission, and coding
  assistant groups rendering through `[data-ui="project-group-toggle"]`.
