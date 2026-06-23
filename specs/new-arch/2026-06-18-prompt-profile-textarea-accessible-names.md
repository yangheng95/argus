# Prompt Profile Textarea Accessible Names

Date: 2026-06-18

## Problem

Editable prompt profiles render one textarea per agent overlay target. Each
target card already has a visible target title, but the textarea is not inside
a `<label>` and had no `aria-label` or `aria-labelledby`.

Screen reader users therefore encountered multiple unnamed textboxes when
editing a custom prompt profile, even though sighted users could associate each
textarea with the visible target heading.

## Evidence Sweep

| Search                                                       | Result                                                                                                    | Decision                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `rg -n "PromptCatalog                                        | prompt-profile                                                                                            | textarea                                                                    | aria-label                                                                                                      | aria-labelledby                                                                               | prompt-profile-textarea                  | prompt-profile-target" packages/overlay/src/components/settings/PromptCatalog.tsx packages/overlay/test packages/overlay/src specs/new-arch` | The only prompt profile overlay textareas are in `PromptCatalog.tsx`; they have visible `.prompt-profile-target-copy strong` titles but no accessible relation. | Fix `PromptCatalog.tsx`. |
| `rg -n "PromptProfileTarget                                  | targets:                                                                                                  | built_in_only                                                               | editable" packages/opencorvus/src packages/opencorvus/test packages/overlay/src/services packages/overlay/test` | Target ids come from the backend prompt profile catalog and are explicit lowercase/kebab ids. | Use target ids to derive stable DOM ids. |
| `packages/overlay/test/browser/prompt-profile-panel.test.ts` | Existing browser coverage opens the real prompt profile panel and switches to an editable custom profile. | Extend it with textarea accessible-name assertions and screenshot evidence. |

## Fix

- Add `promptProfileTargetLabelID(target.id)` in `PromptCatalog`.
- Assign that id to the visible target title.
- Set each editable `.prompt-profile-textarea` to
  `aria-labelledby={labelID}`.
- Add static coverage that prevents dropping the label binding.
- Extend the browser prompt profile panel test to assert each textarea points
  to the expected visible target title.
- Assert every `.prompt-profile-textarea` has the binding, and that none uses
  a duplicate `aria-label` source.

## Acceptance

- Editable prompt profile textareas expose an accessible name sourced from the
  visible target title.
- The browser test verifies `Requirements` and `Build` textareas point to their
  visible headings through `aria-labelledby`.
- The browser test fails if a prompt profile textarea is unnamed or uses
  `aria-label` instead of the visible heading.
- The existing prompt profile save/import behavior remains unchanged.
- No duplicate aria-only label source is introduced.
