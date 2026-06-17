# Agent Card CSS Retirement

Date: 2026-06-17

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

`packages/overlay/src/styles/surfaces/agent-card.css` is still loaded by the
overlay shell, but no runtime component, HTML template, or test fixture creates
the `.agent-card*` or `.executor-tool-*` class contract anymore. The current
conversation surfaces render through `Card.tsx`, `ChatBubble.tsx`, and their
corresponding `card.css` / `chat-bubble.css` styles.

Keeping the stylesheet creates a dead runtime source and makes future style
audits treat obsolete agent-card selectors as live UI.

## Call Points

| Search | Evidence | Decision |
| --- | --- | --- |
| `rg -n "agent-card|executor-tool-entry|executor-tool-item|executor-tool-output|agent-card--expanded|data-agent-stage" . -g "!node_modules" -g "!dist" -g "!dist-vite" -g "!.git"` | Live matches are the stylesheet itself, the `index.html` link, one architecture guard map entry, and historical specs. Runtime TypeScript/TSX does not create those class names. | Delete the stylesheet and runtime link. |
| `rg -n "agent-card.css" . -g "!node_modules" -g "!dist" -g "!dist-vite" -g "!.git"` | Only `src/index.html` and `overlay-architecture-guards.test.ts` reference the file. | Update the guard to expect the retired file to stay absent. |
| `rg -n "agent card|agent-card|message-turn agent" specs packages/overlay/src packages/overlay/test` | Current live card tests reference agent cards as data/model concepts, not the old `.agent-card` CSS contract. | Preserve model tests; remove only the unused CSS surface. |

## Fix Shape

- Remove the `agent-card.css` stylesheet link from `packages/overlay/src/index.html`.
- Delete `packages/overlay/src/styles/surfaces/agent-card.css`.
- Update the architecture guard surface-file inventory and add an explicit
  regression assertion that the retired stylesheet is not loaded or present.

## Verification

- `bun test packages/overlay/test/overlay-architecture-guards.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser smoke screenshot of the overlay shell to confirm the shell still
  renders after the stylesheet link removal.
