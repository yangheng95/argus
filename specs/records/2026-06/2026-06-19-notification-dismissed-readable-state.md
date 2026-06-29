# Notification Dismissed Readable State

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model. UI means User Interface.

## Problem

Independent GUI review found `.app-notification[data-dismissed="true"]`
reduced the whole notification card with `opacity: 0.72`. Dismissed error and
warning notifications remain visible in the notification center history, so the
parent opacity also reduced title, body, task action, details controls, and
diagnostic text. This is the same effective-contrast failure class as the
light-popup disabled-state repair: readable foreground tokens become unreadable
after ancestor opacity is multiplied into the rendered color.

## Recall

| Source                                               | Constraint                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                          | Frontend UI changes require real browser screenshot review and no fallback or double-source styling.                         |
| `2026-06-18-notification-live-region-task-action.md` | `NotificationCenter` is the single shared toast/panel notification component; do not split the data source or render branch. |
| `notification-center-history-contract-2026-06-09.md` | Dismissed center-history notifications are intentionally retained and visible in the panel.                                  |
| `2026-06-18-popup-disabled-effective-contrast.md`    | Do not use whole-element opacity for readable state changes because it corrupts effective text contrast.                     |
| `flat-redesign-opacity-coverage.test.ts`             | Opacity is token-governed globally, but dismissed notification history needs a stricter no-whole-card-opacity guard.         |

## Impact Sweep

| Sweep                                                                                                                              | Result                                                                                                                                                                | Decision                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `rg -n "app-notification\[data-dismissed\|data-dismissed=\|dismissedAt" packages/overlay/src packages/overlay/test specs/new-arch` | The dismissed visual state is only in `notifications.css`; `NotificationCenter.tsx` emits `data-dismissed` from `dismissedAt`; `notify.ts` keeps center-history rows. | Fix the shared CSS state once and keep the store/component contract unchanged.                                         |
| `rg -n -e "NotificationCenter" -e "app-notification" packages/overlay/src packages/overlay/test specs/new-arch`                    | Toast and panel both use the same component and CSS.                                                                                                                  | Do not add toast/panel special cases.                                                                                  |
| `notification-center-primitive.test.ts`                                                                                            | Existing static coverage pins component primitives and source ownership, not dismissed readability.                                                                   | Add a dismissed-state guard that rejects `opacity` on the state rule.                                                  |
| `notification-center-task-action-browser.test.ts`                                                                                  | Existing browser coverage closes toast and opens panel, but did not inspect the dismissed history style.                                                              | Reuse the real notification flow, screenshot the dismissed panel row, and assert effective opacity/contrast.           |
| `bun test packages/overlay/test/flat-redesign-opacity-coverage.test.ts ...`                                                        | Validation exposed existing literal opacity declarations in `composer.css`, `conversation.css`, `inspector.css`, and `sidebar.css`.                                   | Replace literal values with the existing canonical `--ui-opacity-*` tokens in the same pass so the token guard closes. |

## Fix Plan

- Remove whole-card opacity from `.app-notification[data-dismissed="true"]`.
- Keep a visible dismissed state through existing token-derived background,
  border, mark, and shadow styling.
- Preserve the existing `dismissedAt`, `visibleNotificationItems()`, and
  `centerHistoryNotificationItems()` ownership model.
- Add static coverage that fails if the dismissed notification rule declares
  opacity again.
- Add browser coverage that dismisses a toast, opens notification history, then
  verifies dismissed text/action controls keep effective opacity `1` and at
  least 4.5:1 contrast.
- Replace existing literal opacity declarations surfaced by the global opacity
  guard with the canonical opacity tokens; this is a token-source cleanup, not
  a new visual state model.

## Acceptance

- `notifications.css` has no whole-card opacity for dismissed history rows.
- Dismissed history rows still have a visible state using existing tokens.
- Static notification tests pin the no-opacity rule.
- Browser validation produces a dismissed notification panel screenshot and
  verifies title, message, task action, and details controls remain readable.
- The global flat-redesign opacity guard passes with no literal opacity values
  outside the token source.
