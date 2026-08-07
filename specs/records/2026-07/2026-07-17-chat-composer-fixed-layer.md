# Chat Composer Fixed Layer And Transcript Clearance

## Recall

| Item | Detail |
| --- | --- |
| User requests | (1) When the conversation is scrolled to the bottom, the composer must not move upward. (2) Conversation information must never be visibly rendered below the composer. |
| Acceptance criteria | In an ordinary populated desktop Chat, the composer has identical viewport bounds at the top, middle, near-bottom, and bottom scroll positions; message content remains visually above the composer; the final message clears the composer at the bottom; composer resize/attachment growth updates the clearance from the real rendered composer size; Assistant-card/composer horizontal parity, the full-height real transcript scrollbar, scroll-to-bottom behavior, Agent Rail geometry, and empty-home composition remain intact. Focused source tests, TypeScript/build, Node-launched browser geometry, current-goal screenshot inspection, and a second diff review must pass. |
| Hard constraints | Desktop-only scope; keep `#chatScroll` as the one real transcript overflow owner and keep one real `ChatComposer`; reuse the existing Chat-local width projection, measured scrollbar gutter, auto-scroll controller, `createAnimationFrameScheduler`, `ResizeObserver`, Agent Rail grid, and shared primitives; no sticky composer, duplicate layout owner, fixed height guess, fallback/compatibility selector, query override, iframe, state machine, or interference with the user's running OpenCorvus/overlay process; Playwright runs through Node. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-b2e1105e-a2ef-4573-8e43-50762d541d09.png` shows the composer moving upward at the bottom of the scrollbar. `C:/Users/10132/AppData/Local/Temp/codex-clipboard-7bc20d12-4e05-48ff-b0c5-8905d014db2a.png` shows conversation content visibly continuing below the composer. Both images were inspected at original resolution. |
| Sources read | `AGENTS.md`; Browser control skill and complete selected-browser documentation; `specs/README.md`; `specs/records/2026-07/README.md`; the 2026-07-09 message/composer scrollbar alignment, 2026-07-16 conversation/home width alignment and composer/dialog parity, and 2026-07-17 sticky-scroll-owner records; `App.tsx`; `Conversation.tsx`; `ChatComposer.tsx`; `main.tsx`; `dom-utils.ts`; `base.css`; `workspace.css`; `conversation.css`; `composer.css`; focused source/browser tests; commit `48252c4c9`, its parent layout, blame, and current browser screenshot. |
| Whole-repository search | `rg` enumerated every `chatHomeComposition`, `solidChatComposer`, `conversation-scroll-shell`, `chatScroll`, `chat-content-frame`, `chat-composer-stack`, sticky-composer assertion, bottom-clearance assertion, message padding, measured scrollbar gutter, auto-scroll call, and selector consumer. Production ownership is: `App.tsx` for DOM order; `Conversation.tsx` for portals, auto-scroll, history and measured layout reactions; `dom-utils.ts` for scroll following; `main.tsx` for symmetric scrollbar measurement; `base.css` for content/padding/gutter/scroll-width tokens; `workspace.css` for the full-height content frame; `conversation.css` for the scroll shell, overlay layer, empty home and scroll button; `composer.css` for the rendered composer stack. Focus/navigation-only `solidChatComposer` consumers in `CommandPalette`, titlebar and browser fixtures keep the stable ID. Regression owners are `conversation-empty-state-source`, `conversation-scroll-bottom-button`, `workspace-composer-density`, `overlay-architecture-guards`, `visible-scrollbar-whitelist`, `conversation-agent-rail`, `dom-utils-autoscroll`, `conversation-agent-rail-scroll-browser`, `chat-composer-resize-browser`, `conversation-scroll-bottom-button-browser`, `command-palette`, chronological-message and expert-squad browser suites. Historical records are evidence only and are not runtime sources. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy forbids unrequested delegation. |
| Git baseline | `HEAD` `3f901bf72` matched `myhexin/work-v0.0.8beta-yr-0717`; the worktree was clean. The pre-change push completed with typecheck, route, docs, i18n and secret-scan hooks passing and reported everything up to date. |

## Causal chain

