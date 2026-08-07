# Tools/Reasoning Inline Text Flow

## Recall

| Item | Detail |
| --- | --- |
| User requirements | In the supplied Mission screenshot, Tools/Reasoning must stop gaining a coloured or framed hover surface. Hover feedback should be only a slight text-colour change, with dark mode becoming only a little brighter. Tools/Reasoning must no longer read as separate blocks: their line-height and spacing should follow ordinary message text, and the rendered transcript should look like one continuous textual flow. |
| Acceptance criteria | Resting, hovered, focused, collapsed, and expanded Tools/Reasoning rows remain semantically operable disclosures; no Tools/Reasoning wrapper, standalone Reasoning expansion, or nested Tool header paints a background/border panel; pointer hover changes only from the muted text token to the adjacent soft text token; reasoning prose uses the same message font size and line-height as narrative prose; the aggregate execution run contributes no card padding/radius/colour; disclosure-to-content and execution-to-narrative geometry follows the existing text rhythm; light/dark desktop screenshots are personally inspected. |
| Hard constraints | Preserve `CardParts` as the only chronological execution/disclosure owner, `ReasoningPart` as the only reasoning renderer, and `Card`/`CardHeader` as the only Tool renderer. Keep keyboard focus visibility and disclosure behaviour. Use existing theme and spacing tokens; add no fallback renderer, duplicate source, gate, mobile scope, worktree, or interaction with the user's running OpenCorvus/Overlay. Start Playwright through Node. Preserve and do not stage the concurrent Work Ledger changes already present in the worktree. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-a1dbe8ff-d501-4ca4-ad15-d46a6ae9dd91.png`, personally inspected. The highlighted expanded Reasoning row has a rounded gray hover/background panel; the aggregate execution surface is visually boxed and its vertical rhythm separates it from the following narrative. |
| Sources read | `AGENTS.md`; Browser skill; `specs/README.md`; `specs/current/architecture/12-overlay-card-system.md`; the 2026-07-17 Tools/Reasoning density/card-tone record; `CardParts.tsx`, `ReasoningPart.tsx`, `Card.tsx`, `CardHeader.tsx`; `messages.css`, `chat-bubble.css`, `card.css`, `markdown.css`, Button and typography tokens; focused source and Node/Playwright browser tests. |
| Whole-repository search evidence | `rg` enumerated every `ReasoningPart`, `reasoning-toggle`, `msg-reasoning`, `msg-work-details*`, nested Tool `card__head`, message typography, and direct source/browser assertion. Production ownership is singular: `CardParts.tsx` owns aggregate Tools/Reasoning disclosure, `ReasoningPart.tsx` owns reasoning, `CardHeader.tsx` owns Tool headings, `messages.css` owns their transcript-specific appearance, and `chat-bubble.css` owns narrative line-height and body-child gap. Direct regression consumers are `message-embed.test.ts`, `reasoning-part.test.ts`, `message-part-chronology-browser.test.ts`, `chat-bubble-disclosure-button-browser.test.ts`, and the focused reasoning-toggle browser fixture. |
| Independent agent feedback | None. The user did not request delegation, so no sub-agent was started. |

## Evidence and cause chain

The highlighted result is produced by three independent visual-card signals. The
aggregate `.msg-work-details[data-expanded="true"]` paints a card-derived
background and padding; standalone expanded `.msg-reasoning` paints another
rounded background and border; and both the disclosure Buttons and nested Tool
headers paint hover washes. Those declarations make the same chronological
message parts look like nested cards even though the component tree already
keeps a single transcript owner.

The vertical separation is also cumulative. The message body uses a 10px flex
gap, the disclosure Button has a fixed 20/22px control height and horizontal
padding, the aggregate body indents events as a separate list, and reasoning
uses 14px/1.55 while ordinary Agent narrative uses 15px/1.6. The repair is a
presentation convergence, not a new renderer: keep the semantic wrappers and
their state ownership, but make the wrappers transparent and make their
typography/flow consume the same existing message-text contract.

