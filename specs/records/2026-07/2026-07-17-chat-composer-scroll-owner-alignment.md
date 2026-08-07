# Chat Composer Scroll Owner And Narrow-Width Alignment

## Recall

| Item | Detail |
| --- | --- |
| User requests | (1) When the desktop workbench narrows, keep the bottom composer exactly aligned with the conversation cards. (2) Match Codex's layout by extending the conversation scrollbar to the bottom of the Chat panel instead of ending above the composer. |
| Acceptance criteria | In a populated desktop conversation at both wide and narrow workbench widths, the Assistant card, composer stack, and input shell share left/right bounds; `#chatScroll` remains the single real conversation scroll owner and reaches the bottom of the message panel; the composer stays available while the operator scrolls; the last conversation content is not obscured; the empty-home composition retains its single real composer and existing centered layout; focused source tests, TypeScript/build, Node-launched browser geometry, current-goal screenshots, and secondary review pass. |
| Hard constraints | Desktop-only scope; reuse the existing `#chatScroll`, `ChatComposer`, `Conversation`, virtualizer, auto-scroll controller, symmetric scrollbar gutter, Agent Rail grid, and shared UI primitives; no narrow-screen compensation branch, duplicate composer, fallback, compatibility selector, query override, iframe, state machine, or interference with the user's running OpenCorvus/overlay process; Playwright runs through Node. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-8e7d83ce-fa1c-4e81-b509-695684ab052a.png` shows the message/card lane inset from the full panel while the composer expands to the panel edges, and shows the transcript scrollbar track terminating above the composer. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/README.md`; July records for message/composer scrollbar alignment, finished-card scroll-to-bottom, conversation/composer width parity, conversation/home width alignment, and small-window refinement; `App.tsx`; `Conversation.tsx`; `ChatComposer.tsx`; `main.tsx`; `base.css`; `workspace.css`; `conversation.css`; `composer.css`; focused static and browser tests; relevant line blame and commit history. |
| Whole-repository search | `rg` enumerated every `chatHomeComposition`, `solidChatComposer`, `chat-content-frame`, `conversation-scroll-shell`, `#chatScroll`, `chat-composer-stack`, `conversation-message-content-width`, `conversation-message-lane-width`, `ui-chat-message-content-width`, `ui-chat-message-scroll-width`, message padding, and scrollbar-gutter production/test reference. Production DOM ownership is in `App.tsx`; `Conversation.tsx` owns the virtualizer, auto-scroll, history loading, and floating scroll button; `main.tsx` measures the symmetric gutter; `base.css` owns canonical content/scroll width tokens and visible scrollbar chrome; `workspace.css` owns the full-height content frame; `conversation.css` owns the scroll lane, Agent Rail grid, empty home, and scroll button; `composer.css` owns the composer stack. Regression owners are the empty-home, composer-density, Agent Rail, scroll-button, architecture, scrollbar, and `conversation-agent-rail-scroll-browser` suites. Selector-only consumers in `CommandPalette`, titlebar, and browser fixtures remain valid because element IDs do not change. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | After fetching legacy remote, `HEAD` `f4e770939` equals `legacy-remote/work-v0.0.7beta-yr-0716`; the pre-change push completed with all hooks passing and reported everything up to date. The worktree was clean. |

## Causal chain

The populated Assistant card is a child of `#chatScroll`, so its `100%` width
is resolved against the scroll container's content box after the canonical
horizontal message padding and the two reserved scrollbar gutters. The
composer is a sibling of `.chat-content-frame`, so its `100%` is resolved
against the wider `.chat` panel. The shared 1040px maximum hides that different
containing block on wide desktops; once the workbench becomes narrower than the
message scroll token, the card contracts with the scroll content box while the
composer contracts only with the panel, producing the visible mismatch.

