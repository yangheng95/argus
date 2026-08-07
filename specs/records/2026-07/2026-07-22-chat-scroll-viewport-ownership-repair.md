# Chat Scroll Viewport Ownership Repair

## Recall

| Item | Detail |
| --- | --- |
| User request | Chat mode frequently loses its scrollbar and cannot scroll far enough to display all messages. |
| Acceptance criteria | A populated desktop Chat keeps one visible native scrollbar, preserves a bounded `#chatScroll` viewport while virtualized content grows, exposes a positive scroll range for long transcripts, responds to real wheel and keyboard input from top to bottom, keeps the composer fixed, and shows the earliest and latest messages in task-scoped screenshots. Focused source/browser tests, typecheck/build, document health, secondary review, commit, and `legacy-remote` push must pass. |
| Hard constraints | Desktop-only scope; `#chatScroll` remains the sole transcript overflow owner and `#solidChatComposer` remains the sole composer; no fallback scroller, synthetic message, state machine, keyword workaround, iframe/query override, worktree, Bun-launched Playwright, or refresh/restart of the user's running OpenCorvus/Overlay. Preserve unrelated `.DS_Store` files. |
| Sources read | `AGENTS.md`; Browser control skill and complete selected-browser documentation; `specs/README.md`; July index; the 2026-07-17 fixed-composer record, 2026-07-19 message/composer/scrollbar alignment record, and 2026-07-21 Chat scroll investigation; `App.tsx`; `Conversation.tsx`; `conversation.css`; `workspace.css`; `base.css`; `field.css`; `main.tsx`; `dom-utils.ts`; current source/browser regressions and relevant Git history/blame. |
| Whole-repository search | `rg` enumerated every production/test reference to `chatScroll`, `.chat-scroll`, `.conversation-scroll-shell`, `conversation-body`, scrollbar declarations, overflow/height owners, `solidChatComposer`, virtualized conversation sizing, tree replacement, follow-lock, and browser scroll assertions. Production ownership is singular: `App.tsx` owns DOM order; `workspace.css` and `.chat` own the bounded ancestor chain; `conversation.css` owns the implicit Grid row, positioning shell and transcript overflow; `base.css` owns native scrollbar chrome; `Conversation.tsx` owns virtualized measurement and content-change projection; `dom-utils.ts` owns follow-lock; `main.tsx` owns measured gutter. Test consumers are the architecture, density, visible-scrollbar, autoscroll, Agent Rail, long-transcript and scroll-button suites. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy forbids unrequested delegation. |
| Git baseline | `HEAD` `d51c4f26f` matches `legacy-remote/v0.0.14beta`. The pre-change push passed repository hooks. Two unrelated untracked `.DS_Store` files are preserved. |

## Evidence and causal chain

The native scrollbar chrome is still explicitly enabled in `base.css`, and the
current production browser fixture renders a visible trailing scrollbar. The
problem is therefore not a theme selector hiding the thumb. `#chatScroll`
still declares `overflow-y: auto`, but its parent `.conversation-scroll-shell`
has only `min-height: 0`; it does not explicitly occupy or cap itself to the
Grid area supplied by `.conversation-body`.

That leaves the one critical viewport boundary dependent on the intrinsic size
of an implicit Grid `auto` row. When the virtualized window contributes a large
block size during transcript replacement or measurement, the shell can resolve
from content instead of the available viewport. The ancestor `.chat` then
clips the expanded shell. Observable result: messages exist below the clipped
panel, but `#chatScroll` has no equivalent overflow range, so both the thumb
and the ability to reach all messages disappear. The earlier seven-message
investigation disproved this geometry for one compact session, but did not
assert the shell boundary during a large virtualized transcript and therefore
did not prove the topology safe.

The initial current-browser acceptance reached the real checker and generated
the expected long-transcript screenshots, then failed during teardown because
the fixture did not answer the production `GET /file?...&path=` request. That
404 was fixture contract drift, not the Chat symptom; the fixture now answers
the production request without weakening the error collector.