The 2026-07-17 alignment change moved `solidChatComposer` after the virtualized
conversation inside `#chatScroll` and made it `position: sticky`. That made the
scrollbar reach the panel bottom and made narrow widths resolve against the
same content box, but it also made the input part of the transcript's normal
block flow.

A bottom-sticky descendant is constrained by both the scrollport and its normal
position. As the operator reaches the end, the composer converges on that
normal position before the scroll container's bottom padding, so its viewport
coordinate changes. While it is stuck earlier in the scroll range, transcript
content continues through the same scrollport behind/below the sticky layer.
The supplied screenshots are therefore two consequences of one incorrect DOM
ownership decision, not independent spacing defects.

The existing browser regression did not prove the requested invariant. It
only asserted that the composer remained somewhere inside the scroll bounds
at `scrollTop = 0`, then asserted final-card clearance after jumping to the
bottom. It never compared composer coordinates across scroll positions and
never inspected the layer occupying the area below the visible input. That is
why the sticky regression passed despite the user-visible failure.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `App.tsx` Chat DOM | Keep one `chatHomeComposition` and one `solidChatComposer`, but make the composition a sibling immediately after `#chatScroll` inside the existing `.conversation-scroll-shell`. It must not be a descendant of the transcript overflow owner. |
| `conversation.css` `.conversation-scroll-shell` / `#solidChatComposer` | Keep the shell as the shared positioning and width owner. Replace sticky flow participation with an absolute bottom layer. Inset the composer host by the canonical transcript padding plus measured symmetric gutter so its stack continues to match Assistant-card bounds. Its canvas background owns the entire area from the stack's fade to the panel bottom, preventing visible transcript bleed-through. |
| `Conversation.tsx` composer measurement | Observe the one real composer host, schedule measurement through the existing animation-frame primitive, and project its exact block size to `#chatScroll` as one CSS custom property. This is a projection from the rendered source, not a second height model. Synchronous first measurement prevents an initial uncovered frame; observer cleanup belongs to the existing mount cleanup. |
| `conversation.css` `.chat-scroll` | Keep the existing full-height overflow owner and horizontal geometry. Replace the ordinary bottom padding with the measured composer block-size variable so the final transcript item can scroll fully above the fixed layer. No guessed composer height is introduced. |
| Empty home | Keep the existing absolute three-row composition and override the ordinary absolute composer host back to its current relative grid item. The single composer, prompt, suggestions and current wide/compact widths remain unchanged. |
| Scroll-to-bottom button | Keep its portal mounted in `solidChatComposer`; its absolute offset remains relative to the fixed composer layer and therefore tracks composer height without a second measurement. |
| Auto-scroll/history/virtualizer | Keep `setupAutoScroll`, history anchors, `Virtualizer`, card ordering and follow-lock unchanged. Their scroll owner remains `#chatScroll`; only bottom clearance changes. |
| Width/gutter sources | Keep `--conversation-message-content-width`, `--conversation-message-lane-width`, `--ui-chat-message-padding-x`, `--ui-chat-scrollbar-gutter-x`, `measureScrollbarGutter`, `composer.css`, `base.css` and `workspace.css` as the existing single sources. Consume them; do not add a parallel width constant. |
| Selector consumers | Keep the unique `solidChatComposer` ID, textarea/form selectors, command-palette focus, titlebar focus and expert-squad/mention/resize fixtures unchanged. Their semantics do not depend on the parent being `#chatScroll`. |
| Source tests | Replace sticky ownership assertions with sibling-layer, absolute-position, canonical inset, measured-clearance and empty-home isolation assertions. Keep full-height scrollbar and single-composer contracts. |
| Browser tests | At 1120x760, assert real overflow, full-height scrollbar, card/composer parity, composer coordinate equality across top/middle/near-bottom/bottom, no transcript as the top painted layer below the composer, final-item clearance, and exact padding synchronization before and after a real composer height change. Capture separate near-bottom and bottom task screenshots. Keep adjacent resize, scroll-button, command-palette, chronological-message and expert-squad scenarios. |
| Specs/indexes | Add this corrective record and update `specs/README.md` plus the July index. Preserve the earlier record as historical evidence, but explicitly supersede its sticky ownership conclusion. |

## Verification plan

