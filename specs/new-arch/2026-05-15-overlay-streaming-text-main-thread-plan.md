# Overlay Streaming Text Main-Thread Plan

> Date: 2026-05-15
> Status: implementation plan

## Recall

- `specs/new-arch/07-panel-reactivity.md` requires the streaming path to keep
  overlay frames under 16 ms and forbids broad recomputation on each SSE
  delta.
- `specs/new-arch/2026-05-14-overlay-refresh-single-source-plan.md` requires
  live message deltas to render from `cardTreeStore` without board refresh.
- `specs/new-arch/2026-05-15-overlay-scroll-single-source-plan.md` moved
  scroll follow to the data source, but text rendering still owns its own
  main-thread cost.

## Evidence

- `ReasoningPart` renders `renderMarkdown(text())` directly in JSX. Every
  reasoning delta reparses the entire accumulated reasoning text.
- `TextPart` defers active text visibility through `requestAnimationFrame`.
  While the frame is delayed by synchronous markdown work, a newly mounted text
  part can render an empty body.
- `TextPart` still reparses the whole trailing active markdown block when the
  frame finally runs. A long paragraph or code fence remains one active block,
  so the cost grows with the full streamed text length.
- `ConversationAgentRail` builds workflow summaries by walking card parts via
  `textFromCard()`. The rail is mounted as part of the main overlay, so this
  subscribes workflow projection to streamed正文 text and can re-run a tree
  walk on every delta.
- User-visible symptoms match a renderer main-thread stall: cards show large
  blank areas, pointer input stops, scrolling stops, and running timers stop.

## Root Cause

The streaming text renderer treats unfinished text as markdown, and the
workflow rail treats正文 text as a navigation summary source. Markdown parsing,
syntax highlighting, and workflow tree projection are synchronous, so
high-frequency deltas can block the WebView2 renderer. The rAF delay also
makes content visibility depend on the same frame queue that is already
blocked.

## Requirements

1. Streaming text and reasoning must be visible synchronously on the same data
   update that delivered the delta.
2. Streaming deltas must not synchronously parse the whole accumulated
   markdown block.
3. Completed markdown blocks may be rendered once and cached.
4. When a session leaves `running`, the remaining active block is rendered as
   markdown once.
5. `CardParts` must receive the owning card's running status explicitly; text
   rendering must not infer lifecycle from DOM state.
6. Workflow navigation must not read streamed正文 text; reports or stable card
   metadata are the only allowed rail summary sources.

## Implementation

1. Replace `TextPart`'s rAF active block with a synchronous raw active block.
2. Render all blocks as markdown only when `streaming` is false; while
   streaming, render completed blocks as markdown and the trailing active block
   as raw text.
3. Add `streaming?: boolean` to `CardParts`, `TextPart`, and `ReasoningPart`.
4. Update `Card`, `ChatBubble`, `ChatBubbleChild`, and `RequirementsPanel` to
   pass the owning stream status into `CardParts`.
5. Update CSS so raw active text preserves line breaks with `white-space:
pre-wrap`.
6. Remove `textFromCard()` / `textFromPart()` from agent workflow projection.
   Keep trace report summaries when present; otherwise use stable metadata in
   the rail row rather than正文 content.
7. Add static regression tests preventing rAF-driven text visibility and
   direct `renderMarkdown(text())` in `ReasoningPart`.

## Validation

- Targeted text-render tests pass.
- Existing tree-writer/auto-scroll tests still pass.
- Overlay typecheck passes.
- Repository quality gates pass before commit/push.