The strengthened long-history path also proved a second defect in the same
surface. Agent Rail location first added the target index to Virtua's
`keepMounted` set, called `scrollToIndex`, then called DOM `scrollIntoView` on
the materialized card. The pin invalidated Virtua's layout immediately before
the index command, and the second DOM command competed with Virtua's measured
offset correction. Browser geometry showed the card mounted roughly 14,000px
above the viewport while `#chatScroll` remained at the bottom and follow-lock
re-armed. The repair removes the transient locate pin and the second DOM scroll
contract. One Virtua `scrollToIndex` command now projects through the existing
`scrollRef={#chatScroll}` owner; history-anchor pinning remains separate because
it preserves an already visible row while older records prepend.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `App.tsx` | Keep the canonical sibling DOM: one `#chatScroll` plus one composer/home layer inside `.conversation-scroll-shell`. |
| `workspace.css`, `.chat`, `.conversation-body` | Keep the existing bounded flex/Grid ancestor chain and single message panel. |
| `conversation.css` `.conversation-scroll-shell` | Make the existing positioning shell explicitly fill and cap itself to the Grid area, and use non-scrolling `overflow: clip` for overlay paint. Do not add another scroll container; `overflow: hidden` is rejected because it would intercept `scrollIntoView`. |
| `conversation.css` `.chat-scroll` | Keep `overflow-y: auto`, native stable gutter, message insets, and measured composer clearance. It remains the only scrolling element. |
| `base.css` / `main.tsx` | Keep the always-visible native scrollbar chrome and one measured trailing gutter; current inspection shows no hiding override. |
| `Conversation.tsx` | Keep Virtua as the single virtual measurement owner. Remove locate-only `keepMounted`, DOM `scrollIntoView`, and their now-dead `behavior` / `focus` request fields. Use one non-smooth `scrollToIndex` command against the existing `#chatScroll` `scrollRef`; retain the distinct history-prepend anchor pin. |
| `dom-utils.ts` | Keep the existing follow-lock controller. Real wheel/PageUp input proves it releases at the current scroll owner and re-arms only at the bottom. |
| Source tests | Add exact shell block-size/capping and single-overflow-owner assertions. Existing scrollbar, composer and architecture contracts remain authoritative. |
| Browser regression | Strengthen the production Agent Rail long-transcript fixture to assert body/shell/scroll height equality, positive overflow, visible native gutter, real wheel and keyboard traversal, fixed composer bounds, and first/latest message reachability. Answer the production file-read request with the fixture's canonical empty response. Capture top and bottom screenshots. Playwright remains Node-launched. |
| Specs/indexes | Add this record and both required index entries; run historical links and document-health checks. |

## Verification plan

1. Add failing source/browser assertions for the explicit viewport boundary and
   the fixture's currently unhandled production request.
2. Correct the existing shell owner and fixture contract without changing Chat
   data, follow-lock, scrollbar chrome or composer ownership.
3. Run focused Overlay unit tests, the exact Node browser scenario, Overlay
   typecheck/i18n/build, historical-link and document-health tests, and
   `git diff --check`.
4. Inspect task-scoped top/bottom screenshots at original resolution, perform
   a second call-site/diff review, record the exact evidence here, then commit
   with the `dsw-33987` prefix and push the current delivery branch to `legacy-remote`.

## Result

Implemented the bounded viewport and single-command virtual locate repair.
`.conversation-body` now defines an explicit `minmax(0, 1fr)` row, while the
existing positioning shell fills and caps that row with non-scrolling
`overflow: clip`. `#chatScroll` remains the sole native overflow owner. Agent
Rail and goal-location callers now share the one Virtua index-scroll contract;
unused DOM-scroll options were removed at every call site. The browser fixture
also answers `/file` and explicitly closes the hover-driven Environment panel
before task-scoped screenshots.

Verification evidence:

- Focused source regressions: 58 passed, zero failed, 425 expectations.
- Production Agent Rail browser scenario: passed under Node-launched
  Playwright after exercising a 57-turn overflow transcript, real upward wheel
  input, focused PageUp, top/mid/bottom reachability, fixed-composer clearance,
  bounded body/shell/scroll geometry, and far virtualized locate.
- Adjacent production scroll-to-bottom browser scenario: passed.
- Overlay TypeScript and panel internationalization checks: passed.
- Original-resolution 1120x760 screenshots were inspected at transcript top,
  near-bottom and bottom. Message widths and wrapping are intact, the composer
  remains fixed, the final row clears it, and no Environment popover obscures
  the evidence. The 1600px post-locate Chat/card captures were also inspected.
- Production Vite build, `docs:check` (287 operations), historical links,
  product-doc single-source, document-health (87 tests / 1,415 expectations),
  Overlay TypeScript, panel i18n and whitespace checks passed.
- The unrelated Agent Compact visual-stress fixture was probed because it
  dispatches the same event. It fails before that event on stale hydrate/file
  fixture contracts and later enters an SSE reconnect loop. Its exploratory
  edits were fully reverted; it is not presented as Chat-scroll evidence.
- During verification, concurrent delivery advanced the main worktree from the
  recorded start baseline to `v0.0.15beta` at `c935f51f9`, matching
  `legacy-remote/v0.0.15beta`. This repair is committed and pushed on that current
  single delivery branch; no stale `v0.0.14beta` push is used.

No running OpenCorvus or Overlay process was restarted, refreshed, or closed.
