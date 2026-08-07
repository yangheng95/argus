# Mission Entry Scroll Regression

Date: 2026-07-30
Status: Accepted

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Entering the Mission page has again lost scrolling. Determine why the previous repair regressed and implement the root correction. |
| Acceptance criteria | A populated Mission opens with one bounded `#chatScroll` viewport, a real positive scroll range when its rendered transcript exceeds the viewport, visible and draggable native scrollbar affordance, working wheel and keyboard scrolling, stable follow-lock, and the fixed Composer outside the scroll owner. A sparse fullscreen conversation must not show misleading bright platform chrome. Acceptance uses an isolated real Overlay page, direct interaction, task-scoped screenshots, and manual visual review; no UI automated test is added, modified, or run. |
| Hard constraints | Desktop-only scope. Preserve `#chatScroll` as the sole transcript overflow owner and `#solidChatComposer` as the sole Composer. Do not add a second scroller, custom scrollbar, viewport branch, fallback, gate, state machine, hard-coded platform width, iframe/query override, or touch the running Overlay. Playwright-backed interaction must use Node through the Browser integration. Preserve all unrelated dirty-worktree changes. |
| Supplied evidence | Mission Session `ses_04e14a2bfffeFXp3j6EyWMuBPO`, directory `/Users/yangheng/.local/share/opencorvus/projects/2026/07/30/f8b49a39-f89e-4b2f-906a-29d66282a8ba`, server `http://127.0.0.1:7878`, status `idle`, one top-level Agent card. Read-only API inspection returns Session kind `mission`, version `0.0.25-beta`, and seven persisted transcript messages. |
| Prior decisions read | `2026-07-21-chat-message-scroll-repair.md`; `2026-07-28-conversation-persistent-scrollbar.md`; `2026-07-28-conversation-fullscreen-scrollbar-repair.md`; `2026-07-28-conversation-full-height-scrollbar-composer-alignment.md`; `2026-07-30-conversation-projection-atomic-source-switch.md`; `specs/current/architecture/07-panel.md`. |
| Whole-repository grep | `rg` enumerated every `#chatScroll`, `.chat-scroll`, `.conversation-scroll-shell`, overflow declaration, scrollbar/gutter projection, Composer clearance, Mission selection/hydration, projection reset, auto-scroll controller, and `contentChanged` call. Production ownership remains singular: `App.tsx` owns the shared Chat/Mission DOM; `workspace.css` and `conversation.css` own the bounded height chain; `base.css` owns native scrollbar paint; `main.tsx` measures the platform gutter; `Conversation.tsx` and `dom-utils.ts` own input/follow behavior; `main.tsx::openMissionSession` owns Mission source transition and hydration. Existing CSS/source/browser UI tests encountered in this exact surface are obsolete under the current UI-test prohibition and must not be run. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy forbids unsolicited delegation. |
| Git baseline | Before changes, `HEAD` `eb96c556ca0f75b16cc21ee01645aa461857feb0` matched `myhexin/v0.0.26beta`; the normal pre-push hooks passed. Unrelated modified and untracked files remain preserved. |

## Proven regression chain

1. Commit `c698301674` changed `.chat-scroll` from `overflow-y: auto` to
   `overflow-y: scroll` to make the transcript's native affordance persistent.
2. Commit `3379d3f226` changed the same declaration back to `auto` to remove an
   inactive bright scrollbar in a fullscreen underflow state. It also rewrote
   the active architecture and UI-test expectations from persistent to
   conditional visibility.
3. Mission does not own a separate scroll surface. `openMissionSession` selects
   and hydrates a Mission into the same `#chatScroll` element used by Chat.
   Therefore the contract reversal is systemic and merely becomes visible on
   Mission entry.
4. `overflow-y: auto` alone cannot prove actual scroll loss: it should still
   scroll when `scrollHeight > clientHeight`. The live Mission must be measured
   before choosing between a geometry/projection correction and an affordance
   correction. Restoring forced `scroll` without that measurement would
   knowingly reintroduce the fullscreen defect.

## Call-site disposition

| Owner / consumer | Disposition |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Preserve the one focusable `#chatScroll` shared by Chat and Mission. |
| `packages/overlay/src/main.tsx::openMissionSession` | Preserve the single source-selection/hydration path unless isolated evidence proves layout synchronization is omitted after projection commit. |
| `packages/overlay/src/components/Conversation.tsx` | Preserve the existing Composer measurement, passive history-intent listeners, and auto-scroll controller unless direct event evidence proves a missing post-hydrate layout notification. |
| `packages/overlay/src/utils/dom-utils.ts` | Preserve the canonical follow-lock controller unless it overwrites operator movement in the reproduced Mission. |
| `packages/overlay/src/styles/surfaces/workspace.css` | Preserve the ancestor height chain unless computed geometry proves an unbounded or clipped owner. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Measure body, shell, scroll owner, rendered content, and Composer before changing `overflow-y` or height. Keep a single overflow owner. |
| `packages/overlay/src/styles/cascade/base.css` | Preserve one theme-owned native track/thumb source. Reconcile persistent discoverability with empty fullscreen presentation at this owner only after evidence. |
| UI automated tests encountered | Do not run or update them. Remove only task-relevant obsolete UI-test artifacts required by the repository rule, without replacing them with another automated UI assertion. |
| Specs | Reconcile the mutually contradictory persistent and conditional scrollbar records in the active architecture, recording the final evidence here. Historical records remain evidence rather than parallel current authority. |

