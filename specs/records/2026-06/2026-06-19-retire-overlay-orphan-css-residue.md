# Retire Overlay Orphan CSS Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Recall

| Source                                                                                          | Relevant constraint                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                                                     | High-confidence dead CSS may be cleaned as part of the active GUI bug-hunt goal; do not leave double-source residue.                                                        |
| `2026-06-19-retire-sidebar-orphan-selectors.md`                                                 | CSS-only selectors without production DOM owners should be deleted and converted into absence guards.                                                                       |
| `2026-06-19-retire-file-editor-nav-residue.md`                                                  | Suspected dead CSS needs a production owner sweep before deletion.                                                                                                          |
| `TaskList.tsx`, `CardHeader.tsx`, `ChatBubble.tsx`, `InlineToolPart.tsx`, `FileChangesView.tsx` | Live task rows, card headers, tool messages, and file-change rows use current `task-row-*`, `card__title-row`, `msg-tool-*`, `.change-path-stack`, and `Button` primitives. |

## Evidence Sweep

| Selector               | Command result                                                                                                                                                                      | Decision                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `.global-task-current` | `rg -n 'global-task-current' packages/overlay/src packages/overlay/test specs` returns only `sidebar.css`.                                                                          | Delete; no collapsed-sidebar readout DOM owner remains.                                                                                                                                                                                                           |
| `.task-row-badge-icon` | `rg -n 'task-row-badge-icon' packages/overlay/src packages/overlay/test specs` returns only `sidebar.css`; current badges render a pseudo-element or explicit ledger icon classes.  | Delete; live status badge owner is `.task-row-badge::before`.                                                                                                                                                                                                     |
| `.card__meta-row`      | `rg -n 'card__meta-row' packages/overlay/src packages/overlay/test specs` returns only `card.css`; current headers use `.card__title-row`, `.card__subtitle`, and `.card__actions`. | Delete; no card header emits this meta row.                                                                                                                                                                                                                       |
| `.msg-tool-expand`     | `rg -n 'msg-tool-expand' packages/overlay/src packages/overlay/test specs` returns only `messages.css`; tool expansion now lives in card/header disclosure controls.                | Delete; no message tool expand button owner remains.                                                                                                                                                                                                              |
| `.plan-summary`        | `rg -n 'plan-summary' packages/overlay/src packages/overlay/test specs` returns only `messages.css` and `inspector.css`.                                                            | Delete; no narrative block DOM owner remains.                                                                                                                                                                                                                     |
| `.overview-summary`    | `rg -n 'overview-summary' packages/overlay/src packages/overlay/test specs` returns only `inspector.css`.                                                                           | Delete; no overview summary DOM owner remains.                                                                                                                                                                                                                    |
| `.overview-next-step`  | `rg -n 'overview-next-step' packages/overlay/src packages/overlay/test specs` returns only an `inspector.css` comment and selector.                                                 | Delete; no next-step DOM owner remains.                                                                                                                                                                                                                           |
| `.change-path`         | `rg -n 'class="[^\"]\*change-path                                                                                                                                                   | change-path' packages/overlay/src/components packages/overlay/src/styles/surfaces/changes.css packages/overlay/test`shows no TSX owner for`.change-path`; `FileChangesView.tsx`renders`.change-path-stack`, `.change-file-name`, and `.change-directory` instead. | Delete; preserve the live `.change-path-stack` file-change contract. |

Excluded false positives:

- `hljs-*` selectors are emitted by syntax highlighting and remain live.
- `cm-*` selectors are emitted by CodeMirror and remain live.
- `md-*` selectors are emitted by the markdown renderer and remain live.

## Fix

- Remove the CSS-only selector families from `sidebar.css`, `card.css`, `messages.css`, `inspector.css`, and `changes.css`.
- Add a focused absence guard that checks both runtime source and stripped CSS for the retired selector names.
- Keep live task row, card header, message tool, and file-change path stack styles untouched.

## Acceptance

- `packages/overlay/src` has no production owner or CSS rule for `.global-task-current`, `.task-row-badge-icon`, `.card__meta-row`, `.msg-tool-expand`, `.plan-summary`, `.overview-summary`, `.overview-next-step`, or `.change-path`.
- CSS structural validity still passes, proving selector removal did not leave dangling comma heads.
- Overlay typecheck and the focused residue test pass.
