# Chat Composer Opaque Layer And Alignment

> Superseded on 2026-07-17 by
> `2026-07-17-remote-work-branch-chat-parity-repair.md`. The user's explicit
> `work-v0.0.8beta-yr-0717` reference proved that the translucent composer
> handoff is intentional. The opaque-layer conclusion below is retained only as
> historical evidence of the incorrect diagnosis and was removed from runtime.

## Recall

| Item | Detail |
| --- | --- |
| User request | Repair the conversation alignment and layer regressions visible after the branch merge. |
| Acceptance criteria | In populated desktop Chat at wide and narrow widths, the single composer and Assistant card keep identical left/right bounds; at top, middle, near-bottom, and bottom transcript positions, no message colour, text, control, or border is visibly painted inside the fixed composer layer; the composer remains anchored to the panel bottom; the full-height transcript scrollbar, rendered-height bottom clearance, empty launcher layout, and resize following remain intact; focused tests, TypeScript/build, Node-launched real-page screenshots, screenshot inspection, and secondary diff review pass. |
| Hard constraints | Desktop-only scope; preserve `#chatScroll` as the one transcript overflow owner, `#solidChatComposer` as the one composer, the existing rendered-height projection, symmetric scrollbar gutter, shared conversation-width tokens, auto-scroll controller, and UI primitives; no second scroll owner, guessed height, sticky fallback, compatibility selector, iframe, query override, state machine, or interaction with the user's running OpenCorvus/Overlay; Playwright is launched with Node. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-26a8d35e-0db2-4a03-85c3-fb3e8d129837.png` shows a pale-cyan Mission card continuing visually into the fixed composer layer. `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-0c82f43b-a11b-4a62-903d-1ab5bc75ab72.png` shows the composer/card boundary and disclosure content competing in the same bottom region. Both screenshots were inspected at original resolution. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/README.md`; `specs/records/2026-07/README.md`; the 2026-07-17 scroll-owner, fixed-layer, sparse-Chat, and Tools/Reasoning alignment records; merge commits `3f901bf72` and `10f1814ce` plus both relevant parents; `App.tsx`; `Conversation.tsx`; `ChatComposer.tsx`; `Card.tsx`; `CardParts.tsx`; `conversation.css`; `composer.css`; `card.css`; `chat-bubble.css`; `messages.css`; elevation tokens; focused source/browser tests; current real-page screenshots. |
| Whole-repository search | `rg` enumerated every `chatHomeComposition`, `solidChatComposer`, `conversation-composer-block-size`, `conversation-message-content-width`, `conversation-message-lane-width`, `conversation-virtual-item`, Assistant-card background, composer-layer `z-index`, and browser geometry assertion. Production ownership is singular: `App.tsx` owns sibling DOM order; `Conversation.tsx` projects the rendered composer height; `conversation.css` owns the scroll lane, exact inline inset, bottom layer, and transcript clearance; `composer.css` owns the input stack; `chat-bubble.css` owns Assistant-card visual bounds. The direct regression owner is `conversation-agent-rail-scroll-browser.test.ts`; source contracts live in `conversation-scroll-bottom-button.test.ts`, `conversation-agent-rail.test.ts`, `conversation-empty-state-source.test.ts`, `overlay-architecture-guards.test.ts`, and `workspace-composer-density.test.ts`. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy forbids unrequested delegation. |
| Git baseline | `HEAD` `66cb87d6b` matched `legacy-remote/v0.0.8beta`. The worktree already contained unrelated frontend-replica E2E files and generated macOS artifacts; they remain outside this task. The pre-change push completed with typecheck, route, docs, i18n, panel-i18n, and secret-scan hooks passing and reported everything up to date. |

## Causal chain

The merge first moved the composer into the transcript to share width and
scrollbar ownership, then corrected it into an absolute sibling so it would
not move with transcript flow. The corrected sibling geometry is sound: the
current real page proves card/composer/input left-right parity at 1902px and
1120px, stable composer viewport coordinates, and exact rendered-height bottom
clearance.

The remaining layer regression comes from the composer's paint contract. The
absolute host uses a background that begins with `transparent` and only becomes
the Chat canvas after 16 scaled pixels. At a near-bottom or intermediate scroll
position, message cards therefore remain visibly painted through that part of
the higher composer layer. The existing browser assertion checks
`elementFromPoint(...).closest("#solidChatComposer")`; transparent elements
still participate in hit testing, so the assertion proves DOM hit ownership,
not visual occlusion. The current task-scoped near-bottom screenshot reproduces
the supplied cyan-card bleed while the test passes.

