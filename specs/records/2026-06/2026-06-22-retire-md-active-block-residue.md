# Retire Markdown Active Block Residue

Date: 2026-06-22
Status: Implemented

## Acronyms

- CSS: Cascading Style Sheets, the overlay styling language.
- DOM: Document Object Model, the browser element tree.
- UI: User Interface, the visible overlay surface.

## Task Definition

Retire the stale `.md-active-block` selector while preserving the streaming
active-text spacing reset for current `TextPart` output.

## Recall

| Source                                                  | Constraint carried forward                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                             | Do not delete CSS blindly; migrate live semantics to the current owner and test it.               |
| Pre-June overlay streaming text main-thread plan | Streaming text must keep the active tail raw and avoid markdown parsing during deltas.            |
| `2026-06-19-retire-overlay-orphan-css-residue.md`       | Markdown renderer-emitted selectors can remain live; only orphan selectors should be retired.     |
| `2026-06-19-markdown-syntax-theme-contrast.md`          | `markdown.css` remains the syntax/rendered markdown owner; do not disturb code/highlight classes. |

## Call Point Inventory

| Surface           | Evidence                                                                                             | Decision                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Producer          | `TextPart.tsx` renders `.md-frozen-block` and `.md-active-text`; no `.md-active-block` owner exists. | Keep producer unchanged.                                              |
| Card CSS          | `card.css` reset targeted `.card__goal-desc-text .md-active-block`.                                  | Migrate the reset to `.md-active-text`.                               |
| Inspector CSS     | `inspector.css` goal/workflow prose reset targeted `.md-active-block`.                               | Migrate those reset selectors to `.md-active-text`.                   |
| Markdown renderer | `markdown.ts` owns generated markdown/code/link classes.                                             | Leave renderer-owned selectors unchanged.                             |
| Tests             | `streaming-text-render.test.ts` already covers active raw text behavior.                             | Extend it with a source/CSS contract that forbids `.md-active-block`. |

## Root Cause

The streaming text implementation renamed the active raw tail DOM to
`.md-active-text`, but card and inspector CSS still targeted the previous
`.md-active-block` name. That left live streaming prose without the intended
surface-specific margin reset.

## Acceptance

- Production CSS contains no `.md-active-block`.
- Card and inspector prose resets target `.md-active-text`.
- Streaming controller behavior remains unchanged.
- Focused streaming tests and overlay typecheck pass.

## Verification

- `rg -n -F "md-active-block" packages/overlay/src packages/overlay/test specs/records/2026-06/2026-06-22-retire-md-active-block-residue.md`
- `bun test packages/overlay/test/streaming-text-render.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/overlay/test/streaming-text-render.test.ts packages/overlay/test/markdown-safety.test.ts packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/primitives-panel-section.test.ts --timeout 30000`
- `bun run --cwd packages/overlay build:vite`
- Visual QA: `node .scratch/md-active-visual.mjs` rendered the current bundled CSS asset `index-BFbwO40P.css` and saved `.scratch/retire-md-active-block-active-text.png`. Computed styles confirmed `marginBlockStart: 0px`, `marginBlockEnd: 0px`, and `whiteSpace: pre-wrap` for card and inspector `.md-active-text` surfaces, with zero `.md-active-block` DOM matches.

## Self Review

- Rechecked that `.md-active-text` is the only current active-tail producer in `TextPart.tsx`.
- Rechecked that production source and bundled CSS do not contain `.md-active-block`.
- Viewed `.scratch/retire-md-active-block-active-text.png`; the active text surfaces are readable, aligned, and not clipped.
