# Conversation Fullscreen Scrollbar Repair

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | In the maximized/fullscreen desktop layout, remove the unexpected scrollbar at the far right of the Conversation surface; the captured scrollbar also uses the wrong bright color. |
| Acceptance criteria | `#chatScroll` remains the sole transcript scroll owner; a transcript that fits after the window grows to fullscreen has no visible vertical scrolling mechanism; a genuinely overflowing transcript still scrolls by wheel, keyboard, and the existing bottom control and uses the canonical theme-owned thumb/track colors; the Composer keeps its measured gutter alignment; focused source tests, a Node-launched headed Overlay browser run, task-scoped screenshots, and a second visual review pass succeed. |
| Hard constraints | Desktop-only scope. Fix the existing CSS overflow owner instead of adding a fullscreen branch, viewport detector, custom scroller, second overflow source, fallback, gate, state machine, iframe, query override, or hard-coded platform color. Do not restart or otherwise interfere with the user's running OpenCorvus/Overlay. Run Playwright only through Node. Preserve unrelated worktree changes. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`; `2026-07-28-conversation-persistent-scrollbar.md`; `App.tsx`; `Conversation.tsx`; `main.tsx`; `cascade/base.css`; `surfaces/conversation.css`; the source and headed-browser scrollbar regressions; W3C CSS Overflow Module Level 3; W3C CSS Scrollbars Styling Module Level 1. |
| Whole-repository grep | `rg` enumerated every `#chatScroll`, `.chat-scroll`, `overflow-y`, scrollbar selector/token, fullscreen/maximize, viewport-size, and gutter measurement reference. Production ownership is singular: `App.tsx` owns the element; `conversation.css` owns bounded vertical overflow and stable geometry; `base.css` owns theme scrollbar paint; `main.tsx` measures the actual platform gutter; `Conversation.tsx` owns follow/scroll interactions. Direct persistence assertions are in `visible-scrollbar-whitelist.test.ts`, `conversation-scroll-bottom-button-browser.test.ts`, and `chat-default-assistant-browser.test.ts`; adjacent geometry contracts remain in the Composer, auto-scroll, window-size, and architecture suites. |
| Independent feedback | The user did not request independent agents, and the active collaboration policy forbids unsolicited delegation. The primary agent performs the required second review. |
| Baseline/version evidence | The worktree was clean on `work-v0.0.23beta-yr-0728`; `git fetch` showed zero divergence from `myhexin/work-v0.0.23beta-yr-0728`; the required pre-change push passed all normal hooks and reported everything up to date. |

## Causal chain

1. **Observable:** after maximizing the desktop window, the transcript content
   can fit vertically, yet a nearly full-height bright scrollbar remains at the
   far-right edge.
2. **Direct trigger:** `.chat-scroll` uses `overflow-y: scroll`. The W3C
   overflow contract requires a visible scrolling mechanism for `scroll`
   whether or not content overflows.
3. **Deep cause:** the preceding persistent-scrollbar change modeled
   discoverability as permanent scrollbar presence. That conflated the
   overflowing transcript state, where a position control is useful, with the
   fullscreen underflow state, where there is no scroll position to expose.
   On the Windows native WebView path the inactive mechanism can use visibly
   bright platform chrome, which is the captured color mismatch.
4. **Why changing only color is insufficient:** recoloring an inactive forced
   scrollbar would preserve a control that has no scrolling function. The
   correct single-source behavior is `overflow-y: auto`: it remains the same
   scroll container, but the user agent displays its mechanism only when
   scrollable overflow exists. The existing theme tokens continue to color
   real overflow.

W3C CSS Overflow Module Level 3 defines `scroll` as displaying a visible
scrolling mechanism even when nothing is clipped, and `auto` as displaying it
only when overflow exists. W3C CSS Scrollbars Styling Module Level 1 defines
the first `scrollbar-color` value as the thumb and the second as the track, so
the existing theme token order remains correct.

## Call-site disposition

