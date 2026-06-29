# Retire Settings Config Shell Residue

Date: 2026-06-18

## Problem

Settings panels now use the `.s-*` primitive layer and shared config dialog
body shell, but legacy collapsible selector families still remained in CSS and
tests:

- `.config-section`
- `.config-section-head`
- `.config-section-head-text`
- `.config-subsection`
- `.config-subsection-head`
- `.config-subsection-body`

Those classes no longer have production DOM creation points. Keeping their CSS
and existence tests creates a second source that can silently re-style future
settings work.

## Recall

| Source                                                  | Relevant constraint                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-17-settings-select-primitive-single-source.md` | Settings controls must compose shared primitives; Kobalte Select is owned by `SettingsSelect`.                           |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md`   | Mature primitives should own shared UI semantics; per-panel hand-rolled controls should retire.                          |
| `retired-reference-ledger.md`                           | The old `overlay-settings-primitives-2026-05-26.md` path is historical; current source is settings primitive code/tests. |

## Evidence Sweep

| Command                                                                                      | Result                                                                                                      | Decision                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| `rg -n --pcre2 "config-section-head-text                                                     | config-section-head                                                                                         | config-subsection-head                                                         | config-subsection-body | config-subsection | config-section(?!-body)" packages/overlay/src/components packages/overlay/src/main.tsx packages/overlay/src/index.html -g "_.tsx" -g "_.ts" -g "\*.html"` | No production creation points. | Retire these selectors instead of preserving CSS-only shells. |
| `rg -n -F "config-section-body" packages/overlay/src/components packages/overlay/src/styles` | `ConfigDialogHost.tsx` still creates `config-section-body`; `settings.css` owns its layout.                 | Keep `config-section-body` as the dialog tab-panel body shell.                 |
| `rg -n "class=\"s-" packages/overlay/src/components/settings -g "*.tsx"`                     | Direct `.s-*` output should exist only in `primitives.tsx`; `PromptCatalog.tsx` still hand-wrote `.s-pill`. | Move prompt profile pills to `SettingsPill` and guard against future bypasses. |

## Fix

- Remove `.config-section*` and `.config-subsection*` CSS selectors from
  settings, field, conversation, workspace, and typography surfaces.
- Preserve `.config-section-body` because it is still rendered by
  `ConfigDialogHost`.
- Replace `PromptCatalog` raw `.s-pill` spans with `SettingsPill`.
- Convert legacy single-source tests into absence guards for retired selectors.
- Update architecture and sizing guards so they pin the current source of truth
  instead of requiring dead selectors to exist.

## Acceptance

- Retired config shell selectors do not exist in production CSS or settings
  component source.
- `config-section-body` remains styled and rendered.
- Settings panels outside `primitives.tsx` cannot hand-write `.s-*` primitive
  classes.
- Targeted unit tests, overlay typecheck, i18n, and browser visual verification
  pass.