That sibling DOM is also why the scrollbar stops above the input: only
`#chatScroll` has overflow and visible scrollbar ownership, while the composer
consumes a separate flex row below `.chat-content-frame`. A width formula would
only mask the first symptom and would leave the scroll track structurally
wrong.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `App.tsx` Chat DOM | Move the existing `chatHomeComposition` and its one `solidChatComposer` under `#chatScroll`, after the real conversation. Keep all IDs and one composer instance. |
| `conversation.css` `.chat-scroll` / ordinary composer host | Keep `#chatScroll` as the overflow owner; make the existing composer host the bottom-sticky child of that owner so the scrollbar spans the whole message panel and the composer resolves width from the same content box as cards. |
| `conversation.css` empty home | Preserve the current grid, centered width, desktop breakpoint, prompt/composer/cards ordering, and more-specific width projection while neutralizing ordinary sticky behavior in the existing empty-home selector. |
| `Conversation.tsx` scroll button | Anchor the existing button to the real composer host so it remains immediately above a dynamically resized sticky composer without introducing height measurement or a parallel scroll owner. Keep the existing auto-scroll controller and `#chatScroll` event ownership. |
| `composer.css` | Retain the canonical `min(100%, --conversation-message-content-width)` rule; after the DOM correction its `100%` has the same containing block as full-width message cards at every desktop width. |
| `main.tsx`, `base.css`, `workspace.css` | Keep gutter measurement, scrollbar visibility, canonical width tokens, and full-height frame unchanged; they already express the correct single sources. |
| Selector consumers | Keep `CommandPalette`, titlebar, mention, focus, and browser selectors unchanged because `solidChatComposer` remains unique and stable. |
| Tests | Add DOM ownership and sticky/empty-home isolation assertions; extend the real populated browser fixture to a narrow desktop width, assert card/composer parity, full-height scroll-track bounds, composer persistence while scrolled upward, last-content clearance at the bottom, and capture a task-scoped screenshot. |

## Verification plan

1. Make focused source and browser assertions fail against the current sibling layout.
2. Correct the DOM and the existing Chat layout owners without adding a second width or scroll source.
3. Run focused Overlay tests, TypeScript, production build, i18n, and required spec/document health checks.
4. Run the existing real Overlay fixture through Node, inspect the narrow populated Chat screenshot at original resolution, and iterate until geometry and presentation match the request.
5. Review the scoped diff twice, commit only task-owned files with the `dsw-33987` prefix, and leave the commit local because the user explicitly requested no push.

## Result

Implemented the single-owner layout: the existing composer composition now
follows the conversation inside `#chatScroll`; its ordinary-conversation host
is bottom-sticky and the existing empty-home selector restores relative,
transparent presentation. The floating scroll-to-bottom button is portaled to
that composer host, so it tracks resized composer height without a second
measurement source.

Verification completed on 2026-07-17:

- 70 focused Overlay source/unit assertions passed across empty-home ownership,
  composer density, scroll-button placement, Agent Rail projection, and visible
  scrollbar ownership.
- TypeScript (`tsc --noEmit`), panel i18n, and the production Vite build passed.
- The Node-launched populated-conversation browser fixture passed at the final
  retry. At 1120x760 it asserted Assistant-card/composer/input left-right parity
  within 1.5px, sticky composer ownership by `#chatScroll`, Chat/scroll bottom
  parity within 1.5px, real overflow, composer visibility while scrolled up,
  and final-item clearance above the composer. The reviewed screenshot is
  `.scratch/conversation-agent-rail-scroll-browser/composer-message-card-scroll-owner-1120x760.png`.
- Four adjacent browser scenarios passed for composer resize, command palette,
  scroll-to-bottom re-pinning, and chronological message cards. The three
  expert-squad selector scenarios also passed. The target Agent Rail fixture
  showed one pre-geometry 15-second wait timeout when co-run, then passed alone
  in 10.0 seconds; this was treated as a fixture timing retry, not as visual
  acceptance.
- Historical-link and product-doc single-source checks passed. Document health
  remains non-green in the shared dirty worktree: one unrelated MCP transport
  audit timed out, and its tracked-record check also sees the concurrent,
  untracked Tools/Reasoning record linked by another change. The Chat record is
  included in this task's local commit; no unrelated file was adopted to hide
  those failures.

Per the user's latest instruction, this delivery is committed locally and is
not pushed.
