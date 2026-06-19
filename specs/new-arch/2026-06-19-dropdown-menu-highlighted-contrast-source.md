# Dropdown Menu Highlighted Contrast Source

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. CWD means current working directory, the project
directory selected by the user.

## Problem

The Expert Squad select report was already fixed at the shared Kobalte Select
source, but a follow-up impact sweep found the same class of light-popup risk in
Kobalte DropdownMenu consumers. Several menu rows styled only pointer hover and
focus-visible states. Kobalte keyboard navigation marks the active item with
`data-highlighted`, so keyboard-highlighted rows could remain visually identical
to unhighlighted rows on white popup surfaces.

## Recall

| Source | Relevant decision |
| --- | --- |
| `2026-06-18-expert-squad-unselected-option-contrast-guard.md` | Expert Squad select readability belongs to shared Kobalte popup styling, not component-local option color patches. |
| `2026-06-18-popup-contrast-light-palette.md` | Non-Select popup readability is guarded by the popup contrast browser matrix. |
| `2026-06-18-light-popup-active-state-contrast.md` | Active popup states must be covered explicitly; unselected/default rows alone are not enough. |
| `2026-06-18-workspace-split-launcher-button-primitive.md` | Workspace launcher triggers use the shared Button primitive while menus remain Kobalte DropdownMenu owned. |
| `2026-06-18-recent-directory-actions-button-primitive.md` | Recent directory actions use shared Button primitives; row layout remains scoped in `conversation.css`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "data-highlighted|oc-select-option" packages/overlay/src/styles packages/overlay/test` | Shared Select options and titlebar theme options already style `[data-highlighted]`. | Do not patch Expert Squad locally. Preserve shared Select source. |
| `rg -n "DropdownMenu\\.Item|workspace-.*option|project-worktree-item|recent-dir-item" packages/overlay/src/components packages/overlay/src/styles/surfaces/conversation.css packages/overlay/test` | Workspace launcher options, project worktree items, and recent directory items are Kobalte DropdownMenu items with hover/focus CSS only. | Add `[data-highlighted]` to those existing state groups. |
| Independent agent P1 audit | Executor model options used `.executor-model-option[data-focused]`, but Kobalte Listbox marks the active option with `data-highlighted`. Titlebar ordinary menubar items also only covered hover/focus-visible while theme radio options already covered `[data-highlighted]`. | Replace the impossible executor state and add ordinary titlebar menu `[data-highlighted]` styling. |
| Independent agent P2 audit | File changes rows are Kobalte Listbox items, but each row also wrote a local `data-selected="true/false"` and missed `data-highlighted`. | Let Kobalte own selected state, style presence `[data-selected]`, and add row `[data-highlighted]`. |
| `packages/overlay/test/browser/popup-contrast-matrix.test.ts` | The matrix samples these popup families but did not mark their Kobalte highlighted state. | Add highlighted samples and runtime style assertions. |
| Raw color scan over touched CSS and tests | Existing touched implementation uses project tokens and `color-mix`; no new raw hex/rgb/hsl color source is needed. | Use existing `--subtle-3`, `--text-strong`, `--accent`, and surface tokens only. |

## Fix Plan

1. Extend workspace launcher option hover/focus selectors with
   `[data-highlighted]`.
2. Extend project worktree item hover/focus selectors with
   `[data-highlighted]`.
3. Extend recent directory row, text, remove-slot, and remove-button visible
   states with `:has(.recent-dir-item[data-highlighted])`.
4. Update static tests to lock the Kobalte highlighted selectors.
5. Update the popup contrast browser matrix to render highlighted rows for
   worktree, recent directory, and workspace launcher popup samples, then assert
   highlighted visuals differ from the unhighlighted base state.
6. Replace impossible `data-focused` executor CSS with Kobalte
   `[data-highlighted]` and reject the retired selector in tests.
7. Add ordinary titlebar menubar `[data-highlighted]` coverage.
8. Remove FileChanges local `data-selected` row output so selected state has one
   owner, then style Kobalte `[data-selected]` and `[data-highlighted]`.

## Acceptance

- Kobalte DropdownMenu keyboard-highlighted rows are visibly highlighted on light
  popup surfaces.
- No component-local Expert Squad select override is introduced.
- No new raw color or parallel token source is introduced.
- Workspace launcher, project worktree, and recent directory popup highlighted
  states are covered by static tests.
- Executor model, titlebar ordinary menu, and file changes listbox highlighted
  states are covered by tests.
- FileChanges no longer emits local boolean/string `data-selected`; Kobalte owns
  row selected state.
- Browser popup matrix screenshot and runtime assertions cover highlighted
  worktree, recent directory, and workspace launcher rows.
