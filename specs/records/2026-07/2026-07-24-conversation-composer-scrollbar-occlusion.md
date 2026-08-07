# Conversation Composer Scrollbar Occlusion Repair

## Recall

| Item                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request              | “滚动条不要被遮挡”。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Acceptance criteria       | In a populated desktop Chat, the native `#chatScroll` scrollbar remains visibly painted and directly hit-testable across the full transcript viewport, including beside the fixed Composer. The Composer still masks transcript content below the input across the message canvas, the input remains aligned with Assistant cards, and the measured bottom clearance remains unchanged. Focused source tests, a Node-launched headed browser run, task-scoped screenshots, original-resolution visual review, second review, commit, and `myhexin` push must pass.                                                                                                                                                                                                                                                                                  |
| Hard constraints          | Follow `AGENTS.md`; desktop-only scope; keep `#chatScroll` as the sole transcript overflow owner and `#solidChatComposer` as the sole Composer layer; reuse `--ui-chat-scrollbar-gutter-x`; no second scroller, custom scrollbar, mask/gate/fallback, hard-coded platform width, state machine, iframe, query override, worktree, Bun-launched Playwright, or interference with the user's running OpenCorvus/Overlay process. Preserve all unrelated staged and unstaged worktree changes.                                                                                                                                                                                                                                                                                                                                                         |
| Supplied evidence         | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-edd1f8a2-3f23-4e58-a287-b4f80d873786.png` shows the native trailing scrollbar ending visually at the top edge of the white fixed-Composer layer; the highlighted lower-right area is painted by the Composer instead of retaining the scrollbar lane.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sources read              | `AGENTS.md`; Browser control skill; `specs/README.md`; July index; `2026-07-19-message-composer-edge-and-scrollbar-alignment.md`; `2026-07-22-chat-scroll-viewport-ownership-repair.md`; `2026-07-22-environment-goals-density-and-chat-scrollbar.md`; `specs/current/architecture/07-panel.md`; `App.tsx`; `Conversation.tsx`; `main.tsx`; `cascade/base.css`; `surfaces/conversation.css`; Composer density, scrollbar, Agent Rail, long-transcript, and scroll-button tests; commit `434f1ee4c7`.                                                                                                                                                                                                                                                                                                                                                |
| Whole-repository grep     | `rg` enumerated every production/test reference to `chatScroll`, `.chat-scroll`, `.conversation-scroll-shell`, `solidChatComposer`, `scrollbar-gutter`, `--ui-chat-scrollbar-gutter-x`, Composer clearance, overflow ownership, scrollbar paint, and masking. Production ownership is singular: `App.tsx` owns the sibling DOM; `#chatScroll` owns overflow; `main.tsx` measures the native gutter; `cascade/base.css` owns hover/focus scrollbar paint; `conversation.css` owns the fixed Composer geometry and background; `Conversation.tsx` owns measured bottom clearance. Existing geometry consumers are `workspace-composer-density.test.ts`, `conversation-agent-rail-scroll-browser.test.ts`, `agent-card-separation-browser.test.ts`, `conversation-scroll-bottom-button-browser.test.ts`, and the architecture/visible-scrollbar tests. |
| Independent feedback      | The user did not request independent agents, and the active collaboration policy forbids unsolicited delegation. The primary agent will perform the required second review after implementation and visual evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Baseline/version evidence | `git fetch myhexin` completed; local `HEAD` and `myhexin/work-v0.0.17beta-yr-0723` are at zero divergence. The shared worktree already contains unrelated staged and unstaged Overlay/spec changes, so no pre-change commit can be created without improperly claiming them; the pushed `HEAD` is the recoverable baseline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Causal chain

1. **Observable:** the native scrollbar is visible above the fixed Composer but
   disappears beside its white lower layer.
2. **Direct trigger:** `#solidChatComposer` has the sticky-layer z-index,
   `inset-inline: 0`, and an opaque-bottom gradient. It therefore paints and
   hit-tests across the scrollbar gutter even though its input content is
   moved left by right padding.
3. **Deep cause:** commit `434f1ee4c7` correctly expanded the Composer
   background beyond the input so transcript text could not show underneath
   the lower layer, but it treated the full overflow-owner width as message
   canvas. The trailing native gutter is browser chrome owned by
   `#chatScroll`, not message canvas, and must remain outside the overlay.