This is one paint-source defect, not a reason to add a new layout branch. The
composer host must own an opaque Chat-canvas surface for its complete measured
block. The existing bottom clearance continues to make the final item fully
reachable, while the opaque layer prevents non-final transcript positions from
visually competing with the input. Alignment remains governed by the current
canonical inset and width sources.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `App.tsx` | Keep the one composer as an absolute sibling of `#chatScroll` inside `.conversation-scroll-shell`. |
| `Conversation.tsx` | Keep the synchronous rendered composer measurement, `ResizeObserver`, animation-frame scheduler, and auto-scroll notification unchanged. |
| `conversation.css` ordinary `#solidChatComposer` | Replace the transparent-to-canvas gradient with the opaque canonical `--chat-canvas` surface across the complete measured layer. Keep absolute positioning, exact symmetric inset, bottom anchoring, and elevation token unchanged. |
| `conversation.css` empty home | Preserve the existing relative empty-launcher override and transparent centered composition; it is a distinct layout state and must not inherit ordinary transcript occlusion. |
| Card/message surfaces | Keep Assistant-card background, border, radius, disclosure renderers, chronology, and card widths unchanged. They are the content being occluded, not the layer owner. |
| Browser regression | Keep wide/narrow card/composer/input parity and all scroll/resize assertions. Replace hit-test-only evidence with a computed opaque-layer contract and screenshot visual evidence at near-bottom and bottom. The near-bottom screenshot must contain no card paint inside the composer host. |
| Source regression | Pin the ordinary composer background to the canonical opaque canvas and reject the obsolete transparent gradient while retaining the empty-home isolation contract. |
| Specs/indexes | Add this corrective record to both required indexes and retain earlier records as historical evidence. |

## Verification plan

1. Update focused source and real-browser assertions so the current transparent
   layer fails for the visual reason reported by the user.
2. Correct the single composer paint owner without changing DOM, width,
   scrolling, measurement, or card rendering.
3. Run focused Overlay tests, TypeScript, i18n, production build, historical
   links, product-doc single-source, document health, and `git diff --check`.
4. Run the production Overlay fixture through Node at 1902px and 1120px,
   inspect the current-goal near-bottom and bottom screenshots at original
   resolution, and iterate until alignment and occlusion both match the
   acceptance criteria.
5. Perform a second source/diff and screenshot review, record exact evidence,
   commit only task-owned files with the `dsw-33987` prefix, and push the
   current branch to `legacy-remote`.

## Result

Implemented the paint-source correction without changing the established
layout model. The ordinary populated-Chat `#solidChatComposer` now paints the
canonical opaque `--chat-canvas` across its complete rendered block instead of
starting with a transparent gradient. The empty launcher retains its explicit
transparent background, relative placement, and centered composition.

The browser regression now records the computed composer background at every
scroll sample. It requires no background image, requires the same non-
transparent colour as the transcript canvas, and retains the existing card /
composer / input bounds, fixed coordinates, full-height scrollbar, exact
rendered-height clearance, final-item clearance, painted-layer ownership, and
composer-resize following assertions. The source regression rejects the old
transparent fade and pins the empty-home isolation.

The final task-scoped real-page screenshots were inspected at original
resolution:

- `.scratch/conversation-agent-rail-scroll-browser/composer-message-card-1902x1110.png`
- `.scratch/conversation-agent-rail-scroll-browser/fixed-composer-near-bottom-1120x760.png`
- `.scratch/conversation-agent-rail-scroll-browser/fixed-composer-bottom-1120x760.png`
- `.scratch/short-chat-composer-bottom/sparse-populated-chat-1902x1314.png`

At 1902px and 1120px, Assistant cards, composer stack, and input shell share
their left/right bounds. The near-bottom screenshot now ends the partially
visible Requirements card cleanly at the composer-layer boundary: no tinted
card surface, border, text, or control is visible inside the layer. The bottom
screenshot shows the final card fully above the composer. The sparse Chat
keeps the composer at the panel bottom and the empty launcher composition is
unchanged.

Verification results:

- Focused fixed-composer/source suite: 153 passed, 0 failed, 8,360 assertions.
- Target Node/production-Overlay browser scenario: 1 passed, including wide
  and narrow alignment, four scroll positions, opaque-layer computed styles,
  resize following, and refreshed screenshots. One pre-build reproduction run
  timed out at the fixture's known task-selection wait before geometry ran; an
  immediate standalone rerun passed, and all post-change runs passed.
- Adjacent Node browser scenarios for sparse Assistant Chat and the floating
  scroll-to-bottom button: 2 passed, 0 failed.
- Overlay TypeScript and i18n checks passed. The production Vite build passed
  with only the existing large-chunk advisory.
- Historical-links, product-docs single-source, and document-health suites:
  81 passed, 0 failed, 1,282 assertions.
- `git diff --check` passed.

The user's running OpenCorvus/Overlay process was not restarted, refreshed, or
otherwise modified. All visual acceptance used an isolated Node-launched
production Overlay fixture, as required by the project process boundary.