## Call-site decisions

| Surface / call site | Decision |
| --- | --- |
| `CardParts.tsx` aggregate execution disclosure | Preserve chronology, labels, persisted expansion, keyboard semantics, and one Tool/Reasoning renderer. No markup/state fork. |
| `ReasoningPart.tsx` | Preserve self/parent disclosure ownership and streaming Markdown. No reasoning-only rendering path. |
| `messages.css` `.msg-work-details*` | Remove expanded surface colour, radius transition, padding, list indentation, and event padding. Make the toggle an inline text-height row with zero horizontal padding. Rest at `--text-muted`; hover/focus at `--text-soft`; keep focus ring. |
| `messages.css` `.msg-reasoning*` | Remove standalone expanded panel styling. Inherit narrative typography. Make the toggle use the same inline disclosure recipe and text-only hover feedback. |
| `messages.css` nested Tool card | Keep the Tool renderer transparent, reduce its header to text-flow geometry, and replace hover/focus wash with the same muted-to-soft text transition. Preserve expanded output structure. |
| `chat-bubble.css` body flow | When an Agent transcript contains aggregate execution disclosure, remove the generic 10px child-card gap so the existing Markdown paragraph rhythm controls execution-to-narrative spacing. Give reasoning prose the same 15px/1.6 Agent message typography. |
| `message-embed.test.ts`, `reasoning-part.test.ts` | Replace the rejected expanded-surface and hover-wash assertions with transparent, text-token, inherited-typography, zero-extra-spacing contracts while retaining single-renderer assertions. |
| `message-part-chronology-browser.test.ts` | Replace colour-panel measurements with transparent surfaces, equal narrative/reasoning font and line-height, text-only hover deltas, focus visibility, compact flow geometry, chronology, and screenshot checks. |
| `chat-bubble-disclosure-button-browser.test.ts`, reasoning toggle fixture | Update full conversation and standalone disclosure coverage to assert no background/border panel in rest/hover/expanded states and inspect light/dark screenshots. |

## Implementation plan

1. Flatten Tools/Reasoning and nested Tool presentation to transparent text flow while preserving semantic disclosure ownership and keyboard focus.
2. Align reasoning prose and disclosure geometry to the existing Agent narrative typography and spacing tokens.
3. Replace focused source and Node/Playwright browser expectations with the new no-panel, text-only-hover contract.
4. Run focused tests, Overlay typecheck/i18n, Node-started browser fixtures, inspect current-task desktop screenshots in light/dark themes, iterate, run document health and a second diff review, then commit and push only this task's files to `myhexin`.

## Verification

- Implemented the transparent text-flow contract in the existing transcript owners. Aggregate Tools/Reasoning, standalone Reasoning, and nested Tool headings retain their semantic disclosures but no longer paint a hover or expanded card surface.
- Narrative and reasoning now share the same body font size and line-height. Aggregate wrappers contribute no padding, radius, background, border, or list indentation, so ordinary paragraph rhythm controls the flow.
- Focused source tests passed with 22 tests and 294 assertions across the Button primitive, message embed, reasoning renderer, overflow, and typography contracts.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/reasoning-toggle-button-browser.test.ts` passed for the standalone light/dark rest, hover, focus, and expanded states. Computed styles prove the background remains transparent while the text moves from the muted token to the adjacent soft token.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts` passed, preserving downward expansion and chronological message order.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts` passed after a production Vite build. Original-resolution review of `.scratch/overlay-codex-tool-reasoning-expanded.png` and `.scratch/overlay-transcript-dark-expanded.png` confirms that Tools, Reasoning, reasoning prose, Tool headers, and Tool output read as one transparent text flow in both themes. Original-resolution rest/hover review also confirms the dark hover changes only the text colour.
- Overlay typecheck and internationalization passed; all 81 documentation-health tests passed. The running OpenCorvus/Overlay process was not restarted, refreshed, or otherwise modified during verification.
