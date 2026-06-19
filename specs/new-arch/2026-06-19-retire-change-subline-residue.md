# Retire Change Subline Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | High-confidence dead CSS must be removed instead of retained as compatibility residue; UI changes require tests and visual evidence. |
| `2026-06-19-retire-overlay-orphan-css-residue.md` | File-change rows already moved from old path selectors to `.change-path-stack`, `.change-file-name`, and `.change-directory`. |
| `FileChangesView.tsx` | The live DOM owner renders `.change-path-stack`, `.change-file-name`, and `.change-directory`; it does not render `.change-subline`. |
| `toolbar-diff-navigation.test.ts` | Browser contrast sampling already validates `.change-file-name` and `.change-directory` in selected, hovered, and plain rows. |

## Evidence Sweep

| Target | Result | Decision |
| --- | --- | --- |
| Production DOM owner | `rg -n -F "change-subline" packages/overlay/src/components` returns no live TSX owner. `FileChangesView.tsx` renders `.change-directory` for the path/context line. | Do not reintroduce `.change-subline`; keep `.change-directory` as the only subtitle owner. |
| Surface CSS | `changes.css` still defines `.change-subline` and includes it in selected/expanded row state selectors. | Delete the dead selector from the file-change surface. |
| Cascade typography | `typography.css` still treats `.change-subline` as a cross-class typography canonical. | Replace the typography regression with `.change-directory` and remove the dead selector from cascade CSS. |
| Tests | `content-subtitles-typography.test.ts` still requires `.change-subline` to exist. Browser file-change contrast checks already sample `.change-directory`. | Turn the test into a current-owner guard and add a retired-selector absence guard. |

## Fix

- Remove `.change-subline` from `changes.css` and `typography.css`.
- Update the content subtitle regression to protect `.change-directory` instead of the retired selector.
- Add a static absence guard so `.change-subline` cannot return in component or style sources.
- Add browser DOM verification that the rendered File Changes workbench contains no `.change-subline` while the existing visual contrast samples still cover `.change-directory`.

## Acceptance

- `rg -n -F "change-subline" packages/overlay/src packages/overlay/test` only finds intentional negative-control test text, if any.
- Focused file-change and typography tests pass.
- Browser file-change visual/contrast test passes and screenshots confirm selected, hovered, and plain rows still render readable file and directory text.