1. Update focused source and real-browser assertions first; prove they fail on
   commit `3f901bf72` because the composer is sticky and its bounds change.
2. Correct DOM ownership, the fixed layer, and the one measured bottom-clearance
   projection without changing auto-scroll, message ordering or composer
   internals.
3. Run focused Overlay tests, `dom-utils` tests, TypeScript, i18n, the production
   build, historical-link and document-health checks, and `git diff --check`.
4. Run the production Overlay fixture through Node at the target desktop size,
   inspect both task screenshots at original resolution, and iterate until the
   composer is stationary and no message surface is visible beneath it.
5. Attempt the in-app browser only against isolated task evidence; do not
   refresh the user's running Overlay. Perform a second source/diff and
   screenshot review, update this record with exact evidence, commit with the
   `dsw-33987` prefix, and push the current branch to `myhexin`.

## Result

Implemented the corrected ownership model. `#chatScroll` remains the only
full-height transcript overflow owner, while the one real
`#solidChatComposer` is its absolute-positioned sibling inside
`.conversation-scroll-shell`. `Conversation.tsx` synchronously projects the
rendered composer host height into `--conversation-composer-block-size` and
keeps that projection current with `ResizeObserver` through the existing
animation-frame scheduler. The transcript uses that exact value as bottom
clearance. Composer growth also notifies the existing auto-scroll controller,
so a conversation already following the bottom remains pinned without adding
a second state model.

The 1120x760 production Overlay fixture proved real overflow, the full-height
scrollbar, Assistant-card/composer/input horizontal parity, and composer top
and bottom coordinate invariance within 0.5 px at top, middle, near-bottom and
bottom positions. The painted-layer assertion proved the area beneath the
visible input belongs to the composer layer rather than a message. A real
textarea growth changed both the rendered composer height and transcript
padding by the same amount within 1 px, kept bottom following active, and left
the final message clear of the enlarged composer before restoring the original
height. The final task screenshots were inspected at original resolution:

- `.scratch/conversation-agent-rail-scroll-browser/fixed-composer-near-bottom-1120x760.png`
- `.scratch/conversation-agent-rail-scroll-browser/fixed-composer-bottom-1120x760.png`

Both show the composer at the same panel-bottom coordinate. The near-bottom
capture shows only the intended composer fade over the incoming card; the
bottom capture shows the final card fully above the composer, with no
conversation information rendered beneath it. An earlier near-bottom capture
was taken before the render settled and showed artifacts; the fixture now
waits for animation frames before evidence capture, and the replacement image
is clean. A later original-resolution viewer invocation itself displayed a
transient black block, but a source-PNG pixel audit found zero near-black
pixels and an independent high-detail read rendered the same file cleanly;
that block was therefore a viewer artifact rather than page or PNG content.

Verification results:

- Focused Overlay source/unit suite: 187 passed, 0 failed, 8,749 assertions.
- Target Node/Playwright geometry scenario: passed in the final standalone
  run. Two validation attempts made while other suites or a rebuild were also
  consuming the host timed out at the existing 15-second board-store task
  selection wait, before any new geometry assertion ran; each immediate exact
  standalone rerun completed in about seven seconds and passed every new
  invariant. This initialization timing evidence is retained rather than
  presenting the overloaded attempts as geometry failures or hiding them.
- Adjacent composer-resize, scroll-button, command-palette,
  expert-squad-selector and chronological-message browser scenarios: all
  passed after updating the scroll-button fixture to the production sibling
  DOM contract.
- Overlay TypeScript check, production build and i18n check: passed. The build
  emitted only the existing large-chunk advisory.
- Historical-links, product-docs single-source and document-health suites: 81
  passed, 0 failed, 1,282 assertions.
- The broader focused suite exposed one stale test-only call to deleted
  `syncChatScrollbarGutter`; the assertion now matches the production
  `syncScrollbarGutters` source used by the other tests.

The in-app browser rejected opening the isolated local screenshot through a
`file:` URL under its navigation security policy. No override, iframe or user
Overlay refresh was used. Visual acceptance therefore used the real
Node-launched production Overlay page and its task-bound screenshots, followed
by original-resolution inspection. This changes only the evidence transport,
not the requested UI scope or acceptance criteria.
