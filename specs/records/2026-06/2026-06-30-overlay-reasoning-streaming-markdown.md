# Overlay Reasoning Streaming Markdown

Date: 2026-06-30
Status: verified

## Task

Make overlay thinking / reasoning blocks render Markdown without reintroducing
streaming jank.

## Recall

| Source | Evidence carried forward |
| --- | --- |
| User request | "overlay的思考block为什么不能渲染markdown？" followed by "如何体面？" and "做"; acceptance is reasoning blocks should render Markdown in the overlay in a maintainable way. |
| `AGENTS.md` | No fallback or gate logic; inspect landed plans before edits; every code change needs tests; do not restart or refresh the user's running overlay process without explicit approval. |
| `specs/current/architecture/12-overlay-card-system.md` | Store-backed cards render through `Card.tsx`, `CardParts.tsx`, and typed payload fields; do not create a second card model. |
| `specs/records/2026-06/2026-06-19-markdown-syntax-theme-contrast.md` | `renderMarkdown()` is the central Markdown renderer for cards, dialogs, prompts, reasoning, and message text. |
| `specs/records/2026-06/2026-06-19-reasoning-toggle-button-primitive.md` | `ReasoningPart` is in the streaming transcript path; streaming text must not reparse Markdown while running. |
| `specs/records/2026-06/2026-06-28-overlay-stream-jank-benchmark.md` | Streaming text and reasoning must avoid full Markdown parsing on every delta; conversation remains the streamed text owner. |
| Current code | `ReasoningPart.tsx` renders Markdown only when `props.streaming` is false; while streaming it renders the whole reasoning text as a raw bounded tail. |
| Whole-repository grep | `rg -n "ReasoningPart|createStreamingTextPartModel|visibleStreamingText|reasoning-text--streaming|renderMarkdown|reasoning" packages/overlay/src/components packages/overlay/test specs/current/architecture specs/records/2026-06` showed reasoning parts enter through `CardParts.tsx`, text already uses `createStreamingTextPartModel`, and no other reasoning renderer owns this UI. |
| Independent agent feedback | Not collected: the current turn did not explicitly authorize delegated agents, and the available multi-agent tool policy forbids spawning agents solely for plan compliance. |

## Call Point Inventory

| Surface | Current behavior | Decision |
| --- | --- | --- |
| `packages/overlay/src/components/CardParts.tsx` | Routes `type === "reasoning"` to `ReasoningPart` and `type === "text"` to `TextPart`. | Keep routing; repair the shared rendering primitive under the two part components. |
| `packages/overlay/src/components/TextPart.tsx` | Owns the incremental block scanner via `createStreamingTextPartModel(props, renderMarkdown)`. | Extract a reusable `StreamingMarkdownPart` from this component. |
| `packages/overlay/src/components/ReasoningPart.tsx` | Uses full `renderMarkdown(text())` only after the parent card stops running; during streaming, renders raw `visibleStreamingText(text())`. | Replace the whole-streaming raw branch with the same frozen-block + active-tail Markdown model used by text. |
| `packages/overlay/src/components/text-part-model.ts` | Splits stable blocks and keeps the last streaming block raw; bounds long active text. | Reuse unchanged as the single streaming Markdown model. |
| `packages/overlay/src/styles/surfaces/markdown.css` | `.md-active-text` and `.reasoning-text--streaming` already define raw-tail wrapping. | Preserve `reasoning-text--streaming` on the active tail. |
| `packages/overlay/test/reasoning-part.test.ts` | Pins the old raw streaming branch. | Update to require `StreamingMarkdownPart` and reject direct `visibleStreamingText` ownership in `ReasoningPart`. |
| `packages/overlay/test/streaming-text-render.test.ts` | Covers text streaming model. | Add a static guard proving `TextPart` and `ReasoningPart` share the streaming Markdown primitive. |

## Root Cause

The overlay already has a correct streaming Markdown model for normal text:
completed blocks are rendered once through `renderMarkdown()`, while the active
tail remains raw text until it stabilizes or the card finishes. Reasoning
diverged from that model and treated any running parent card as a reason to
render the entire reasoning body as raw text. That avoided per-delta Markdown
parsing, but it also suppressed Markdown for stable reasoning blocks.

## Fix Plan

1. Extract `StreamingMarkdownPart` from `TextPart.tsx`.
2. Keep `TextPart` as a thin wrapper over the shared primitive.
3. Make `ReasoningPart` render `StreamingMarkdownPart` inside the existing
   `.reasoning-text.md-content` container, preserving the active-tail
   `reasoning-text--streaming` class.
4. Update focused tests to reject the old full raw streaming branch and prove
   both text and reasoning use the same primitive.
5. Run focused overlay tests, overlay typecheck, document health/link tests for
   the new spec record, and a browser visual check without restarting the
   user's running overlay process.

## Acceptance

- Reasoning stable blocks render Markdown while the parent card is still
  running.
- Reasoning active tail remains raw text and bounded; no per-delta full
  Markdown parse is introduced.
- `ReasoningPart` does not create a second Markdown renderer or a reasoning-only
  parsing path.
- Existing collapse toggle and `.reasoning-text` hiding behavior remain intact.
- Focused tests and visual QA pass.

## Implementation

- Added `StreamingMarkdownPart` as the shared streaming Markdown renderer in
  `TextPart.tsx`.
- Changed `TextPart` to delegate to `StreamingMarkdownPart`.
- Changed `ReasoningPart` to render `StreamingMarkdownPart` with the existing
  `.reasoning-text.md-content` surface and a raw active-tail class of
  `.md-active-text.reasoning-text--streaming`.
- Changed `.reasoning-text` to `white-space: normal` so nested Markdown blocks
  do not preserve component/DOM whitespace as visual gaps. The active tail still
  uses `.reasoning-text--streaming` from `markdown.css` for `pre-wrap`.
- Added browser visual coverage for stable reasoning Markdown blocks and raw
  active tail rendering.

## Verification

- PASS: `bun test packages/overlay/test/reasoning-part.test.ts packages/overlay/test/streaming-text-render.test.ts packages/overlay/test/message-overflow.test.ts --timeout 60000`
- PASS: `bun run --cwd packages/overlay typecheck`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/reasoning-markdown-browser.test.ts`
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000`

## Visual QA

- Reviewed `.scratch/reasoning-markdown-streaming.png`.
- Stable reasoning list and code block render as Markdown.
- Active reasoning tail remains raw text with preserved line breaks.
- No blank card, overlap, excessive preserved whitespace, or clipped control was
  visible after changing `.reasoning-text` back to normal whitespace.

## Self Review

- Rechecked that `ReasoningPart` no longer imports `renderMarkdown` or
  `visibleStreamingText`; it uses the same streaming Markdown primitive as
  `TextPart`.
- Rechecked that the shared primitive still freezes completed blocks and only
  keeps the active streaming tail raw.
- Rechecked that no backend protocol or card-tree identity source changed.
