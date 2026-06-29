# File Changes Filter Primitive Owner

Date: 2026-06-18

UI means User Interface. CSS means Cascading Style Sheets. DOM means Document
Object Model.

## Problem

`FileChangesView` owns a real file-change filter toolbar, but two controls are
still hand-built:

- the clear-filter icon button uses `button.changes-filter-clear`
- the mutually-exclusive status filter uses a hand-written toolbar and
  `button.changes-status-chip` with local `aria-pressed`

That creates a second button/segmented-control implementation beside the shared
`Button` and Kobalte-backed `SegmentedControl` primitives. The double source is
not only visual: hover/focus/active semantics live in `changes.css` instead of
the primitive owners.

## Recall

| Source                                          | Relevant constraint                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-app-dialog-segmented-control.md`    | `SegmentedControl` is the generic Kobalte ToggleGroup wrapper for non-tab mutually-exclusive choices.                             |
| `2026-06-18-tabs-tabpanel-semantic-contract.md` | Browser Preview viewport choices moved from tabs to `SegmentedControl`; non-tab choices must not pretend to be tabs semantically. |
| `2026-06-18-retire-workspace-panel-residue.md`  | Current file changes diff close already routes icon actions through `Button` plus `.oc-button[data-ui="..."]`.                    |
| `2026-06-18-card-trace-action-button-owner.md`  | Operation controls should use `Button` and stable `data-ui` selectors, not private raw button classes.                            |

## Impact Sweep

| Sweep                        | Result                                                        | Decision                                                                         |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `rg -n "changes-filter-clear | changes-status-chip                                           | changes-status-strip" packages/overlay/src packages/overlay/test specs` | Live hits are `FileChangesView.tsx`, `changes.css`, and `agent-file-changes.test.ts`. Historical specs mention file changes but do not own these controls. | Replace live toolbar controls and update the single source guard.                                                                              |
| `rg -n "SegmentedControl     | oc-tabs                                                       | oc-tab                                                                           | @kobalte/core/toggle-group" packages/overlay/src packages/overlay/test`                                                                                    | `SegmentedControl` wraps Kobalte ToggleGroup and currently reuses `.oc-tabs` / `.oc-tab` visual primitives in Browser Preview and app dialogs. | Use `SegmentedControl<ChangeStatusFilter>` with `.oc-tabs` / `.oc-tab`; do not add another chip primitive. |
| `rg -n "<Button              | data-chrome=\"icon-action\"                                   | file-changes-diff-close" packages/overlay/src packages/overlay/test`             | File changes diff close already uses `Button` and `.oc-button[data-ui="file-changes-diff-close"]`.                                                         | Clear-filter action should follow the same Button primitive pattern.                                                                           |
| `FileChangesPanel.tsx`       | Header view tabs and diff close are already primitive-backed. | Do not modify panel tabs or diff close in this fix.                              |

## Fix Plan

- Import `Button` and `SegmentedControl` in `FileChangesView`.
- Replace `button.changes-filter-clear` with:
  - `Button`
  - `variant="ghost"`
  - `size="icon"`
  - `tone="neutral"`
  - `data-chrome="icon-action"`
  - `data-ui="file-changes-filter-clear"`
- Replace the status toolbar raw buttons with
  `SegmentedControl<ChangeStatusFilter>`:
  - `class="oc-tabs"`
  - `itemClass="oc-tab"`
  - `ariaLabel={t("files.status_filter_label")}`
  - `onChange={setStatusFilter}` and `onActivate={setStatusFilter}`
  - item `data-ui="file-changes-status-filter-option"`
  - item `data-status` and `data-size="sm"`
- Keep the `changes-status-strip` wrapper as a layout/scroll owner only.
- Replace the old `changes-status-chip-*` content classes with
  `changes-status-option-*` so the retired chip selector cannot survive as a
  misleading prefix.
- Update source and CSS guards so old raw button classes cannot return.

## Acceptance

- `FileChangesView` no longer renders `class="changes-filter-clear"`,
  `class="changes-status-chip"`, `changes-status-chip-*`, or hand-written
  `aria-pressed` status buttons.
- Clear-filter is a `Button` and styles through
  `.oc-button[data-ui="file-changes-filter-clear"]`.
- Status filter is a `SegmentedControl<ChangeStatusFilter>` and each option
  carries stable `data-ui` / `data-status` attributes.
- `changes.css` no longer defines private button chrome for
  `.changes-filter-clear` or `.changes-status-chip`.
- Tests guard the primitive ownership and the unchanged file-change filtering
  surface.
