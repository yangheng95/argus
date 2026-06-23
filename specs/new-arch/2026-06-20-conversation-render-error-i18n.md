# Conversation Render Error i18n

Date: 2026-06-20

i18n means internationalization. DOM means Document Object Model. UI means User Interface.

## Problem

Independent GUI review found `ConversationCardRenderFailure` hard-coded
English visible and accessible copy:

- `Unknown render error`
- `aria-label="Card render failed"`
- visible title `Card render failed`

This fallback appears exactly when a card or bubble renderer fails. In a
Chinese locale, the normal empty conversation copy already comes from
`t("chat.empty")`, but the error boundary skipped the same i18n source. That
made the highest-value diagnostic UI drift away from the locale bundle and
screen-reader text contract.

## Recall

| Source                                                  | Constraint                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                             | User-visible UI strings must follow the project's i18n state; UI work needs visual verification.                                                    |
| `Conversation.tsx`                                      | The normal empty states already use `t("chat.empty")`; render-error fallback must use the same text source.                                         |
| `packages/overlay/src/i18n/en-US.json` and `zh-CN.json` | Locale bundles are the single source for user-visible overlay strings. Existing Mission keys are dirty in the worktree and must not be overwritten. |
| `card-tree-reachability.test.ts`                        | The ErrorBoundary fallback is intentional; do not remove the boundary or hide failures.                                                             |

## Impact Sweep

| Sweep                                                                                   | Result                                                                                 | Decision                                                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------- | ---------------------------------------------------- | ----------------------------- |
| `rg -n "ConversationCardRenderFailure                                                   | Card render failed                                                                     | Unknown render error                                                                                                          | conversation-card-render-failure | ErrorBoundary"` | Only `Conversation.tsx` owns this render-error card. | Fix the shared fallback once. |
| `git diff -- packages/overlay/src/i18n/en-US.json packages/overlay/src/i18n/zh-CN.json` | Both locale files already contain unrelated Mission key edits.                         | Add only `chat.render_error_*` keys and commit them through a temporary index blob that preserves unrelated worktree changes. |
| Browser test scan                                                                       | Existing browser tests hydrate conversations but do not force a render-error fallback. | Add a focused browser visual test for the localized render-error card surface using real overlay CSS.                         |

## Fix Plan

- Replace hard-coded render-error title and aria label with
  `t("chat.render_error_title")`.
- Replace the unknown-error fallback with `t("chat.render_error_unknown")`.
- Add both keys to `en-US.json` and `zh-CN.json`.
- Add static coverage that rejects the old hard-coded strings in
  `Conversation.tsx` and asserts both locale bundles contain the keys.
- Add browser visual coverage that renders the error-card surface with real
  overlay CSS, checks Chinese visible and accessible copy, and saves a
  screenshot.

## Acceptance

- `Conversation.tsx` no longer contains hard-coded English fallback text.
- Both locale bundles contain `chat.render_error_title` and
  `chat.render_error_unknown`.
- Browser screenshot verifies the render-error card is visible with Chinese
  title, message, and aria label.
- No fallback or second error-card component is introduced.
