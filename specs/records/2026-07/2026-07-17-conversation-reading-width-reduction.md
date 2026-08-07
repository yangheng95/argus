# Conversation Reading-Width Reduction

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Shorten the centered input box and message cards by one third because the current wide lane is difficult to read. |
| Acceptance criteria | Reduce the current 1280px populated-conversation cap to approximately two thirds (853px); keep Assistant cards, the real composer, and input shell on identical left/right bounds and the same center axis; retain narrow-desktop containment and deterministic scrollbar compensation; pass source, build, real browser geometry, and screenshot review. |
| Hard constraints | Preserve `--ui-chat-message-content-width` as the sole width source, `.chat` as the projection owner, and the existing composer/card primitives. Do not add a second width, viewport override, percentage fallback, alternate composer, responsive deliverable, or running-process restart/refresh. Playwright remains Node-launched. |
| Sources read | `AGENTS.md`; Browser skill; the July 16 conversation/home alignment and composer parity records; the July 17 scrollbar/Agent Rail and conversation-density records; `base.css`; `conversation.css`; `composer.css`; focused source and browser geometry tests. |
| Whole-repository search | `base.css` has the only production literal owner of `--ui-chat-message-content-width`; `.chat` projects it into `--conversation-message-content-width`; both populated message cards and `.chat-composer-stack` consume that projection. Empty-home composition has its own existing 900px semantic cap and is outside the user's populated middle-lane request. Regression owners are `workspace-composer-density.test.ts`, `conversation-agent-rail-scroll-browser.test.ts`, `conversation-agent-rail.test.ts`, and `overlay-architecture-guards.test.ts`. |
| Independent agent feedback | No sub-agent was started because the user did not request delegation and current collaboration policy forbids unrequested sub-agents. |

## Plan

1. Change only the canonical populated-message token from 1280px to 853px, the nearest whole-pixel two-thirds value.
2. Pin the retired value's absence and the new single-source value in the focused source contract.
3. Extend the large-desktop browser geometry check to prove the rendered card width equals `853px × --ui-scale`, while retaining exact composer/card/input alignment assertions.
4. Build and run the real Node-launched browser fixture, inspect the refreshed 1902×1110 screenshot, run document health, commit with `dsw-33987`, merge current `legacy-remote`, and push.

## Validation note

The primary production fixture passed immediately, but the secondary light/dark Agent-card fixture exposed a stale local `--conversation-message-lane-width` override that omitted the canonical doubled scrollbar-gutter term. Removing that override then proved the auto-height fixture has no real scrollbar while still inheriting the nonzero default gutter token, making its card 12px wider. The fixture now inherits the production `.chat` projection and explicitly projects its measured zero-gutter condition; no tolerance was widened and no product fallback was added.

That same fixture then exposed an unrelated stale hover assertion. The button primitive deliberately keeps text-disclosure backgrounds transparent and changes only text colour on hover, while the test waited for a background change that can never occur. The browser contract now checks the documented colour transition and passes without changing product styling.

## Result

- The populated conversation cap is `853px`, which is the nearest whole-pixel value to `1280 × 2/3`.
- The production 1902×1110 browser fixture proves the rendered card is `853px × --ui-scale` and remains exactly aligned with the composer and input shell.
- The independent light and dark Agent-card screenshots show identical left/right bounds for the card and composer after zero-gutter fixture projection.
- Focused source tests, architecture guards, typecheck, internationalisation validation, production build, both Node-launched browser suites, documentation health, and diff hygiene are required to pass before delivery.
