# Conversation Error and Metadata Header Icons

## Recall

### User request

The user supplied a current Overlay screenshot and requested three related
message-header corrections:

- remove the colored Agent-card background;
- replace the generic copy glyph with an unmistakable, permanently visible
  error glyph that copies the complete error when clicked; and
- replace the generic information glyph with an icon that communicates model
  and runtime metadata.

This supersedes the intermediate copy-glyph result already present in the
working tree.

### Acceptance criteria

- Agent conversation cards have no colored background fill.
- Failed cards render one persistent `status-failed` icon, not a diagnostic
  text chip or generic copy glyph.
- Clicking the icon copies the complete `errorReason` value.
- Copy feedback must not replace or hide the error glyph.
- The full error remains available through the button title and accessible label.
- The metadata trigger uses a model/runtime-oriented icon rather than the
  generic circled-information glyph.
- `CardHeaderChrome` remains the only product renderer on card and conversation surfaces.
- Node-launched Chromium checks verify transparent card fill, icon geometry,
  clipboard output, persistent error visibility, keyboard focus, metadata
  content, and the rendered desktop result.

### Hard constraints

- Use the existing Button, Tooltip, and Lucide Icon primitives; do not add a
  second renderer or draw icons by hand.
- Delete the superseded text-chip layout and truncation rules.
- Preserve the stage-derived border and nested Tool tone provenance while
  removing only the outer Agent-card fill.
- Do not refresh, restart, or interfere with the user's running Overlay.
- Playwright browser verification runs through Node, not Bun.
- Commit subjects start with `dsw-33987`; delivery uses the `myhexin` remote.

### Sources read

