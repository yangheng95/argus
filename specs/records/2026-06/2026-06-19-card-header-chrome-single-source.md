# 2026-06-19 Card Header Chrome Single Source

UI means User Interface. ARIA means Accessible Rich Internet Applications.

## Problem

`CardHeader` and `ChatBubble` both render the same header chrome:

- running/completed duration chip
- error reason copy button
- model label
- context token estimate
- usage token/cost hint
- inspect trace
- session model settings
- agent cancel
- rewind

The duplicate implementation violates the existing card-system constraint that
new card shells must not define a second title-bar implementation. It also
means future ARIA, Button primitive, loading-state, or visual rhythm fixes can
land in only one shell.

## Recall

| Source                                         | Relevant constraint                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `12-overlay-card-system.md`                    | `CardHeader.tsx` is the default structured card header source; new card shells must not define a second title bar. |
| `2026-06-17-card-header-action-rhythm.md`      | Metadata and icon controls are separate groups: `.card__meta-actions` and `.card__control-actions`.                |
| `2026-06-18-card-trace-action-button-owner.md` | Card operation controls route through `Button` plus stable `data-ui` selectors.                                    |
| `card-duration-single-source.test.ts`          | Duration rendering uses shared `formatDuration` and `useNowTick`, not private timers.                              |
| `rewind-visual-stress.test.ts`                 | Browser evidence already checks card and chat-bubble action rails for overlap and button semantics.                |

## Impact Sweep

| Sweep                                                        | Result                                                                     | Decision                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------- | ----------------- | ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rg -n "useCardHeadActions                                   | formatCostUSD                                                              | formatTokenCount                                          | useNowTick                                                                                                                   | card\_\_meta-actions                                                                                               | card\_\_control-actions                                                                                  | card-error-reason | card-agent-cancel | card-rewind | card-trace" packages/overlay/src packages/overlay/test specs` | Live duplicated TSX owners are `CardHeader.tsx` and `ChatBubble.tsx`; shared CSS and tests reference the resulting classes. | Move chrome logic to one component module and leave CSS selectors unchanged. |
| `rg -n "CardHeader\\.tsx                                     | 新增卡片不得再定义第二套标题栏                                             | card\_\_meta-actions                                      | card\_\_control-actions" specs/current/architecture/12-overlay-card-system.md specs packages/overlay/src packages/overlay/test` | History explicitly warns against a second title bar while later specs split metadata/control rails in both shells. | Keep `CardHeader` as the structured-card layout, but extract cross-shell chrome into `CardHeaderChrome`. |
| `rg -n "Session model settings                               | card-open-session-agent-models                                             | agent_models" packages/overlay/src packages/overlay/test` | The per-session model settings button currently exists only in `CardHeader`; no i18n key exists for that exact label.        | Preserve the existing label while moving ownership; do not edit dirty locale files in this round.                  |
| `packages/overlay/test/browser/rewind-visual-stress.test.ts` | Browser fixture queries both `.card__actions` and `.chat-bubble__actions`. | Reuse this as visual and DOM evidence after migration.    |

## Fix Plan

1. Add `CardHeaderChrome.tsx` as the single source for duration, error reason,
   metadata hints, and operation controls.
2. Make `CardHeader.tsx` render its default card title layout and delegate all
   chrome/action behavior to `CardHeaderChrome`.
3. Make `ChatBubble.tsx` keep its IM bubble shell, avatar, alignment, and
   folding behavior, but delegate the same chrome/action behavior to
   `CardHeaderChrome`.
4. Update static tests so `card__meta-actions`, `card__control-actions`, and
   `card-*` action `data-ui` attributes have one TSX owner.
5. Run the existing rewind browser stress fixture and inspect its screenshot so
   the shared component is verified in real card and chat-bubble DOM.

## Acceptance

- `CardHeader.tsx` and `ChatBubble.tsx` no longer import `useCardHeadActions`,
  `useNowTick`, `formatDuration`, `formatCostUSD`, or `formatTokenCount`.
- `CardHeaderChrome.tsx` is the only TSX owner of `.card__meta-actions`,
  `.card__control-actions`, `data-ui="card-trace"`,
  `data-ui="card-agent-cancel"`, and `data-ui="card-rewind"`.
- Card and chat-bubble action controls still render through `Button`.
- Existing CSS remains the single visual owner; no new raw colors or token
  family are added.
- Static tests, typecheck, and the rewind browser visual stress test pass.
