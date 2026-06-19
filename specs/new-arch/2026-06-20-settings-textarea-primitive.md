# Settings Textarea Primitive

## Problem

Settings owns three long-text editors that bypass the shared
`AutoGrowTextarea` primitive:

| Surface | Evidence | Current owner |
| --- | --- | --- |
| Prompt profile description | `packages/overlay/src/components/settings/PromptCatalog.tsx` | raw `<textarea class="field-input prompt-profile-description">` |
| Prompt profile agent prompt | `packages/overlay/src/components/settings/PromptCatalog.tsx` | raw `<textarea class="field-input prompt-profile-textarea">` |
| Provider model list | `packages/overlay/src/components/settings/ProvidersPanel.tsx` | raw `<textarea class="field-input provider-models-textarea">` |

`packages/overlay/src/components/primitives/AutoGrowTextarea.tsx` is the
single behavior source for auto-growing textareas, and
`packages/overlay/src/styles/surfaces/field.css` defines the
`.composer-textarea` chrome and scrollbar opt-in for form surfaces. Keeping
settings on raw `field-input` textareas reintroduces fixed-height behavior and
duplicates the scrollbar/focus contract.

## Recall

| Search | Result |
| --- | --- |
| `rg "<textarea|AutoGrowTextarea|composer-textarea" packages/overlay/src/components packages/overlay/test` | Production raw textarea users are isolated to `PromptCatalog.tsx` and `ProvidersPanel.tsx`; existing primitive users include `ChatComposer`, `GoalDialogHost`, `InteractionCard`, and `AgentSessionReplyBox`. |
| `rg "prompt-profile-textarea|provider-models-textarea" packages/overlay/src packages/overlay/test` | Static tests currently pin the old `field-input` class, and browser prompt-profile coverage already screenshots the editable prompt profile surface. |
| `rg "provider-discover-models|provider-search-input" packages/overlay/test/browser` | Provider settings browser coverage can open the real settings dialog and inspect the add-provider models textarea. |

## Fix Plan

1. Import `AutoGrowTextarea` into `PromptCatalog.tsx` and
   `ProvidersPanel.tsx`.
2. Replace the three raw settings textareas with `AutoGrowTextarea`, using
   `class="composer-textarea ..."` so behavior and chrome come from the shared
   source.
3. Keep domain CSS only for min-height and monospace needs; remove
   provider-specific `resize: vertical` because auto-grow owns sizing.
4. Extend structural tests so settings cannot reintroduce raw textareas.
5. Extend browser tests to verify the real prompt profile and provider models
   controls use `.composer-textarea`, keep visible scrollbar/focus behavior, and
   still render correctly in screenshots.

## Acceptance

- No production raw `<textarea>` remains in `PromptCatalog.tsx` or
  `ProvidersPanel.tsx`.
- Settings long-text editors render through `AutoGrowTextarea` and
  `.composer-textarea`.
- Prompt profile and provider settings browser tests save screenshots of the
  real settings surfaces after the migration.
- Existing overlay typecheck and targeted browser/static tests pass.
