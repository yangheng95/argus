# Select Popup Readability Impact Review

Date: 2026-06-18

## Report

The Expert Squad selector was reported as showing unreadable unselected options
on a white popup surface. This must be treated as a shared Select popup
readability issue, not a component-local color tweak, because Expert Squad uses
the same `.oc-select-*` popup contract as settings, log filtering, app dialogs,
and browser preview target selection.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-17-prompt-profile-selector-select-primitive.md` | Expert Squad was migrated from native select plus hidden chrome to Kobalte Select because the native popup could inherit transparent text. |
| `2026-06-17-select-popup-opaque-surface.md` | `.oc-select-content` is the shared popup surface and must use opaque `--menu-panel-bg`, not translucent `--surface`. |
| `2026-06-17-settings-select-primitive-single-source.md` | Settings panels use `SettingsSelect`; local settings panels must not own raw Select shells. |

## Evidence

| Sweep | Result |
| --- | --- |
| `rg -n "prompt-profile|PromptProfile|Expert Squad|专家团" packages/overlay/src packages/overlay/test` | Expert Squad lives in `ChatComposer.tsx` and uses `Select.Root<PromptProfileOption>`. |
| `rg -n "oc-select-content|oc-select-option|Select\\.Root" packages/overlay/src packages/overlay/test specs/new-arch` | Shared Select popup consumers are Expert Squad, AppDialog, BrowserPreview, LogViewer, and SettingsSelect users. |
| Current real browser screenshot `.scratch/prompt-profile-selector-current.png` | Current HEAD renders unselected Expert Squad options visibly on the light popup surface. |
| Independent explorer review | Both explorer agents found the current Expert Squad code already uses Kobalte Select and shared readable tokens; the remaining risk is incomplete matrix coverage for other Select consumers. |

## Decision

Do not add component-local foreground/background overrides to
`.prompt-profile-select-*`. The current shared source is already correct:

- `.oc-select-content` owns popup background and foreground.
- `.oc-select-option` owns option foreground.
- `.oc-select-option small` owns secondary option text.

The required hardening is a browser contrast matrix that loads real overlay CSS
and renders every current Select popup class combination on a light surface.
This catches local consumer classes that accidentally reintroduce transparent,
muted, or translucent option text.

## Coverage

The matrix must include:

- Expert Squad: `.prompt-profile-select-content` / `.prompt-profile-select-option`
- Agent model settings: `.agent-model-select-content` / `.agent-model-select-option`
- Skill/MCP settings form: `.settings-form-select-content` / `.settings-form-select-option`
- App dialog select: `.app-dialog-select-content` / `.app-dialog-select-option`
- Browser preview candidate select: `.browser-preview-candidate-content` / `.browser-preview-candidate-option`
- Log level select: `.log-level-select-content` / `.log-level-select-option`

## Visual Follow-Up

The first matrix screenshot showed that `SettingsSelect` descriptions were
readable by contrast but visually merged with the label because the shared
settings option wrapper had no column layout. The fix is still shared, not
component-local:

- `SettingsSelect` wraps any described option in `.oc-select-option-copy`.
- `.oc-select-option-copy` owns the two-line label/description layout.
- The class does not own foreground color; color remains under
  `.oc-select-option` and `.oc-select-option small`.

## Acceptance

- Expert Squad light-theme popup remains readable in the existing real overlay
  browser test.
- Shared Select popup matrix verifies opaque light popup backgrounds and
  contrast of primary and secondary option text.
- No production CSS patch is added unless the matrix exposes a real failing
  consumer.