- `AGENTS.md`
- supplied screenshot
- `specs/records/2026-07/2026-07-24-conversation-error-chip-title-geometry.md`
- `packages/overlay/src/components/CardHeaderChrome.tsx`
- `packages/overlay/src/components/CardHeader.tsx`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/ui/Button.tsx`
- `packages/overlay/src/components/ui/Icon.tsx`
- `packages/overlay/src/components/ui/Icon.lucide.ts`
- `packages/overlay/src/styles/primitives/button.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/test/browser/card-header-metadata-tooltip-browser.test.ts`
- all source and browser tests matching `card-error-reason`, `errorReason`,
  `card-metadata-summary`, `info-circle`, or
  `--conversation-card-background`

### Whole-repository search evidence

- `CardHeaderChrome.tsx` is the only production owner of
  `data-ui="card-error-reason"` and `data-ui="card-metadata-summary"`;
  `CardHeader.tsx` and `ChatBubble.tsx` delegate to it.
- The registered shared icon vocabulary already contains `status-failed`; the
  Lucide registry is the single source for adding one semantic model-metadata
  icon.
- The shared icon-action Button chrome already owns transparent idle, hover,
  and focus treatment. Its green copied surface cannot be used here because
  the persistent danger glyph must remain visibly an error.
- `card.css` and `chat-bubble.css` contain text-chip-only width, ellipsis, border, padding, and flex rules which must be removed with the text renderer.
- `chat-bubble.css` is the only production owner of the Agent conversation-card
  fill. `messages.css` consumes the separate
  `--conversation-card-background` variable for nested Tool tone, so that
  variable remains stage-derived while the outer bubble background becomes
  transparent.
- Direct regression consumers are `card-header-chrome.test.ts`,
  `chat-bubble.test.ts`, `coding-assistant-panel.test.ts`,
  `overlay-architecture-guards.test.ts`,
  `conversation-error-chip-title-geometry-browser.test.ts`, and
  `card-header-metadata-tooltip-browser.test.ts`.

### Independent agent feedback

A read-only independent review recommended the shared `Button size="icon"` plus `Icon name="copy"` structure, switching to `check` on success, retaining the full diagnostic in title and accessible text, and deleting the text-chip-specific CSS and geometry contract.

## Design

`CardHeaderChrome` renders one persistent danger-toned `status-failed` icon
action whenever an error reason exists. It uses the canonical icon-action
chrome. A successful clipboard write keeps the same glyph and danger tone so
the failure never becomes visually indistinguishable from a successful card.

The complete error is not rendered as visible header text. It remains the exact clipboard payload and is projected into the button title and accessible label.

The metadata trigger uses a semantic `model-metadata` icon backed by the Lucide
library. Its tooltip content and trigger behavior remain unchanged.

The Agent bubble keeps its stage-derived border and the existing background
token for nested Tool surfaces, but its own background paints transparent.

## Call-Point Disposition

| Surface              | Call point                                               | Disposition                                                                               |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Shared renderer      | `CardHeaderChrome.tsx`                                   | Keep one persistent failed-status glyph; retain exact clipboard payload; use the model-metadata glyph for the tooltip trigger. |
| Icon registry        | `ui/Icon.lucide.ts`                                      | Register the semantic model-metadata name using a Lucide primitive.                       |
| Standard cards       | `CardHeader.tsx`                                         | Preserve delegation without a second implementation.                                      |
| Conversation cards   | `ChatBubble.tsx`                                         | Preserve delegation and keep the error action permanently visible.                        |
| Shared styling       | `card.css`                                               | Keep the failed-status glyph danger-toned and background-free in idle, hover, focus, and copied states. |
| Conversation styling | `chat-bubble.css`                                        | Remove text-lane geometry, retain persistent error visibility, and remove the outer card fill. |
| Source regression    | `card-header-chrome.test.ts`, `chat-bubble.test.ts`, `overlay-architecture-guards.test.ts` | Require semantic icons, transparent fill, primitive ownership, and reject retired copy/check/text-chip behavior. |
| Rendered regression  | `conversation-error-chip-title-geometry-browser.test.ts`, `card-header-metadata-tooltip-browser.test.ts` | Verify persistent error semantics, exact clipboard text, transparent fill, model-metadata glyph, keyboard focus, tooltip content, and screenshots. |

## Verification Plan

- `bun test packages/overlay/test/card-header-chrome.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/coding-assistant-panel.test.ts`
- `bun run --cwd packages/overlay build:vite`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-error-chip-title-geometry-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/card-header-metadata-tooltip-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Outcome

Implemented and visually verified the revised conversation-header contract:

- failed cards now render the registered `status-failed` glyph at all times;
- clicking or keyboard-activating the glyph copies the exact complete error
  while the glyph and danger tone remain unchanged;
- the metadata tooltip trigger uses the Lucide-backed `model-metadata` CPU
  glyph at the existing medium icon tier;
- both icon actions remain background-free; and
- Agent conversation cards paint no background fill while preserving the
  stage-derived border and nested Tool tone source.

Verification completed:

- CardHeaderChrome, ChatBubble, and Coding Assistant source regressions: 16
  passed;
- Overlay TypeScript typecheck passed;
- production Vite build passed;
- Node-launched Chromium error-icon test passed with exact clipboard payload,
  keyboard focus, persistent idle/hover/copied glyph, danger-token color, and
  transparent card/button backgrounds;
- Node-launched Chromium metadata-tooltip test passed with the real application
  hydration path, 16px CPU glyph, transparent trigger, and all three model,
  context, and usage rows;
- both resulting screenshots were inspected through the in-app browser;
- historical-doc links: 21 passed;
- document-health regressions: 61 passed; and
- `git diff --check` passed.

The repository-wide Overlay architecture-guard file still reports five
pre-existing failures outside this change: two duplicate-selector debt
overages, a missing `IntegrityCard.tsx`, and stale GWG/acceptance assertions.
The transparent Agent-card guard changed here passed; no thresholds or gates
were loosened to hide the unrelated failures.

## 2026-07-25 Follow-up: restore message-card color

### Recall

- The user reported that an AI change had removed the message-card background
  and requested that the card color be restored.
- This request supersedes only the earlier transparent Agent-card requirement.
  Error and metadata icon behavior remains unchanged.
- Whole-repository search confirmed that
  `--conversation-card-background` is still the single stage-derived message
  surface source. `chat-bubble.css` defines it on the Agent row, while nested
  Tool surfaces already consume the same token.
- Git history identified commit `825933c504` as the direct trigger: it changed
  the Agent bubble from `background: var(--conversation-card-background)` to
  `background: transparent` without deleting the token owner.
- The repair therefore restores that exact consumption point. It does not add
  a palette, fallback, theme override, or second card renderer.

### Acceptance and verification

- Main-conversation and Right Dock Agent cards render the stage-derived
  background in both light and dark themes.
- The generic `.chat-bubble` base remains transparent; only the contained
  Agent-card override consumes `--conversation-card-background`.
- Nested Tool surfaces retain their existing color provenance.
- Source guards and real browser checks must reject a transparent Agent-card
  background and visually confirm the restored card color.

### Outcome

- Restored the contained Agent bubble to
  `background: var(--conversation-card-background)`, preserving the existing
  7% stage tint and shared nested Tool-surface provenance.
- Updated source, architecture, main-conversation, stage-palette, and Right
  Dock browser regressions to reject transparent Agent cards.
- Verified the rendered stage palette in light and dark themes and the
  continuous Right Dock transcript screenshot.
- Verification passed:
  `bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/overlay-architecture-guards.test.ts --test-name-pattern "ChatBubble|chat bubbles use one token-driven contained Agent surface"`;
  the three Node browser tests for Agent separation, ChatBubble disclosure,
  and sub-agent Dock; `bun run --cwd packages/overlay typecheck`; and
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`.
