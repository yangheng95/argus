# Conversation Persistent Scrollbar

## Recall

| Item                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement          | Make the message panel scrollbar permanently visible because the conversation frequently appears to lose scrolling ability.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Acceptance criteria       | `#chatScroll` remains the only transcript scroll owner; its vertical scrolling mechanism is reserved continuously; the canonical track and thumb colors are painted at rest, hover, and keyboard focus; the thumb hover color remains distinct; long transcripts still scroll by wheel, keyboard, and the existing bottom control; the fixed Composer continues to exclude the measured scrollbar gutter; focused tests, a Node-launched real Overlay browser run, task-scoped screenshot inspection, and second review pass.                                                                                                                                                         |
| Hard constraints          | Desktop-only scope. Reuse the native scrollbar, `--session-scrollbar-size`, theme colors, measured `--ui-chat-scrollbar-gutter-x`, existing auto-scroll controller, and current browser fixture. Do not add a custom scroller, duplicate overflow owner, hover/focus visibility branch, hard-coded platform width, fallback, gate, state machine, iframe, query override, worktree, Bun-launched Playwright, or interaction with the user's running OpenCorvus/Overlay process. Preserve unrelated worktree changes.                                                                                                                                                                  |
| Sources read              | `AGENTS.md`; Browser control skill; W3C CSS Overflow Module Level 3; W3C CSS Scrollbars Styling Module Level 1; `specs/current/architecture/07-panel.md`; `2026-07-21-chat-message-scroll-repair.md`; `2026-07-22-environment-goals-density-and-chat-scrollbar.md`; `2026-07-24-conversation-composer-scrollbar-occlusion.md`; `App.tsx`; `Conversation.tsx`; `main.tsx`; `cascade/base.css`; `surfaces/conversation.css`; source and browser scrollbar regressions.                                                                                                                                                                                                                  |
| Whole-repository grep     | `rg` enumerated all `chatScroll`, `.chat-scroll`, `#chatScroll`, `scrollbar-gutter`, and `--ui-chat-scrollbar-gutter-x` references. Production ownership is singular: `App.tsx` owns the element; `conversation.css` owns bounded overflow geometry; `base.css` owns scrollbar chrome; `main.tsx` measures its native gutter; `Conversation.tsx` owns transcript scrolling and follow behavior. Direct visibility assertions are confined to `visible-scrollbar-whitelist.test.ts` and `conversation-scroll-bottom-button-browser.test.ts`; geometry and interaction remain covered by the Agent Rail scroll, Composer density, architecture, autoscroll, and long-transcript suites. |
| Independent feedback      | The user did not request independent agents, and the active collaboration policy forbids unsolicited delegation. The primary agent will perform the required second review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Baseline/version evidence | The worktree was clean. `git fetch myhexin v0.0.21beta` showed zero divergence between local and remote, and the pre-change `git push myhexin HEAD:v0.0.21beta` completed through normal hooks with everything up to date.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Causal chain

1. **Observable:** the message panel has overflow, but its scrollbar disappears
   whenever the pointer leaves the transcript and no descendant retains focus.
2. **Direct trigger:** `base.css` explicitly paints both the native scrollbar
   track and thumb transparent at rest. The canonical colors exist only in
   `:hover` and `:focus-within` selector branches.
3. **Deep cause:** a prior density change optimized for quiet chrome and treated
   scrollbar visibility as decoration. In this primary transcript, however,
   the scrollbar is also the persistent affordance that communicates scroll
   position and provides a draggable control.
4. **Why the current path is insufficient:** `scrollbar-gutter: stable` reserves
   layout space but does not paint the control, while `overflow-y: auto` permits
   the scrolling mechanism itself to appear only after overflow is detected.
   Neither contract satisfies a permanently available message-panel control.

The CSS Overflow specification defines `scroll` as retaining the scrolling
mechanism whether or not content currently overflows, specifically to avoid
appearance/disappearance in dynamic content. The CSS Scrollbars specification
defines the two `scrollbar-color` values as thumb and track, so the canonical
theme colors belong on the base `#chatScroll` rule rather than interaction-only
selectors.

## Call-site disposition

