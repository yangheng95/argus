# Chat Message Scroll Repair

## Recall

| Item | Detail |
| --- | --- |
| User request | Fix the Chat message interface for Coding Assistant session `ses_07f5d4cadffeAfnorqA7YfBYsP`, where the user reports that the transcript cannot scroll. |
| Acceptance criteria | Reproduce the supplied seven-message / four-top-level-card session shape in the production Overlay; prove the canonical transcript has a bounded viewport, real overflow, visible scrollbar geometry on hover/focus, and responds to wheel, keyboard and direct-scroll input; inspect task-scoped screenshots before and after scrolling; keep the composer fixed; add regression coverage; pass focused tests, build/typecheck, document health, secondary review, commit and legacy remote push. |
| Hard constraints | Desktop-only scope; `#chatScroll` remains the single transcript overflow owner and `#solidChatComposer` remains the single composer; no fallback, duplicate scroll source, state machine, temporary iframe/query override, keyword workaround, worktree, Bun-launched Playwright, or refresh/restart of the user's running OpenCorvus/Overlay. Preserve unrelated dirty files in `packages/opencorvus`. |
| Supplied evidence | Chat Debug Info generated `2026-07-21 02:09:56Z`: session title `重试`, status `active`, directory `/Users/yangheng/Documents/OpenCorvus-Demos/crypto`, selected source `session:ses_07f5d4cadffeAfnorqA7YfBYsP`, four top-level cards, four total cards, two Agent cards, two Message cards and no Tool cards. Read-only server evidence shows seven persisted messages: two User turns and five Assistant turns. |
| Sources read | `AGENTS.md`; Browser control skill and complete selected-browser documentation; `specs/README.md`; July index; 2026-07-09 message/composer scrollbar record; 2026-07-17 fixed-composer, short-chat and scroll-owner records; `App.tsx`; `Conversation.tsx`; `conversation.css`; `workspace.css`; `base.css`; `field.css`; `coding-assistant.ts`; browser settings fixture; long-transcript and Agent Rail scroll browser suites; relevant Git blame/history. |
| Whole-repository search | `rg` enumerated every `chatScroll`, `.chat-scroll`, `.conversation-scroll-shell`, conversation body/workbench height owner, overflow declaration, scrollbar declaration, autoscroll/history listener, direct-scroll consumer and browser assertion. Production ownership is singular: `App.tsx` owns DOM order; `workspace.css` owns the bounded workbench chain; `conversation.css` owns the scroll shell and overflow lane; `base.css` owns scrollbar chrome; `Conversation.tsx` owns wheel/history intent and the existing auto-scroll controller; `dom-utils.ts` owns follow-lock; `main.tsx` owns measured scrollbar gutter; `coding-assistant.ts` owns session selection/hydration. Existing regression consumers are the autoscroll, overflow, architecture, composer-density, visible-scrollbar, long-transcript, chronological-message, sparse Assistant and Agent Rail browser suites. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy forbids unrequested delegation. |
| Git baseline | `HEAD` `5fe5f12eb` matches `legacy-remote/v0.0.12beta`. Four unrelated pre-existing modified files under `packages/opencorvus` are preserved and excluded from this task's commits. |

## Evidence and causal questions

The persisted-message count disproves an empty or single-message explanation. The
debug card counts also disprove a Tool-output nested scroller as the immediate
wheel owner for this report. Existing browser tests prove direct `scrollTop`
movement for large generated transcripts, but they do not yet prove real wheel
and keyboard scrolling for a compact Coding Assistant projection with the
reported two User / five Assistant message shape.

The height chain remains the first structural question. `#chatScroll` is a flex
child of `.conversation-scroll-shell`; the shell is a grid item inside the
bounded `.conversation-body`. The shell declares `min-height: 0`, but no
explicit block-size/flex growth. If its used height expands to transcript
content in the reported projection, `#chatScroll` has no overflow range even
though it declares `overflow-y: auto`; an ancestor then clips the expanded
content. This must be proved from computed geometry before changing CSS.

The second question is input routing. `Conversation.tsx` installs only passive
wheel/touch listeners for history intent and does not cancel default scrolling.
If geometry is bounded and direct scrolling works while wheel/keyboard does not,
the real event target or an overlay layer must be identified from hit-testing
and event evidence instead of modifying follow-lock or adding a handler.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `App.tsx` | Keep the canonical sibling DOM: one `#chatScroll`, then one home/composer layer inside `.conversation-scroll-shell`. |
| `workspace.css` | Keep the bounded workbench chain unless computed geometry proves an ancestor is not shrinking; modify only the actual broken height owner. |
| `conversation.css` | Measure `.conversation-body`, `.conversation-scroll-shell` and `#chatScroll`. If the shell expands beyond the body, make that existing shell explicitly fill its grid area so the existing scroll owner receives a bounded height; do not add another overflow container. |
| `base.css` | Keep the existing transcript-only visible scrollbar contract unless computed style shows it is being overridden. |
| `Conversation.tsx` / `dom-utils.ts` | Keep passive history intent and follow-lock unless input evidence proves they cancel or overwrite user scroll. No scroll interception or state machine will be added. |
| `coding-assistant.ts` / conversation hydration | Keep the single session projection unless the browser proves missing/duplicated cards are the cause of the geometry failure. |
| Browser regression | Use the production Overlay and a task-scoped fixture matching the reported Coding Assistant message/card shape. Assert bounded geometry and overflow, then exercise real wheel, PageUp/PageDown and direct scrolling, verify `scrollTop` movement and fixed-composer coordinates, and capture pre/post screenshots. Playwright runs through Node. |
| Source tests | Add the exact height/overflow ownership invariant if CSS changes. Preserve existing scrollbar, composer, autoscroll and architecture contracts. |
| Specs/indexes | Add this record and both required index entries, then run historical-link and document-health verification. |

