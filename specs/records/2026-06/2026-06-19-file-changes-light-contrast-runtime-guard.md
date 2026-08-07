# File Changes Light Contrast Runtime Guard

## Context

- The Expert Squad option visibility report established that light-surface readability must be verified with real browser evidence, not static token assumptions.
- Independent impact review identified `FileChangesView` as a non-select Kobalte listbox surface without light-theme browser contrast coverage.
- Existing specs `2026-06-19-file-changes-row-keyboard-single-activation.md`, `2026-06-19-kobalte-selected-state-single-source.md`, and `2026-06-19-dropdown-menu-highlighted-contrast-source.md` keep FileChanges row selection and keyboard behavior owned by Kobalte runtime state.

## Evidence

| Source                                                | Finding                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/FileChangesView.tsx` | Rows are `Listbox.Item as="button"` and status filters are `SegmentedControl` options.                                                                                          |
| `packages/overlay/src/styles/surfaces/changes.css`    | Pointer hover uses `.change-row:hover`; Kobalte focus uses `[data-highlighted]`; selected uses `[data-selected]`. These are distinct states and must not be collapsed in tests. |
| `packages/overlay/src/styles/surfaces/diff.css`       | Diff stat colors had a delete foreground path separate from the existing `--diff-del-fg` token.                                                                                 |
| Browser run before fix                                | Selected row secondary text, modified pill, delete stat, and active filter count could fall below 4.5:1 on the light surface.                                                   |

## Decision

- Keep FileChanges pointer hover and Kobalte highlighted as separate visual states.
- Fix light selected/expanded row contrast at the FileChanges surface owner, using existing semantic tokens and token-derived colors only.
- Reuse existing `--diff-del-fg` for delete stat foregrounds instead of styling delete stat text directly from `--bad`.
- Extend the real `toolbar-diff-navigation` browser test to sample selected, hovered, and plain rows, plus status filter text, against the effective composited light surface.

## Acceptance

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/toolbar-diff-navigation.test.ts` passes.
- `.scratch/file-changes-light-contrast.png` is visually reviewed.
- No new raw user-visible colors are introduced in `changes.css` or `diff.css`.
- Existing keyboard activation coverage remains in the same runtime browser test.