## Execution plan

1. Start an isolated production-equivalent Overlay page against the live
   read-only API and open the supplied Mission without touching the packaged
   Overlay.
2. Record `clientHeight`, `scrollHeight`, computed overflow, scrollbar paint,
   Composer/shell geometry, hit target, and wheel/keyboard/direct-scroll
   movement; capture the initial and scrolled states.
3. Correct the single proven owner. If range is zero because the height chain
   expands, repair the broken existing height owner. If range is positive and
   input works, repair the native affordance contract without restoring bright
   empty fullscreen chrome. If post-hydrate range appears late, synchronize the
   existing controller after the atomic projection commit.
4. Build and typecheck the Overlay, then repeat the isolated real interaction
   and manually inspect task-scoped screenshots at original resolution.
5. Update this record and the active architecture with exact evidence, perform
   a second diff review, commit only task-owned files, converge with
   `myhexin/v0.0.26beta`, and push through normal hooks.

## Result

The original production server exited before interactive reproduction. It was
not restarted. Its SQLite database first passed an immutable `PRAGMA
quick_check`, then the database was copied into a temporary `OPENCORVUS_HOME`.
An isolated server on port 7879 and the real Vite Overlay opened the supplied
Mission through the visible Work Ledger UI.

The reproduced Mission disproved a layout, projection, and input-routing
failure:

- `#chatScroll` and its shell both measured 644 pixels high.
- The real seven-message Mission rendered a 1,443-pixel scroll height and a
  799-pixel native range.
- Computed `overflow-y` was `auto`; the canonical thumb and track resolved to
  non-transparent theme colors.
- Real wheel input moved `scrollTop` from 799 to 307 and changed
  `data-follow-lock` from `true` to `false`.
- The fixed Composer remained outside transcript flow and ended at the same
  720-pixel shell boundary.

Therefore Mission hydration, atomic projection, virtual rows, Composer
measurement, `setupAutoScroll`, and follow-lock are healthy and remain
unchanged. The regression is the previously proven contract reversal from
forced native scrolling to conditional `auto`, whose native WebView
presentation can remove the persistent affordance on entry. The implementation
restores `overflow-y: scroll` at the existing `.chat-scroll` owner and keeps
the existing theme-owned track/thumb paint. No Mission branch, JavaScript wheel
proxy, second scroll owner, custom scrollbar, or viewport detector is added.

The active architecture now makes Chat and Mission share this persistent
contract. The earlier fullscreen record remains historical evidence of the
conflicting requirement; current architecture resolves underflow visually with
the existing low-contrast theme paint instead of deleting the scroll
mechanism.

The task encountered three automated UI files whose purpose was to assert the
obsolete scrollbar/source/browser presentation contract:
`visible-scrollbar-whitelist.test.ts`,
`conversation-scroll-bottom-button-browser.test.ts`, and
`chat-default-assistant-browser.test.ts`. They were deleted under the current
UI-test prohibition and were not run or replaced with another automated UI
assertion.

## Verification

- The current Vite page hot-updated the supplied Mission from computed
  `overflow-y: auto` to `overflow-y: scroll` without changing its 644-pixel
  viewport, 1,443-pixel content height, or 799-pixel range.
- Real pointer-wheel interaction reached the bottom at `scrollTop=799`, then
  moved upward to `scrollTop=379`; after the scroll event settled,
  `data-follow-lock` was `false`.
- The scroll owner, shell, and Composer all retained the same 720-pixel bottom
  boundary. The native thumb remained `rgba(32, 38, 40, 0.18)` and the track
  retained the existing translucent canvas token.
- Original-resolution screenshots were manually inspected:
  `packages/overlay/.scratch/mission-entry-scroll-regression/before-auto.png`
  and
  `packages/overlay/.scratch/mission-entry-scroll-regression/after-persistent-scroll.png`.
  The repaired image shows one restrained full-height scrollbar, the Mission
  transcript at a moved position, a stationary Composer, and no duplicate
  titlebar or second scroll surface.
- `bun run typecheck` in `packages/overlay` passed.
- `bun run build:vite` in `packages/overlay` passed after transforming 7,056
  modules. Existing Radix `use client` and large-chunk notices remain warnings.
- `bun test test/script/historical-docs-links.test.ts` from
  `packages/opencorvus` passed 22 tests with 71 expectations. The root-level
  spelling first failed because the package preload is relative to
  `packages/opencorvus`; rerunning from the owning package exercised the real
  checker successfully.
- `git diff --check` passed.

## Second review

- The observed Mission already had correct geometry and real input-driven
  movement, so no hydration, virtualizer, auto-scroll, follow-lock, or Composer
  code was changed.
- The implementation changes the exact declaration that commit `3379d3f226`
  used to reverse the persistent contract. There is still one DOM owner, one
  overflow owner, one theme paint owner, and one measured gutter source.
- The current user requirement resolves the historical underflow/overflow
  conflict: persistent discoverability is product behavior; quiet fullscreen
  presentation belongs to the existing theme colors and cannot redefine
  scrolling as conditional.