4. **Why the previous path did not prevent this:** existing tests separately
   proved card/Composer alignment, full-panel scrollbar ownership, and
   Composer paint below the input. None hit-tested or visually asserted the
   scrollbar lane at a vertical coordinate inside the Composer layer, so all
   three contracts could pass while the z-stacked Composer obscured the
   control.

## Call-site disposition

| Owner / consumer                                                               | Disposition                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/App.tsx`                                      | Keep the existing sibling topology: one `#chatScroll`, then one `#solidChatComposer`.                                                                                         |
| `packages/overlay/src/main.tsx`                                                | Keep `measureScrollbarGutter("chatScroll")` as the sole platform-derived gutter source.                                                                                       |
| `packages/overlay/src/styles/cascade/base.css`                                 | Keep the existing native scrollbar size and hover/focus paint contract.                                                                                                       |
| `packages/overlay/src/styles/surfaces/conversation.css`                        | Preserve the full message-canvas mask but end the Composer mount at the measured trailing gutter; move only its right content padding back to the message inline inset.       |
| `packages/overlay/src/components/Conversation.tsx`                             | Keep measured Composer block-size projection and follow-lock behavior unchanged.                                                                                              |
| `packages/overlay/test/workspace-composer-density.test.ts`                     | Replace the obsolete full-inline Composer assertion with the scrollbar-gutter boundary contract.                                                                              |
| `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` | Add real-application hit-test and geometry proof that the lane beside the Composer belongs to `#chatScroll`, while the message canvas below the input remains Composer-owned. |
| Other scrollbar/composer tests                                                 | Preserve existing single-owner, alignment, overflow, resize, keyboard, and paint assertions; no alternate implementation is introduced.                                       |

## Verification plan

- Focused source tests for Composer geometry, architecture ownership, visible
  scrollbar paint, and document health.
- Node-launched headed
  `conversation-agent-rail-scroll-browser.test.ts` with a populated production
  Overlay fixture.
- Task-scoped screenshots with the scrollbar hovered beside the Composer,
  followed by original-resolution inspection.
- Inspect the final diff and rerun focused checks as the required second
  review.
- Stage only this task's hunks, commit with `dsw-33987`, and push the current
  branch to `myhexin`.

## Verification evidence

- `bun test packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/visible-scrollbar-whitelist.test.ts packages/overlay/test/conversation-scroll-bottom-button.test.ts`: 21 passed, 0 failed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`: passed in headed mode through Node.js after a production Vite build. At every sampled transcript position, the scrollbar lane hit-tested to `#chatScroll`, never to `#solidChatComposer`; the Composer mount ended at `scroll.right - scrollbarTotal`; card/input alignment, full-height overflow, wheel, keyboard, bottom clearance, and Composer resize assertions remained green.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed, 0 failed.
- Prettier check over the changed production, test, and record files passed.
- Task-scoped screenshot:
  `.scratch/conversation-agent-rail-scroll-browser/composer-scrollbar-visible-1120x760.png`.
  Original-resolution inspection confirms the white Composer mask stops before
  the right native scrollbar lane, which stays continuous to the bottom edge;
  no transcript card leaks under the input.
- The complete `overlay-architecture-guards.test.ts` run reached and passed the
  Chat scroll ownership assertions but retained five baseline failures. A
  direct run of the guard's own duplicate-selector counter proved
  `conversation.css` was `22` at both `HEAD` and the working file, and
  `messages.css` was `10` at both `HEAD` and the working file; this task did not
  increase either count. The remaining stale Integrity/GWG assertions also
  reference files/contracts absent at `HEAD`. These failures belong to
  unrelated concurrent architecture work and were not staged or rewritten by
  this repair.

## Second review

- Final source diff preserves the single `#chatScroll` overflow owner and the
  single measured gutter token. No second scrollbar, custom paint, width
  constant, selector alias, or fallback was introduced.
- The Composer continues to mask the full message canvas, including both sides
  of the centered input, but its border box and pointer surface now exclude
  exactly the trailing native gutter.
- The browser test closes the previous coverage hole by sampling inside the
  Composer's vertical band at the native gutter coordinate, not merely checking
  that the scroll owner reaches the panel edge.
- The supplied symptom, implementation geometry, automated hit-test evidence,
  and inspected screenshot agree. No further visual correction is required.
