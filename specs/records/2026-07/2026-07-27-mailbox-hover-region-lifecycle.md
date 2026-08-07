# Mailbox hover-region lifecycle repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Hovering the upper-left Mailbox launcher shows the Mailbox list. Moving from the launcher into that list must keep it usable so a message can be clicked and read. Leaving the complete left region restores the normal Projects menu. Clicking the launcher must no longer pin Mailbox open. |
| Supplied evidence | `codex-clipboard-38034fd9-9d4b-4eae-8c08-28c8e4c620bf.png` was inspected at original resolution. It shows the Mailbox list filling the left Dock beneath the launcher, with the conversation workspace immediately to the right. |
| Acceptance criteria | Hovering the launcher opens Mailbox after the existing pointer-intent delay; moving to any Mailbox row keeps Mailbox visible and the row remains clickable; leaving `#leftActivityShell` restores Work Ledger/Projects after the same short pointer-intent buffer; re-entering cancels that close; clicking or pressing the launcher never creates a persistent Mailbox selection; the mounted Mailbox list retains row disclosure and scroll state across preview cycles. Desktop-only behavior is verified in a real isolated page and task-scoped screenshots are inspected. |
| Hard constraints | Reuse the existing `Button`, mounted side-activity bodies, and Mailbox accordion. Do not add a route, fallback, feature gate, iframe, query override, second persisted selection, or replacement interaction primitive. Do not restart or interfere with the user's running OpenCorvus/Overlay. Launch Playwright with Node only. Preserve all unrelated dirty-worktree hunks. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `2026-07-25-conversation-environment-mailbox-hover-repair.md`; `2026-07-25-mailbox-notification-count-and-hover-lifecycle.md`; `App.tsx`; `main.tsx`; `activity.css`; focused source and browser tests. |
| Whole-repository grep | `App.tsx` is the only launcher and left-activity visibility owner. `main.tsx` is the only producer of `leftSidebarPanel`, `openLeftSidebarMailbox`, `closeLeftSidebarMailbox`, and `toggleLeftSidebarMailbox`; there are no non-launcher consumers. `mailbox-contextbar-launcher.test.ts` is the focused ownership test. `mailbox-left-sidebar-browser.test.ts` is the real interaction/visual fixture. Other Mailbox tests consume the rendered active body but do not own selection. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | Branch `work-v0.0.19beta-yr-0727` is synchronized with `myhexin/work-v0.0.19beta-yr-0727` at `1384e19c8b`. The worktree already contains unrelated edits in `App.tsx`, `TaskDirBar.tsx`, shared styles, and tests; only task-owned hunks will be staged. |

## Causal chain

1. The launcher schedules a local hover preview correctly.
2. The launcher itself also owns `onMouseLeave={cancelMailboxHoverPreview}`.
   Moving the pointer from the launcher to the Mailbox body therefore cancels
   the preview before the pointer reaches a row.
3. Click delegates to `main.tsx`, where `leftSidebarPanel` changes from `work`
   to `mailbox`. That second, persistent source keeps Mailbox resident after the
   pointer leaves the left Dock.
4. The visible activity should instead have one source: the existing
   `App`-local preview signal. The complete left activity shell is the semantic
   hover region and therefore owns preview cancellation.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Keep the delayed preview signal. Move cancellation from the launcher to `#leftActivityShell`. Remove launcher click activation so only pointer hover opens the transient preview. Replace toggle semantics with disclosure semantics. Keep Work Ledger Search mounted so launcher geometry remains stable. |
| `packages/overlay/src/main.tsx` | Delete `LeftSidebarPanel`, its signal, and open/close/toggle functions. Stop passing `mailboxActive` and `onToggleMailbox`. Preserve Mailbox notification, unread count, task navigation, and mounted Mailbox ownership. |
| `packages/overlay/test/mailbox-contextbar-launcher.test.ts` | Assert shell-owned leave cancellation, absence of persistent selection owners, and transient launcher disclosure semantics. |
| `packages/overlay/test/browser/mailbox-left-sidebar-browser.test.ts` | Replace click-to-pin coverage with hover-launcher → hover-row → click/read coverage, shell-leave restoration, non-persistent click/keyboard activation, and scroll/disclosure preservation. |
| `packages/overlay/test/browser/mailbox-concurrency-browser.test.ts` | Replace the historical click-to-pin assertion with transient click closure, then keep the pointer inside the Mailbox body for pagination and scope-concurrency checks. |
| `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts` | Replace the notification attention click-open path with hover-open/left-region-leave behavior while preserving attention clearing, count, and animation assertions. |
| `packages/overlay/test/browser/connection-projection-lifecycle-browser.test.ts` | Repair the stream fixture's stale Mailbox event and catalog response so the real projection lifecycle continues to reach its checker under the current API contract. |
| Task-scoped browser verification | Run the existing real Node browser fixture in headed mode, capture left-Dock preview and restored states, and inspect screenshots at original resolution. |

## Implementation plan

1. Update the focused source assertions and real browser fixture to describe the
   requested lifecycle.
2. Remove the persistent selection source and bind cancellation to the entire
   left activity shell.
3. Run focused unit tests, the real Mailbox browser fixture, Overlay typecheck
   and build, documentation health, and diff hygiene.
4. Inspect task-scoped screenshots and correct visual or interaction drift.
5. Re-grep owners, review the exact diff a second time, commit only task-owned
   files with the `dsw-33987` prefix, fetch/converge, and push to `myhexin`.

## Result

Mailbox now has one visibility owner: the `App`-local delayed hover preview.
The launcher starts the preview, the complete `#leftActivityShell` schedules
its close using the existing 180 ms pointer-intent duration, and re-entry
cancels that close. The former `main.tsx` persistent Work/Mailbox selection
source has been deleted. The launcher has disclosure semantics and no click
handler, while the mounted Mailbox body preserves disclosure and scroll state.

The real Node browser fixture verified launcher-to-row pointer travel, expanded
and displayed a Mailbox message body after the pointer left the launcher, and
restored Projects only after the pointer left the complete left region.
Task-scoped screenshots of hover-open, message-expanded, and restored states
were inspected at original resolution and matched the requested desktop
behavior. Focused source tests, Mailbox lifecycle/concurrency browser fixtures,
connection projection, Overlay typecheck/build, documentation health, and diff
hygiene are the final verification set.

## Codex review feedback

The first call-site table omitted three real browser consumers found by the
full-repository `mailbox-toggle` grep: notification attention, Mailbox
concurrency, and connection-stream lifecycle fixtures. The table and test plan
now enumerate each consumer explicitly. No production owner beyond `App.tsx`
and `main.tsx` was found.

The second review found that binding `focusout` to the shell would close the
preview during legitimate focus movement inside Kobalte Mailbox controls. The
handler was removed after the real browser path exposed the issue; shell-level
pointer leave remains the single close event. Screenshot-driven pointer
jitter then proved that immediate close was too brittle, so close now reuses
the existing pointer-intent duration and is cancelled by shell re-entry. The
same review confirmed that the new launcher contains no click or keyboard
state mutation and that the unrelated `projectRuntimeStatusDockHost` hunk
already present in `App.tsx` is excluded from this change.
