# Card Trace Action Button Owner

Date: 2026-06-18

UI means User Interface. CSS means Cascading Style Sheets. DOM means Document
Object Model.

## Problem

`CardHeader`, `ChatBubble`, and `TracePanel` still render operation controls as
raw `<button>` elements with private CSS classes:

- card error reason copy
- inspect trace
- session model settings
- agent cancel
- rewind
- trace copy / refresh / close

That leaves a second action-button implementation beside the shared
`Button` / `.oc-button` primitive. `CardHeader` also manually handles Enter and
Space for several native buttons while `ChatBubble` does not, creating two
keyboard activation paths for the same visible controls.

## Recall

| Source                                            | Relevant constraint                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-card-header-nested-interactions.md`   | Disclosure and sibling actions are already separated; this fix must not move actions back inside the disclosure button.       |
| `2026-06-17-card-header-action-rhythm.md`         | Card and chat bubble actions must keep the same meta/control rail rhythm.                                                     |
| `2026-06-18-acceptance-panel-button-owner.md`     | Operation controls should route through `Button` and style through `.oc-button[data-ui="..."]`, not local raw button classes. |
| `2026-06-18-trace-panel-icon-guard-retirement.md` | `TracePanel` already uses `Icon`; remaining gap is Button primitive ownership.                                                |

## Impact Sweep

| Sweep                                                                                                                     | Result                                                                                                                                                         | Decision                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------- | ------------------- | ----------------- | ----------- | ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `rg -n "card\_\_rewind                                                                                                    | card\_\_trace                                                                                                                                                  | card\_\_agent-cancel                                                                                               | card\_\_error-reason                                     | trace-panel-copy | trace-panel-refresh | trace-panel-close | card-rewind | card-trace | trace-copy" packages/overlay/src packages/overlay/test specs` | Live source hits are `CardHeader.tsx`, `ChatBubble.tsx`, `TracePanel.tsx`, `card.css`, and rewind visual tests. Existing docs mention old selectors as history. | Migrate the three live components and update tests; do not preserve old action classes. |
| `rg -n "card\_\_agent-reply-toggle                                                                                        | agent-reply-toggle" packages/overlay/src packages/overlay/test specs`                                                                                 | The reply-toggle selector exists only inside `card.css`; no component emits it.                                    | Remove it with the old private card action button shell. |
| `rg -n -e "<Button" -e "from \"./ui/Button\"" packages/overlay/src/components packages/overlay/test -g "*.tsx" -g "*.ts"` | `Button` is the existing local primitive used by overlay operation controls. It accepts native button attributes plus variant/size/tone and owns `.oc-button`. | Import and use `Button`; style surface-specific density through `data-ui` selectors.                               |
| `packages/overlay/test/browser/rewind-visual-stress.test.ts`                                                              | Existing browser fixture exercises CardHeader and ChatBubble action rails and screenshot capture.                                                              | Update it to use `[data-ui="card-rewind"]` and assert action buttons carry `oc-button`.                            |
| `packages/overlay/src/services/trace.ts`                                                                                  | Per-session trace uses `session/:id/trace`; task trace uses `task/:id/trace`.                                                                                  | Add a session trace fixture to the browser stress test so the TracePanel header actions are visually captured too. |

## Fix Plan

- Import `Button` in `CardHeader`, `ChatBubble`, and `TracePanel`.
- Replace raw operation buttons with `Button`:
  - `data-ui="card-error-reason"`
  - `data-ui="card-trace"`
  - `data-ui="card-agent-model-settings"`
  - `data-ui="card-agent-cancel"`
  - `data-ui="card-rewind"`
  - `data-ui="trace-copy"`
  - `data-ui="trace-refresh"`
  - `data-ui="trace-close"`
- Move visual variants from private classes to `.oc-button[data-ui="..."]`
  selectors in `card.css`.
- Use `data-state` for copied/open/pending states and remove manual
  `onKeyDown` activation on native action buttons.
- Keep `.card__meta-actions`, `.card__control-actions`,
  `.card__actions`, and `.chat-bubble__actions` as layout group owners.

## Acceptance

- No live component renders `class="card__trace"`, `class="card__rewind"`,
  `class="card__agent-cancel"`, `class="card__error-reason"`,
  `class="trace-panel-copy"`, `class="trace-panel-refresh"`, or
  `class="trace-panel-close"`.
- Card, chat bubble, and trace action controls render through `<Button>`.
- CSS owner for these controls is `.oc-button[data-ui="..."]`, not private raw
  button classes.
- Browser visual stress confirms rewind controls remain visible and do not
  overlap after the primitive migration.
- Browser visual stress opens a session TracePanel, verifies copy/refresh/close
  carry `.oc-button` and accessible labels, captures the rendered panel, then
  closes it through the real close action.
