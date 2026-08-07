# Short Chat Composer Bottom Regression

## Recall

| Item | Detail |
| --- | --- |
| User request | The conversation-page input must remain fixed at the bottom and must not float upward. |
| Acceptance criteria | In a sparse populated desktop Chat matching the supplied one-turn conversation shape, the launcher layout is inactive, the one real composer is an absolute sibling of the transcript scroll owner, the composer and transcript share the same bottom edge, and the input remains in the lower half of the message pane. The focused Node-launched browser test, source tests, typecheck/build, document-health tests, screenshot inspection, and secondary diff review must pass. |
| Hard constraints | Desktop-only scope; keep `#chatScroll` as the single transcript overflow owner and `#solidChatComposer` as the single composer; preserve the measured composer-clearance projection and the intentionally centered empty-launcher composition; no duplicate positioning path, sticky fallback, fixed height guess, state machine, temporary iframe, query override, worktree, or interaction with the user's running OpenCorvus/Overlay; Playwright uses Node. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-6fcfa047-0e59-4906-9b51-62c633378645.png` shows a sparse populated Chat whose composer is visibly around the middle of the conversation pane instead of at its bottom. The image was inspected at original resolution. |
| Sources read | `AGENTS.md`; Browser control skill and complete selected-browser documentation; `specs/README.md`; `specs/records/2026-07/README.md`; the 2026-07-17 Chat scroll-owner and fixed-layer records; `App.tsx`; `Conversation.tsx`; `main.tsx`; `conversation.css`; composer/layout source tests; `chat-default-assistant-browser.test.ts`; `conversation-agent-rail-scroll-browser.test.ts`; mailbox fixture/error collector; relevant blame and commits `56dd872c3` and `617c824f1`. |
| Whole-repository search | `rg` enumerated every `chatHomeComposition`, `solidChatComposer`, `data-empty-chat-home`, `conversation-composer-block-size`, `composerMount`, launcher-home computation, Mailbox fixture route, and short/long browser geometry consumer. Production ownership remains singular: `App.tsx` owns DOM order, `main.tsx` derives launcher-home activity, `Conversation.tsx` measures the real composer and projects transcript clearance, and `conversation.css` owns the bottom layer plus the distinct empty-home override. The long task fixture already proves scroll-position invariance; the sparse Assistant fixture is the missing user-visible regression surface and currently has stale Mailbox routes. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy forbids unrequested delegation. |
| Git baseline | `HEAD` `edc8e9897` matched `legacy-remote/work-v0.0.8beta-yr-0717`; the clean pre-change push completed with typecheck, route, docs, i18n, and secret-scan hooks passing and reported everything up to date. |

## Causal chain

The supplied screenshot is the visual symptom of launcher-style vertical
composition being visible after a Chat already contains messages. The current
production source no longer places an ordinary populated composer in that
flow: commit `56dd872c3` made the one real composer an absolute bottom layer
beside `#chatScroll`, and its rendered height is the transcript's bottom
clearance source.

A current production-bundle run of the sparse Assistant fixture renders the
composer at the pane bottom, so there is no evidence for adding another CSS
positioning branch. The remaining regression gap is concrete: that fixture
captures a screenshot after the first user message but never asserts that the
launcher attribute cleared or that the composer shares the scrollport's bottom
edge. It also now fails final browser-error review because it does not serve
the canonical Mailbox list and event-stream routes. A floating-composer
regression could therefore escape this closest-to-reference scenario even
while the fixture appears to exercise it.