| Owner / consumer                                                                  | Disposition                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/App.tsx`                                         | Keep one `#chatScroll` and its existing accessibility/focus surface.                                                                                                                           |
| `packages/overlay/src/styles/surfaces/conversation.css`                           | Change the existing owner from conditional vertical overflow to a continuously reserved native vertical scrolling mechanism; retain stable gutter, sizing, and Composer clearance.             |
| `packages/overlay/src/styles/cascade/base.css`                                    | Paint the canonical track and thumb in the base rules; remove hover/focus reveal branches; retain only the thumb-hover emphasis.                                                               |
| `packages/overlay/src/main.tsx`                                                   | Keep runtime measurement as the sole platform gutter source.                                                                                                                                   |
| `packages/overlay/src/components/Conversation.tsx`                                | Keep wheel, keyboard, history, follow-lock, and bottom-control behavior unchanged.                                                                                                             |
| `packages/overlay/test/visible-scrollbar-whitelist.test.ts`                       | Replace the obsolete reveal-state contract with permanent base-paint and no-visibility-branch assertions.                                                                                      |
| `packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts` | Prove in a Node-launched headed fixture that the long transcript has the same non-transparent native colors at rest, hover, and focus; preserve scrolling and task-scoped screenshot coverage. |
| `packages/overlay/test/browser/chat-default-assistant-browser.test.ts`            | Prove the production Vite-built Overlay keeps the permanent native colors and vertical overflow contract in the real Chat/Composer surface; capture the task-scoped result in headed mode.     |
| `specs/current/architecture/07-panel.md`                                          | Update the active architecture from hover/focus-only paint to the permanent native scrollbar contract.                                                                                         |
| Other transcript tests                                                            | Preserve existing single-owner, geometry, Composer gutter, auto-follow, and input behavior without introducing a second path.                                                                  |

## Implementation and verification plan

1. Add the focused source and real-browser regression expectations.
2. Replace the hover/focus-only presentation at the existing CSS owners.
3. Run focused tests, Overlay typecheck/build, and the Node-launched real
   Overlay browser fixture; inspect the task-scoped screenshot at original
   resolution and iterate if needed.
4. Run documentation health, inspect the final diff, and repeat the focused
   checks as the required second review.
5. Stage only task-owned files, commit with the `dsw-33987` prefix, fetch and
   converge with `myhexin`, then push the current `v0.0.21beta` branch.

## Status

- [x] Recall, evidence, root cause, and whole-repository call-site audit recorded.
- [x] Regression expectations and implementation complete.
- [x] Focused source, type, build, and browser verification pass.
- [x] Screenshot inspection and second review pass.
- [x] Task-owned commit and `myhexin` push complete.

## Verification evidence

- `bun test packages/overlay/test/visible-scrollbar-whitelist.test.ts packages/overlay/test/conversation-scroll-bottom-button.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/dom-utils-autoscroll.test.ts packages/overlay/test/visual-browser-launch-contract.test.ts`
  passed 36 tests with 185 assertions.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay build` passed after a production Vite build
  transformed 7,053 modules.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-scroll-bottom-button-browser.test.ts`
  passed in headed mode. Before any transcript hover or focus,
  `overflow-y` resolved to `scroll`, the native track and thumb were
  non-transparent, hover and focus retained the same base paint, wheel
  scrolling remained available, and the existing bottom control re-pinned the
  transcript.
- The task-scoped headed screenshot
  `packages/overlay/.scratch/conversation-scroll-bottom-button/scrollbar-persistent.png`
  was inspected at original resolution and again through the in-app Browser.
  The thumb is continuously visible at the message panel's trailing edge and
  remains outside the fixed Composer layer.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-default-assistant-browser.test.ts`
  passed against the production Vite-built Overlay in headed mode. The real
  Chat/Composer surface resolved the same permanent native scrollbar contract,
  and its task-scoped screenshot was inspected at original resolution.
- The documentation suite passed 92 of 93 checks. Its only failure reported two
  July index targets as untracked: this task's new record, which becomes tracked
  in the delivery commit, and the unrelated concurrent
  `2026-07-28-package-tool-artifact-publication-repair.md`. No concurrent file
  was staged or edited to mask that evidence.
- The task-owned diff was committed with subject
  `dsw-33987 keep conversation scrollbar persistent` and pushed to
  `myhexin/v0.0.21beta` through the normal hooks.

## Second review

- The implementation keeps `#chatScroll` as the sole transcript overflow
  owner. It changes only that owner's vertical mechanism from conditional
  `auto` to persistent `scroll`; there is no nested or custom scroller.
- Resting native paint uses the existing theme-owned thumb and track tokens.
  The retired hover/focus visibility selectors are deleted, so pointer and
  focus state cannot make the control disappear. The existing thumb-hover
  emphasis remains.
- Runtime gutter measurement, message/card alignment, fixed Composer exclusion,
  bottom clearance, follow-lock, wheel input, keyboard input, and the
  scroll-to-bottom control remain on their existing single sources.
- Both the overflow screenshot and the production Overlay screenshot agree
  with the computed-style and interaction assertions. No further visual
  correction is required.
