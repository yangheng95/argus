# Overlay close and Conversation chrome repair

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request          | Restore the running spinner for project-owned Chat and Mission rows; make closing the floating desktop Overlay responsive; make the Work Ledger activity tone gray-brown rather than orange; vertically center the hover timestamp with the preceding message-header content; place duration immediately after the Agent title instead of at the far edge; and keep the Composer context flag equal to the Code / Work experience selected for the submitted conversation.                                                                                                                                                                                                                                                         |
| Supplied evidence     | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-66545523-0643-4f68-a3b7-a5d8db726fea.png`, `C:/Users/10132/AppData/Local/Temp/codex-clipboard-3c49ea4b-f5a6-461f-8e06-a06b52a53c67.png`, and `C:/Users/10132/AppData/Local/Temp/codex-clipboard-8ec71b54-f2b5-4885-9583-d8c5b147c259.png` show the affected Work Ledger status lane and Conversation identity/hover rows.                                                                                                                                                                                                                                                                                                                                                       |
| Acceptance criteria   | Active Chat and Mission rows use the established rotating loading icon; active child-Task dots use a muted gray-brown token mixture; confirmed desktop exit removes the visible window without first waiting up to five seconds for sidecar shutdown; Conversation hover time shares the identity row's vertical center; duration follows the title/Goal badge/status cluster; an active Work conversation displays Work and an active Chat conversation displays Code from the selected conversation source; real desktop UI is interacted with, screenshotted, and personally reviewed.                                                                                                                                          |
| Hard constraints      | Reuse `Icon`, `StatusIndicator`, Kobalte-owned actions, theme tokens, the existing `RunEvent::Exit` cleanup hook, and the current Card timing source. Do not add a state machine, gate, fallback, compatibility path, second shutdown owner, second timer, raw color, or hand-built UI primitive. Do not add, modify, update, or run UI automated tests. Desktop-only visual acceptance.                                                                                                                                                                                                                                                                                                                                           |
| Sources read          | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/12-overlay-card-system.md`; `specs/current/architecture/16-unified-teardown.md`; `2026-07-30-conversation-running-dot-and-hover-time.md`; `2026-07-30-main-message-card-gradient.md`; `2026-06-04-overlay-close-confirm-quit.md`; `2026-07-29-code-work-composer-and-grouped-references.md`; `2026-07-29-composer-conversation-context-flags.md`; current Work Ledger, Project Ledger group, Tooltip, StatusIndicator, ChatBubble, ChatComposer, conversation-session selection, CardHeader chrome, native-window lifecycle, Tauri shutdown, and related style sources.                                                                                       |
| Whole-repository grep | Searches covered `sessionLoading`, `work-row-loading`, `work-row-status`, `StatusIndicator`, `CardDurationChip`, `chat-bubble__identity-row`, `chat-bubble__title`, `chat-bubble__hover-actions`, `closeDelay`, `ignoreSafeArea`, `quitOverlay`, `overlay_quit`, `stop_server`, `onCloseRequested`, every `stop_server` caller, `ComposerMode`, `composerMode`, `setComposerMode`, `onComposerModeChange`, `conversationSourceExperience`, `ConversationExperience`, and conversation creation/selection call sites. Production ownership is limited to the call sites below. Two related UI automation files were discovered under `packages/overlay/test`; the current project rule requires deleting them without running them. |
| Independent feedback  | The user did not request multiple independent agents, and the active collaboration policy forbids unsolicited delegation. The primary Agent retains implementation and second-review responsibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Baseline              | The clean current branch `work-v0.0.26beta-yr-0730` matched `myhexin/work-v0.0.26beta-yr-0730` at `eb96c556ca`; a baseline push completed through the repository pre-push typecheck hook before implementation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Root cause chain

1. The July 30 running-indicator change explicitly replaced the existing
   `work-row-loading-icon` spinner with `StatusIndicator appearance="dot"` for
   active Chat and Mission rows. The missing spinner is therefore a renderer
   regression, not missing lifecycle data.
2. The same shared active-dot rule uses `--warn`, which reads as orange in the
   supplied light-theme Work Ledger. The remaining child-Task dot needs a
   Work-Ledger-scoped muted token mixture; changing the global primitive would
   also alter Conversation status semantics.
3. `chat-bubble__identity-row` aligns its two lanes at `flex-start`, so the
   hover-only absolute time/action lane sits above the vertically centered
   identity content. Its title also owns `flex: 1 1 auto`, consuming all free
   space before status and duration and pushing duration to the far edge.
4. `overlay_quit` and the tray Quit handler call synchronous `stop_server`
   before `app.exit(0)`. `stop_server` waits up to five seconds for graceful
   child exit while the window remains visible. `RunEvent::Exit` then calls
   `stop_server` again, so shutdown has duplicate ownership and visible
   latency.
5. The active Composer context badge reads `composerMode`, which owns the
   launcher choice rather than the selected conversation identity. Conversation
   creation correctly persists `experience` and projects it into
   `boardStore.selectedSource`, but the badge ignores that canonical source.
   This allows the launcher signal to display Code after a submitted Work
   conversation even though the selected session is correctly stored as Work.

## Call-site decisions

