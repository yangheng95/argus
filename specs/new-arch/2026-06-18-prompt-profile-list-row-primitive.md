# Prompt Profile List Row Primitive

Date: 2026-06-18

UI means User Interface. ARIA means Accessible Rich Internet Applications.

## Problem

Independent GUI review found that Prompt Profiles still render their selectable
list rows as hand-written `button.prompt-profile-list-item` surfaces. The row
already uses correct `aria-current` semantics, but visual row chrome, hover,
active, and focus styling live beside the settings `.s-row` primitive instead
of inside it.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings rows should converge on `SettingsRow` and `.s-row`; domain classes may remain only for layout details. |
| `2026-06-18-prompt-profile-list-current-aria.md` | Prompt profile list rows are command buttons and should keep `aria-current`, not `aria-selected` or `aria-pressed`. |
| `packages/overlay/src/components/settings/primitives.tsx` | `SettingsRow` currently owns `.s-row` chrome, but only renders a `div`, which leaves selectable rows without a primitive root. |
| `packages/overlay/src/components/settings/PromptCatalog.tsx` | The Prompt Profiles list is the only production owner of `.prompt-profile-list-item`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -F "prompt-profile-list-item" packages/overlay/src packages/overlay/test specs/new-arch` | Production owner: `PromptCatalog`; CSS owns hover/active/focus; tests assert the old class. | Retire `.prompt-profile-list-item`; use `SettingsRow as="button"` with `prompt-profile-list-row` as domain class. |
| `rg -n -F "prompt-profile-list" packages/overlay/src packages/overlay/test specs/new-arch` | List container and copy/meta classes remain layout-specific. | Keep `prompt-profile-list`, `prompt-profile-list-copy`, and `prompt-profile-list-meta`; move row chrome to `.s-row`. |
| `rg -n -F "aria-current" packages/overlay/src/components/settings/PromptCatalog.tsx packages/overlay/test specs/new-arch` | Existing browser test verifies current profile semantics. | Preserve `aria-current="true"` and continue rejecting `aria-selected` / `aria-pressed`. |

## Fix Plan

1. Extend `SettingsRow` with `as="button"` and `type="button"` support so a
   clickable settings row can reuse the same `.s-row` root without a wrapper.
2. Migrate Prompt Profiles list items from raw `button.prompt-profile-list-item`
   to `SettingsRow as="button" class="prompt-profile-list-row"`.
3. Replace row chrome selectors in `settings.css` with
   `.prompt-profile-list-row` scoped on `.s-row`; keep copy/meta typography
   selectors because those are domain layout, not row primitive ownership.
4. Update static tests to require `SettingsRow` and reject
   `prompt-profile-list-item`.
5. Update the Prompt Profile browser test selectors, add keyboard focus checks,
   and save a focused-list screenshot.

## Acceptance

- No production code creates `.prompt-profile-list-item`.
- Prompt Profiles list rows render through `SettingsRow` with `.s-row`.
- Current profile rows still expose `aria-current="true"` only.
- Browser coverage proves click selection, keyboard focus-visible, and textarea
  labeling still work.
- Prompt Profiles list screenshot confirms row density, current state, status
  pills, and focus ring remain readable.
