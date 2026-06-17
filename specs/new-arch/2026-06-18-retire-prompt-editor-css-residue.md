# Retire Prompt Editor CSS Residue

Date: 2026-06-18

## Problem

The Prompt Catalog panel now exposes prompt-profile management as the editable
prompt surface. Per-agent prompt editor cards were removed from
`PromptCatalog.tsx`, but old editor CSS and one sizing test still treated the
retired editor as live UI.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-16-prompt-profile-expert-squad-switching.md` | Prompt profiles are the single editable expert-squad surface; the UI must not loop over all agents and mutate prompt append fields. |
| `prompt-catalog-save.test.ts` | `PromptCatalog` must no longer render per-agent prompt editor cards or `prompt-textarea`. |
| `2026-06-18-command-palette-config-sections-single-source.md` | Config surfaces should derive from the current single source, not stale local lists. |

## Impact Sweep

| Sweep | Result |
| --- | --- |
| `rg -n "prompt-textarea|prompt-view-tabs|prompt-view-tab|prompt-editor-actions" packages/overlay/src packages/overlay/test` | Production code no longer references the retired selectors; only `settings.css` and old tests did. |
| `rg -n "prompt-preview-card|prompt-preview-body" packages/overlay/src/components/settings/PromptCatalog.tsx packages/overlay/src/styles/surfaces/settings.css` | Profile read-only preview still uses `prompt-preview-card` and `prompt-preview-body`; those rules remain live. |

## Fix

- Remove retired per-agent prompt editor CSS:
  - `.prompt-grid`;
  - `.prompt-card*`;
  - `.prompt-editor*`;
  - `prompt-view-tabs` / `prompt-view-tab`;
  - `.prompt-textarea`.
- Keep `prompt-preview-card`, `prompt-preview-body`, and
  `prompt-preview-card--attached` for the profile read-only preview.
- Update sizing and architecture guard tests to reject the retired editor
  classes instead of locking them in place.

## Acceptance

- `PromptCatalog.tsx` continues to reject `prompt-textarea`.
- Settings CSS no longer contains retired per-agent prompt editor selectors.
- Live prompt-profile textareas and preview cards remain covered.
