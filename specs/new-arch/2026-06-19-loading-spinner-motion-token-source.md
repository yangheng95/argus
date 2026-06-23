# Loading Spinner Motion Token Source

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

Loading and progress spinner shapes were rendered as static rings. The message
and preview surfaces emitted `.card__spinner`, and the notification surface
emitted `.app-notification__spinner`, but neither class had an animation
declaration.

`card.css` also carried an unused `@keyframes card-spin`, so the only spin
keyframe owner was dead while tokenized loop durations already existed in
`design-language.css`.

## Recall

| Source                                               | Relevant constraint                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `2026-06-19-provider-refresh-spinner-owner.md`       | Spinner styling must bind to the live DOM owner instead of a retired selector.                                  |
| `2026-06-19-retire-card-status-badge-residue.md`     | `.card__spinner` remains live for BrowserPreview, Architect, FrontendResearch, and Requirements loading states. |
| `2026-06-18-notification-live-region-task-action.md` | `NotificationCenter` is the single shared notification component for toast and panel surfaces.                  |
| `flat-redesign-motion-coverage.test.ts`              | Motion durations must route through `--ui-duration-*` tokens.                                                   |

## Evidence Sweep

| Command                                                                    | Result                                                                                                | Decision                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `rg -n -C 3 'card\_\_spinner                                               | @keyframes card-spin                                                                                  | app-notification\_\_spinner' packages/overlay/src/styles/surfaces/card.css packages/overlay/src/styles/surfaces/notifications.css` | `.card__spinner` and `.app-notification__spinner` drew static rings; `@keyframes card-spin` had no caller.      | Replace the dead keyframe with one shared live spin owner.     |
| `rg -n -C 2 '<span class="card\_\_spinner"                                 | <span class="app-notification\_\_spinner"' packages/overlay/src/components -g '\*.tsx'`               | BrowserPreview, Architect, FrontendResearch, Requirements, and NotificationCenter render these classes.                            | Do not edit JSX call sites.                                                                                     |
| `rg -n -C 3 'ui-duration-loop-agent-spin                                   | ui-duration-loop-notification-spin                                                                    | prefers-reduced-motion' packages/overlay/src/styles/tokens/design-language.css packages/overlay/src/styles/cascade/base.css`       | Token source already declares agent and notification spin durations; base owns shared reduced-motion overrides. | Use those tokens and keep reduced-motion in the cascade layer. |
| `bun test packages/overlay/test/flat-redesign-motion-coverage.test.ts ...` | The existing guard also exposed `task-row-children-pulse 1.4s ease-in-out infinite` in `sidebar.css`. | Treat it as the same motion-source bug and replace the literal pulse duration/timing with existing tokens.                         |

## Fix

- Add shared `@keyframes oc-spin` in `cascade/base.css`.
- Bind `.card__spinner` to
  `animation: oc-spin var(--ui-duration-loop-agent-spin) linear infinite`.
- Bind `.app-notification__spinner` to
  `animation: oc-spin var(--ui-duration-loop-notification-spin) linear infinite`.
- Remove the unused `card-spin` keyframes.
- Add reduced-motion coverage for both live spinner classes.
- Replace the task tree active-child pulse declaration with
  `var(--ui-duration-loop-connection-pulse)` and
  `var(--ui-timing-standard)`.

## Acceptance

- Static motion guard requires tokenized spinner animations and rejects
  `card-spin`.
- Static motion guard requires the task tree active pulse to use shared loop
  motion tokens instead of literal durations.
- Browser validation observes live `.card__spinner` motion in the actual
  BrowserPreviewPanel loading state.
- Browser validation observes notification spinner CSS in the real overlay page
  and confirms reduced-motion disables both spinner animations.
