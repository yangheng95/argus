# Overlay log-upload toast recovery — 2026-07-15

## Recall

| Item | Recorded requirement or evidence |
| --- | --- |
| User request | Change the pictured `Overlay log upload failed` error notification so it automatically disappears and uses a semi-transparent surface that respects the existing Overlay design language. “自动消息” is interpreted from context as “自动消失”. |
| Acceptance criteria | The log-upload failure toast has a positive, named lifetime; automatic dismissal hides only the toast while retaining its error row in notification-center history; the toast surface is visibly translucent and uses existing color, border, radius, shadow, and scale tokens; the panel-history card is not made translucent; focused unit/static tests and a real rendered screenshot pass visual review. |
| Hard constraints | Preserve the existing notification store as the single lifecycle source; no fallback, compatibility path, new notification implementation, raw palette, whole-card opacity, or change to the persistent default for unrelated error/warning notifications; do not restart or refresh the user's running Overlay; launch browser verification with Node. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-06/notification-center-history-contract-2026-06-09.md`; `packages/overlay/src/utils/log.ts`; `packages/overlay/src/services/notification-state.ts`; `packages/overlay/src/components/NotificationCenter.tsx`; `packages/overlay/src/styles/surfaces/notifications.css`; `packages/overlay/test/log-flush-notification.test.ts`; `packages/overlay/test/notify-error-persistence.test.ts`; `packages/overlay/test/notification-center-primitive.test.ts`. |
| Whole-repository grep | `system:overlay-log-upload-failed` is produced only by `utils/log.ts` and asserted by the log-flush/SSE tests. `showStoredNotification` is owned by `notification-state.ts`; `notify.ts` is its only other production caller. `.app-notification` and toast/panel surface distinctions are owned only by `notifications.css`. Existing tests explicitly preserve persistent defaults for ordinary errors and readable dismissed panel rows without whole-card opacity. Existing semi-transparent surfaces use `color-mix(..., transparent)` and design tokens. |
| Independent agent feedback | None: the user did not request independent or parallel agents, and the active collaboration constraint prohibits delegation without that request. Main-agent second review remains required. |
| Working-tree boundary | The current worktree contains unrelated uncommitted OpenCorvus backend/prompt/test edits. This task owns only the files listed in the implementation plan below and will not stage or modify those unrelated paths. Current `HEAD` already equals `legacy-remote/v0.0.5beta`. |

## Causal boundary

The failure diagnostic currently calls `showStoredNotification` through
`notifyLoggedError` with `timeoutMs: 0`. This intentionally overrides the
notification store's timer and leaves the toast visible even after the queued log
write succeeds. The same item has `centerHistory: true`, so using the existing
dismiss timer can hide the toast without deleting the durable notification-center
row. No new recovery state is needed.

The shared `.app-notification` background applies to both toast and panel surfaces.
Changing it would weaken notification-center history readability. The visual change
therefore belongs to the existing toast-surface selector, while tone-specific border
and mark colors remain unchanged.

## Call-point inventory and decision

| Call point | Decision |
| --- | --- |
| `packages/overlay/src/services/notification-state.ts` `defaultTimeout` | Export one named transient notification duration and reuse it as the existing info/success default. This is duration configuration, not a second lifecycle owner. |
| `packages/overlay/src/utils/log.ts` `notifyLoggedError` | Apply the named transient duration only to `system:overlay-log-upload-failed`; retain `centerHistory: true` and the semantic error tone/details. |
| `packages/overlay/src/utils/log.ts` flush recovery | Keep the existing bounded retry and non-recursive diagnostic behavior unchanged. |
| `packages/overlay/src/styles/surfaces/notifications.css` | Add a toast-only translucent token-based background. Keep panel rows and dismissed-history readability unchanged; do not use whole-card `opacity`. |
| `packages/overlay/test/log-flush-notification.test.ts` | Replace the sticky-timeout expectation with the named positive lifetime and prove history retention after timer-driven dismissal. |
| `packages/overlay/test/notification-center-primitive.test.ts` | Guard that translucency is toast-scoped, token-based, and not implemented with card opacity. |
| `packages/overlay/test/browser/notification-center-task-action-browser.test.ts` | Reuse the real notification fixture and screenshot path for computed/rendered toast material review; no new UI harness. |

## Verification plan

1. Run the focused lifecycle and CSS tests.
2. Run the existing Node-launched notification browser test and inspect its toast screenshot at actual rendered size.
3. Run Overlay typecheck/build checks relevant to the touched source.
4. Run historical-doc links and document-health checks for the new record.
5. Review the exact diff, stage only task-owned files, commit with `dsw-33987`, and push `v0.0.5beta` to `legacy-remote` without restarting the running Overlay.

## Implementation and verification evidence

- `notification-state.ts` now exports `TRANSIENT_NOTIFICATION_TIMEOUT_MILLISECONDS = 5000`; the existing transient default and the log-upload diagnostic consume the same named duration.
- `notifyLoggedError` accepts the duration as an explicit call parameter. Ordinary `AppLog.error` notifications continue to pass the zero default, while `reportFlushFailure` alone supplies the transient duration. The existing retry and non-recursive logging paths are unchanged.
- The existing toast-surface rule now mixes `var(--surface-strong)` at 78% against transparency. Border, radius, shadow, type, icon, and tone styles continue to come from the shared notification design language; the panel rule has no transparent override and no card-level opacity was introduced.
- Focused lifecycle/style tests: `34 pass / 0 fail / 188 assertions`.
- Overlay TypeScript typecheck: pass.
- The Node-launched real notification browser test built the current Overlay and completed toast rendering, keyboard traversal, details disclosure, copy behavior, and `.scratch/notification-task-action-toast.png` capture. The inspected screenshot preserves a restrained error border, readable hierarchy, existing controls, radius, and elevation. The script later failed outside this delivery surface because `right-activity-fixture.ts` still queries retired `#solidRightActivityToolbar` after current Right Dock ownership moved to `#rightDock`; the screenshot and toast assertions occurred before that failure. Concurrent uncommitted Right Dock/GOALS work makes that stale fixture an out-of-scope semantic overlap, so it was not overwritten.
- An isolated Vite process served the current source at `127.0.0.1:41731`. The Codex in-app Browser loaded the real application and read the live CSSOM rule as `.app-notifications[data-surface="toast"] .app-notification { ... background: color-mix(in srgb, var(--surface-strong) 78%, transparent); }`. The isolated Vite process and browser tab were then closed; the user's running Overlay was not restarted or refreshed.
- Post-stage `historical-docs-links.test.ts` and `document-health.test.ts`: pass. The first combined document-health run had reported only that the new indexed record was not yet Git-tracked; staging the task-owned record and rerunning closed that expected ordering dependency.
