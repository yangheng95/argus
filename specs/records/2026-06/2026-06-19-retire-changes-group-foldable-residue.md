# Retire Changes Group Foldable Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Recall

- `AGENTS.md` requires root-cause fixes, no fallback paths, no double source, and a test for every code change.
- `2026-06-05-vscode-style-activity-toolbars.md` moved file changes into the left activities surface and made `FileChangesPanel` / `FileChangesView` the current owner.
- `2026-06-18-file-changes-filter-primitive-owner.md` established that file changes chrome should be centralized in `FileChangesView`, `changes.css`, and the shared primitive owners.
- `2026-06-19-file-changes-row-keyboard-single-activation.md` confirms the current list structure is Kobalte-backed `FileChangesView` rows under `.changes-list-group` / `.changes-list-chunk`.

## Evidence

| Sweep                                                 | Result                                                                                                                                                         | Decision                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `rg -n "changes-group--foldable                       | changes-list-group                                                                                                                                             | changes-group-header                                             | changes-list-chunk | changes-list" packages/overlay/src packages/overlay/test specs -g "_.tsx" -g "_.ts" -g "_.css" -g "_.md"` | `.changes-group--foldable` exists only in `changes.css`; live DOM class names are `.changes-list-group`, `.changes-group-header`, and `.changes-list-chunk`. | Delete the orphan selector instead of keeping compatibility styling for a retired DOM shape. |
| `packages/overlay/src/components/FileChangesView.tsx` | Non-virtualized grouped rows render `<div class="changes-list-group">`, optional `<div class="changes-group-header">`, and `<div class="changes-list-chunk">`. | Current structure stays unchanged.                               |
| `packages/overlay/src/styles/surfaces/changes.css`    | `.changes-list` already owns `padding: 0`; the orphan `.changes-group--foldable > .changes-list` repeats that declaration for a class no live component emits. | Remove the duplicate dead selector and guard against its return. |

## Root Cause

The file changes surface moved through multiple ownership shapes. The current
grouped-list DOM no longer emits `.changes-group--foldable`, but its CSS rule
survived as a compatibility residue. Keeping that selector creates a misleading
second source for grouped list spacing even though `.changes-list` is the active
spacing owner.

## Fix Plan

1. Delete `.changes-group--foldable > .changes-list` from `changes.css`.
2. Extend the existing static file changes ownership test to reject the retired selector.
3. Keep positive assertions for the current grouped DOM and CSS selectors.

## Acceptance

- `rg -n "changes-group--foldable" packages/overlay/src packages/overlay/test` returns only the new negative test if the literal appears at all.
- `agent-file-changes.test.ts` proves `.changes-list-group` and `.changes-group-header` remain the current owners.
- File changes tests pass without changing live DOM structure.