The correction is to make the sparse populated Chat prove the existing
single-source fixed-layer contract and to restore its current API fixture. The
production CSS/DOM/measurement owners stay unchanged unless the new geometry
assertion produces contrary evidence.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `App.tsx` | Keep the one composer as the transcript sibling inside `.conversation-scroll-shell`. |
| `main.tsx` | Keep `launcherHomeActive()` as the single launcher-layout decision; the sparse browser test will prove it becomes false after a real message enters the card tree. |
| `Conversation.tsx` | Keep the rendered composer measurement and `--conversation-composer-block-size` projection unchanged. |
| `conversation.css` | Keep the ordinary absolute bottom layer and the separate relative empty-home override unchanged unless real-page evidence disproves the current contract. |
| `chat-default-assistant-browser.test.ts` | Reuse the canonical empty-Mailbox fixture routes, then assert sparse populated-Chat launcher state, DOM ownership, absolute positioning, shared bottom edge, measured transcript clearance, and lower-pane placement before taking its task screenshot. |
| `conversation-agent-rail-scroll-browser.test.ts` | Keep the existing long-conversation top/middle/near-bottom/bottom invariance coverage as the complementary scroll case. |
| Spec indexes | Add this regression record to both required indexes. |

## Verification plan

1. Commit and push this Recall/plan before implementation.
2. Update the sparse Assistant browser fixture and prove its Node-launched
   real-page geometry plus browser-error review passes.
3. Run the focused source tests, the existing long-conversation fixed-composer
   browser case, Overlay typecheck/build, i18n, historical-links and document
   health checks, and `git diff --check`.
4. Inspect the current-goal sparse-chat and long-chat screenshots at original
   resolution, perform a second source/diff review, record exact results here,
   then commit and push the completed work to `legacy-remote`.

## Result

The current production ownership was confirmed rather than duplicated.
`#solidChatComposer` already uses the fixed-layer correction from commit
`56dd872c3`: it is an absolute sibling of the single `#chatScroll` overflow
owner, and the transcript consumes the rendered composer height as bottom
clearance. The supplied floating layout therefore does not justify another
positioning path in current source.

`chat-default-assistant-browser.test.ts` now covers the sparse populated Chat
that most closely matches the supplied screenshot. After submitting the first
real Assistant-session message, it requires the launcher-home attribute to be
false, the composer to be absolutely owned by the conversation shell rather
than transcript flow, the composer and scrollport bottom edges to differ by no
more than one pixel, the measured transcript padding to match the rendered
composer height within one pixel, and the composer to remain in the lower half
of the pane. The same fixture now serves the canonical empty Mailbox list and
event stream, eliminating the real 404/error-stream failures that previously
made its final browser-error review fail.

The final current-goal screenshot is
`.scratch/short-chat-composer-bottom/sparse-populated-chat-1902x1314.png`.
Original-resolution inspection and a separate in-app Browser inspection both
show the sparse Chat input at the bottom of the message pane, with the message
area above it and no launcher-centering geometry. One original-resolution
viewer invocation briefly displayed black blocks; the source PNG contained
zero near-black pixels, and both a high-detail render and the Browser render
showed the clean image, proving that display was a viewer artifact rather than
page content.

Verification results:

- The focused sparse-Chat Node browser test passed after rebuilding the current
  production Overlay bundle: 1 passed, 0 failed. Browser console/network error
  review was clean.
- Focused fixed-composer/source coverage passed: 163 passed, 0 failed, 8,561
  assertions.
- Historical-links, product-docs single-source, and document-health coverage
  passed: 81 passed, 0 failed, 1,282 assertions.
- Overlay TypeScript checking passed independently and again in the legacy remote
  pre-push hook. The production Vite build passed with only the existing
  large-chunk advisory.
- The legacy remote pre-push hook also passed the full workspace typecheck, route
  inventory, API documentation, Overlay i18n, panel i18n, and secret scan.

The adjacent long-conversation Agent Rail browser scenario was also attempted
as secondary evidence, but several runs timed out during task selection or
before the Agent Rail locate buttons materialized, before any fixed-composer
geometry assertion executed. During those runs the shared worktree was being
actively changed by a separate Icon primitive refactor and repeatedly rebuilt;
the focused sparse-Chat geometry test, source suite, typecheck, build, and
current-goal visual evidence all passed against that evolving source. This
record does not present the incomplete Agent Rail run as a pass and does not
attribute its initialization timeout to composer behavior. The earlier
fixed-layer record retains its completed top/middle/near-bottom/bottom scroll
evidence; the present delivery relies on the new exact sparse-Chat regression
for the user's reported surface.
