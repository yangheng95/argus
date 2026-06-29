# Runtime Inline SVG Icon Single Source

Date: 2026-06-18

## Problem

`components/Icon.tsx` is documented as the single icon primitive, but runtime
components still contained three hand-written 40x40 inline SVG drawings:

- `ConfigDialogHost.tsx` rendered the About author avatar directly.
- `Conversation.tsx` rendered both empty-state icons directly.
- `flat-redesign-icon-coverage.test.ts` only rejected inline 16px and 24px
  `viewBox` values, so 40x40 runtime icon drift was not caught.

This created a second runtime icon source outside the Lucide/custom registry.

## Recall

| Source                                                | Relevant decision                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `2026-06-17-icon-html-single-source.md`               | `components/Icon.tsx` owns icon rendering; callers must use `<Icon>` or `iconHtml()` for string-template flows. |
| `2026-06-18-trace-panel-icon-guard-retirement.md`     | Component exceptions weaken the icon guard and should be removed once migrated.                                 |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Overlay runtime icons should not reintroduce scattered inline SVG definitions.                                  |

## Impact Sweep

| Sweep                                                       | Result                                                                           | Decision                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `rg -n '<svg\b                                              | </svg>                                                                           | viewBox=' packages/overlay/src packages/overlay/test specs/new-arch -g '_.ts' -g '_.tsx' -g '\*.md'` | Runtime source outside `Icon.tsx` only had inline SVG in `ConfigDialogHost.tsx` and `Conversation.tsx`; test fixtures still use SVG as external sample data. | Replace runtime SVG with existing Icon names; leave test fixtures out of runtime guard. |
| `packages/overlay/src/components/Icon.tsx`                  | Existing registry already exposes `avatar-user`, `message`, and `file-document`. | Reuse existing Icon names instead of adding custom glyphs.                                           |
| `packages/overlay/test/flat-redesign-icon-coverage.test.ts` | Guard rejected only 16/24 inline SVG icons.                                      | Reject any inline `<svg>` in runtime component sources outside `Icon.tsx`.                           |

## Fix

- Replace the About author avatar SVG with `<Icon name="avatar-user" />`.
- Replace task empty-state SVG with `<Icon name="file-document" />`.
- Replace no-task empty-state SVG with `<Icon name="message" />`.
- Tighten icon coverage so future runtime inline SVG drift fails regardless of
  `viewBox` size.

## Acceptance

- `rg '<svg\b' packages/overlay/src -g '*.tsx' -g '*.ts'` reports only
  `components/Icon.tsx`.
- Conversation and Settings About visuals still render through the shared
  `.chat-empty-icon` and `.about-author-avatar` styling hooks.
- Focused source tests and icon guard pass.
- Browser screenshots verify the task empty state, no-task empty state, and
  Settings About panel after migration.
