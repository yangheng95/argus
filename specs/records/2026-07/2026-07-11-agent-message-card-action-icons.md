# Agent message card action icon redesign

## Recall

### User request

The user rejects the Agent message card's upper-right icons as visually poor.

### Acceptance criteria

- Trace, model settings, cancel, temporarily-disabled rewind, reply, and copy read as one coherent action family.
- The toolbar uses one shared container rhythm instead of a divider plus several unrelated floating glyphs.
- Icons come from the existing Lucide-backed `Icon` primitive; no hand-written SVG or new icon dependency is introduced.
- Trace and model settings use recognizable log/settings glyphs; reply uses a quiet message glyph.
- Hover, focus, copy feedback, trace toggle, reply toggle, cancel, and keyboard reachability remain functional.
- A real Agent message browser fixture is captured and visually reviewed after implementation.

### Hard constraints

- Do not restart or refresh the user's running OpenCorvus process; use the isolated Node browser fixture.
- Preserve the real action contracts and do not introduce a fake overflow menu or fallback action path.
- Keep the shared Button and Icon primitives as the only action/icon owners.
- Preserve unrelated dirty worktree changes.

### Sources read

- an untracked July planning draft that was read during the original task and is not retained
- `packages/overlay/src/components/{ChatBubble,CardHeader,CardHeaderChrome,AgentSessionReplyBox,Icon}.tsx`
- `packages/overlay/src/styles/surfaces/{card,chat-bubble}.css`
- Focused card/chat unit and browser tests plus existing `.scratch` card screenshots.

### Whole-repository search evidence

Focused `rg` covered every `card-trace`, `card-agent-model-settings`, `card-agent-cancel`, `card-rewind`, reply disclosure, message copy, card action owner, and browser assertion. `CardHeaderChrome` is the single shared owner for card controls; `ChatBubble` composes reply and copy beside it; the visual contract is split between `card.css` and `chat-bubble.css`.

### Independent agent feedback

No sub-agent was used because the user did not request delegation. The primary agent performs direct screenshot review.

## Root cause and design

The rail mixed a scan-frame, play, undo, message-plus, and copy glyph at 13–14 pixels. A nested divider split one conceptual toolbar into unrelated fragments. The redesign gives the outer hover-action owner one quiet elevated pill, a consistent 26-pixel circular hit target and 14-pixel Lucide glyph, removes the redundant inner divider, maps trace to `log-lines`, model settings to `config-general`, and reply to `message`. Disabled rewind stays functionally unchanged but becomes subordinate.

## Verification

- Focused card/chat unit contracts.
- `chat-bubble-disclosure-button-browser.test.ts` through the Node browser runner.
- Overlay typecheck, docs health, and `git diff --check`.

## Result

- The action rail now renders as one quiet pill instead of detached glyph fragments and a redundant divider.
- Trace, reply, settings, cancel, rewind, and copy share the same 26-pixel circular control geometry and 14-pixel, 1.8-stroke Lucide treatment.
- The real browser fixture preserved hover/focus reveal, reply, trace, copy feedback, collapsed work details, and keyboard traversal. The inspected `overlay-codex-message-hover-toolbar.png` shows the toolbar aligned to the identity row without competing with message content.
- Focused unit contracts, Overlay TypeScript, the production Vite build, and the Agent message browser test passed.