## Verification plan

1. Commit and push this Recall/plan without staging unrelated user changes.
2. Build the current production Overlay, launch an isolated Node browser fixture
   with the reported Coding Assistant session shape, and record body/shell/scroll
   geometry, computed overflow, hit target and input-driven `scrollTop` changes.
3. Make the smallest root correction to the existing single height/scroll owner,
   update exact source and browser regressions, and rebuild.
4. Run focused Overlay tests, the real Node browser scenario, Overlay typecheck
   and build, i18n, historical-links/document-health and `git diff --check`.
5. Inspect the task-scoped pre/post screenshots at original resolution, perform
   a second source/diff review, record exact evidence here, then commit and push
   the completed change to `legacy-remote`.

## Result

The supplied session was reproduced against its real 7878 API without touching
the user's running Overlay window. Its four rendered cards produce a correctly
bounded `#chatScroll`: the content frame, message pane, conversation body,
scroll shell and scroll owner are all 824px high, while the transcript has a
1008px scroll height and a 184px native scroll range. The shell-height
hypothesis was therefore disproved and no layout or overflow owner was added.

Real Playwright mouse-wheel input at the center of the transcript moved the
reported session from `scrollTop=148` to `64`; the existing controller changed
`data-follow-lock` to `false`, so new content no longer pulls the operator back
to the bottom. Direct scrolling also reached `0`. The actual usability gaps
were native affordance and keyboard reachability: the only scrollbar was
deliberately transparent at rest, and the transcript was absent from sequential
focus order. A user without an active wheel/trackpad gesture had neither a
visible draggable thumb nor a focusable PageUp/PageDown/Home/End target.

`App.tsx` now gives the existing single `#chatScroll` owner the localized
Conversation accessible name and `tabIndex=0`. `base.css` keeps that owner's
native scrollbar thumb and track visible at rest, with the existing hover tone,
instead of maintaining a second reveal-only visual state. No wheel proxy,
scroll handler, fallback container or follow-lock change was introduced.

The isolated new production bundle was then combined with the same real 7878
session API. Computed style changed from the running instance's transparent
thumb/track to `rgba(32, 38, 40, 0.18)` over the light-theme track. Real wheel
input again moved `148 -> 64` and disabled follow-lock. After focusing the
transcript, PageUp moved it into the upper range and direct Home/top movement
reached zero. Original-resolution evidence was inspected:

- `.scratch/chat-scroll-live-diagnostic/before.png`
- `.scratch/chat-scroll-live-diagnostic/after-wheel.png`
- `.scratch/chat-scroll-live-diagnostic/after.png`

The first image shows the reported four-card Chat at its initial position. The
wheel image shows the first User turn and full first Assistant card moved into
view while the composer remains fixed. The final top image keeps the composer
at the same bottom coordinate and shows the earliest turn.

Verification results:

- Focused scrollbar, composer geometry, autoscroll and browser-sidecar suites:
  67 passed, 0 failed, 1,278 assertions. Overlay TypeScript and panel
  internationalization checks passed.
- The exact real-session isolated production run passed every geometry, wheel,
  follow-lock, focus and keyboard measurement. Its process-level browser error
  collector additionally reported an aborted paginated Mailbox request during
  teardown; the request is outside the Chat scroll path and occurred after the
  required evidence was captured, so it is recorded rather than presented as a
  clean full-app E2E result.
- The existing 240-message long-Markdown fixture was attempted twice. Both
  runs timed out at its pre-existing 20-second initial render/prewarm wait and
  then hit the existing five-second browser-close inactivity boundary, before
  any newly drafted scroll-input assertion ran. Those draft assertions were
  removed; this record does not report that unrelated fixture as passed.
- The running 7878 window still computed the old transparent scrollbar after
  source rebuild because it does not hot-reload built UI assets. It was not
  restarted or refreshed, per the explicit process boundary. The corrected
  bundle was verified through the isolated static fixture instead.
- The production Vite build passed with only its existing large-chunk advisory.
  Historical links, product-document single-source and document-health suites
  passed 87 tests with 1,409 assertions. `git diff --check` passed.
