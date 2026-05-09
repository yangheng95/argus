# Card Click Expand Double-Click Collapse - 2026-05-09

## Recall

- `specs/new-arch/12-overlay-card-system.md` defines `CardHeader.tsx` as the single card header implementation and `defaultExpandedForNode()` as the centralized default expansion policy.
- Current implementation has two collapse entry points: card header click toggles expansion, and expanded stage cards render `.card__collapse-toggle` in the body footer.
- `conversation-ui.ts` stores user expansion overrides per card and status; this remains the single state source.
- Existing worktree has unrelated dirty changes, so this task must stay scoped to card interaction files and tests.

## Target

- Remove explicit card collapse UI controls from conversation cards.
- Single click on a collapsed card header expands it; single click on an expanded card header does not collapse it.
- Double-click on a non-interactive area of the card collapses it when expanded.
- Double-clicks on interactive controls, editable fields, links, or nested child cards must not collapse an ancestor card.

## Acceptance

- No `.card__collapse-toggle` control is rendered or styled.
- No `.card__chevron` collapse affordance is rendered from `CardHeader`.
- `setCardExpanded()` remains the only direct state write for the new expand/collapse actions.
- Targeted tests cover click-expand, no click-collapse, double-click collapse, and interactive/nested guard behavior.
- Vite build passes and browser visual review confirms the card header no longer shows collapse controls.