| Owner / consumer | Disposition |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Keep the one accessible `#chatScroll` element. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Replace forced `overflow-y: scroll` with content-driven `auto`; retain bounded height, stable gutter, anchoring, and Composer clearance. |
| `packages/overlay/src/styles/cascade/base.css` | Keep scrollbar size and canonical theme paint for genuine overflow; revise the ownership comment so it no longer claims permanent geometry. |
| `packages/overlay/src/main.tsx` | Keep actual platform gutter measurement as the only alignment source. |
| `packages/overlay/src/components/Conversation.tsx` | Keep wheel, keyboard, follow-lock, history, and bottom-control behavior unchanged. |
| `packages/overlay/test/visible-scrollbar-whitelist.test.ts` | Replace the obsolete forced-scroll assertion with the conditional-overflow contract while retaining color ownership assertions. |
| `packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts` | Add fullscreen-sized underflow evidence that proves no scrollbar mechanism is reserved/painted, then retain long-transcript scrolling, token-color, bottom-control, and screenshot coverage. |
| `packages/overlay/test/browser/chat-default-assistant-browser.test.ts` | Update production Overlay computed-style acceptance from `scroll` to `auto`; preserve Composer boundary and screenshot evidence. |
| `specs/current/architecture/07-panel.md` | Replace the obsolete permanently-present scrollbar statement with conditional genuine-overflow behavior. |

## Implementation and verification plan

1. Write the underflow/fullscreen regression expectation and update the
   existing source contract.
2. Correct the one vertical overflow declaration and its active architecture
   statement without adding any fullscreen-specific branch.
3. Run focused tests, Overlay typecheck/build, and the Node-launched headed
   browser fixture; inspect both underflow and overflowing screenshots at
   original resolution and iterate on visual evidence.
4. Run documentation health, inspect the final diff, and repeat focused checks
   for the required second review.
5. Stage only task-owned files, commit with the `dsw-33987` prefix, fetch and
   converge with `myhexin`, then push the current branch through normal hooks.

## Status

- [x] Recall, evidence, causal chain, and whole-repository call-site audit recorded.
- [x] Regression expectations and implementation complete.
- [x] Focused source, type, build, and browser verification pass.
- [x] Screenshot inspection and second review pass.
- [x] Task-owned commit and `myhexin` push complete.

## Verification evidence

- `bun test packages/overlay/test/visible-scrollbar-whitelist.test.ts packages/overlay/test/conversation-scroll-bottom-button.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/dom-utils-autoscroll.test.ts packages/overlay/test/visual-browser-launch-contract.test.ts`
  passed 36 tests with 186 assertions.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay build` passed after the production Vite
  build transformed 7,056 modules.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts`
  passed in headed mode at 1280×1080. The empty fullscreen-sized transcript
  resolved `overflow-y: auto` with zero scroll range; after 38 Agent rows were
  inserted, the same element became genuinely scrollable, retained non-
  transparent canonical theme colors, preserved wheel/focus/bottom-control
  behavior, and kept the Composer outside the scroll owner.
- The task-scoped dark-theme screenshots
  `packages/overlay/.scratch/conversation-scroll-bottom-button/fullscreen-underflow-no-scrollbar.png`
  and `scrollbar-overflowing.png` were inspected at original resolution. The
  underflow image has no bright inactive scrollbar at the trailing edge; the
  overflowing image shows only the intended low-contrast theme scrollbar.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-default-assistant-browser.test.ts`
  passed against the production-built Overlay at 1902×1314. Its sparse Chat
  screenshot was inspected at original resolution and has no scrollbar in the
  non-overflowing maximized conversation while preserving the Composer
  boundary.
- The combined historical-link, product-doc single-source, and document-health
  suite passed 92 of 93 checks. Its sole failure is the tracked-file audit for
  five concurrently authored, still-untracked July records: this task's record
  before staging plus four unrelated records owned by other active work. No
  unrelated record was staged or modified to hide that evidence.
- Commit `3379d3f226` (`dsw-33987 hide inactive fullscreen conversation
  scrollbar`) is an ancestor of
  `myhexin/work-v0.0.23beta-yr-0728`. The normal pre-push hooks passed SDK
  import, Artificial Intelligence (AI) runtime, all-package typecheck, route
  inventory, generated API documentation, Overlay localization, and secret
  scan checks. A concurrent push advanced the remote during the final ref
  update, and that converged remote commit incorporated this task commit.

## Second review

- The fix changes the existing transcript owner rather than introducing
  fullscreen detection or another overflow branch. `#chatScroll` remains the
  sole scroll container and continues to use the measured platform gutter.
- `auto` removes only the inactive scrolling mechanism. Genuine overflow still
  exposes the native thumb/track with the existing theme tokens, and hover or
  keyboard focus does not switch to a second paint source.
- Source, headed fixture, production Overlay, and screenshot evidence all agree
  on the causal repair. No additional color override or viewport-specific rule
  is required.