| Owner / call site                     | Decision                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkLedger.tsx::sessionLoading`      | Restore the established `Icon name="loading"` wrapper only for active Chat and Mission rows. Preserve child-Task status on the shared `StatusIndicator`.                                                                                                                                                                                             |
| `work-ledger.css`                     | Restore spinner geometry and rotation. Give only active Work Ledger `StatusIndicator` dots a muted gray-brown mixture of `--text-muted` and `--warn`; do not alter the global status primitive.                                                                                                                                                      |
| `ChatBubble.tsx`                      | Preserve the current identity order: avatar, title, Goal badge, status, duration. No timer or markup duplication is needed.                                                                                                                                                                                                                          |
| `chat-bubble.css`                     | Center the identity row and header owners vertically; let the title shrink without growing into all remaining space so status and duration remain adjacent.                                                                                                                                                                                          |
| `main.rs::overlay_quit` and tray Quit | Request application exit immediately. Delete their duplicate direct cleanup calls.                                                                                                                                                                                                                                                                   |
| `main.rs::RunEvent::Exit`             | Preserve as the single process-cleanup owner for every real application exit. `restart_server` remains the separate non-exit restart owner and continues to stop before restarting.                                                                                                                                                                  |
| `main.tsx` `ChatComposer` mount       | Pass the canonical `conversationSourceExperience()` into the one Composer mount. Preserve `composerMode` as the launcher selector owner; do not synchronize or duplicate active-conversation state.                                                                                                                                                  |
| `ChatComposer.tsx`                    | Use the selected conversation experience for the non-interactive active-conversation flag. Use `composerMode` only for the launcher Code / Work selector and for non-conversation Task projection.                                                                                                                                                   |
| Conversation creation/selection       | Preserve. `createConversationSessionFromPath` and `selectConversationSession` already write the requested experience into the selected `BoardSource`; lifecycle selection also preserves that identity.                                                                                                                                              |
| Related UI automation                 | Delete `packages/overlay/test/window-close-confirm.test.ts` and `packages/overlay/test/browser/close-confirm-dialog-browser.test.ts` without running them. They assert source/UI rendering and interaction behavior prohibited by the current UI automation rule; no dedicated production fixture or screenshot baseline is retained by either file. |

## Implementation and verification

1. Restore the mature Work Ledger spinner and its existing hover/action-rail
   behavior; scope the remaining active Task dot to the requested token-derived
   gray-brown tone.
2. Correct the one Conversation header flex composition so time, status, and
   duration share one vertical center and duration follows title metadata.
3. Remove pre-exit sidecar cleanup from direct Quit callers, preserving
   `RunEvent::Exit` as the only exit cleanup path.
4. Project the active Composer mode flag from the selected conversation's
   canonical experience while keeping the launcher selector on its existing
   local mode.
5. Delete the two discovered UI automation files. Do not run any UI test.
6. Run formatting, Overlay TypeScript typecheck/build, Rust compile checking,
   document health, historical link checks, and `git diff --check`.
7. Start the real Overlay using Node-backed browser tooling, exercise Work
   Ledger hover and Conversation rest/hover states, capture goal-bound
   screenshots, open real stored Work and Chat conversations to verify their
   context flags, and personally inspect them. Exercise the native confirmed
   close path in the packaged desktop runtime when available; otherwise report
   that exact acceptance surface as unverified rather than substituting a
   browser mock.
8. Review all changed call sites and the complete diff a second time, then
   commit with the required `dsw-33987` prefix and push the current delivery
   branch to `myhexin`.

## Progress

- [x] Restored the established rotating loading icon for active Chat and Work
      rows and kept the active child-Task dot on the shared status primitive.
- [x] Scoped the active child-Task dot to the requested token-derived muted
      gray-brown tone.
- [x] Corrected Conversation identity-row geometry so status and duration stay
      adjacent to the title and the hover lane shares the same center line.
- [x] Removed duplicate sidecar shutdown from both direct application-exit
      callers; `RunEvent::Exit` remains the sole real-exit cleanup owner.
- [x] Projected the active Composer flag from the selected conversation
      experience while preserving the launcher selector's existing owner.
- [x] Deleted the two discovered UI automation files without running them.
- [x] Completed compilation, build, document-health, real-page interaction,
      screenshot inspection, and second diff review.

## Verification

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build`: passed after transforming 7,057
  modules; only the existing Radix `use client` and large-chunk advisories were
  emitted.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml`: passed.
- `bun run docs:check`: passed with 311 operations in 24 groups.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 22
  passed, 0 failed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 63 passed,
  0 failed when rerun alone. The first deliberately parallel verification pass
  exhausted three tests' five-second limits; their assertions all passed on the
  isolated rerun.
- `git diff --check`: passed.
- Real local page `http://127.0.0.1:5173/` was driven through the in-app
  browser against the real backend. A real read-only Work request produced one
  `[data-ui="work-row-loading"]` node and zero active Work Ledger status-dot
  nodes; the visible rotating icon is captured in
  `specs/artifacts/2026-07-30-overlay-chrome-repair/active-work-ledger-spinner.png`.
- A stored Work conversation projected `{ data-mode: "work", text: "Work" }`
  and a stored Chat conversation projected
  `{ data-mode: "code", text: "Code" }`. Their inspected screenshots are
  `active-work-conversation.png` and `active-code-conversation.png` in the same
  artifact directory.
- The real Work message header measured title/status/duration gaps of 7 px and
  vertical centers within 1.01 px: title/status at 161.28 px, duration at
  161.27 px, and hover time/actions at 162.27 px. The screenshot also shows
  `WORK`, the active dot, and `21s` as one adjacent cluster.
- No active child Task was present in the real ledger during acceptance, so the
  gray-brown child-dot token could not be captured without manufacturing a
  Task. The exact production selector remains scoped to active child Task dots,
  and active Chat/Work rows were visually verified to use the spinner instead.
- Native confirmed-close interaction was not substituted with a browser mock.
  The Rust owner change compiled, and the exhaustive caller review confirms
  both UI/tray quit paths now call `app.exit(0)` immediately while
  `RunEvent::Exit` owns the single sidecar cleanup.
- No UI automated test was added, modified, updated, or run.
