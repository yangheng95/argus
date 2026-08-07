# Conversation Turn Control And Per-Model Usage

Date: 2026-08-06

UI means User Interface. LLM means Large Language Model. USD means United States dollars.

## Recall

| Item                    | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request            | Add one control below every OpenCorvus conversation turn, visually following the supplied WorkBuddy resting and hover references. The control must expose one turn's consumption for different models and be the only Conversation control surface that needs UI edits when later actions are added. The user approved the proposed UI and now requests implementation.                                                                                                                                                                                                                                                                                   |
| Acceptance              | Every visible top-level Conversation turn owns one bottom control row. Available actions, actual turn usage, and the turn timestamp share that row. Timestamp appears on pointer hover or keyboard focus. Activating usage opens a mature Popover showing the exact total and, when more than one model contributed, a model selector with input, output, reasoning, cache-read, cache-write, total Token, and USD cost facts. A single-model turn omits the selector. User turns and turns without usage do not manufacture consumption.                                                                                                                 |
| Hard constraints        | Replace the Conversation mount of `CardHeaderChrome`; do not create a second message action rail. Preserve `CardHeaderChrome` for structured and Tool cards. Reuse the existing Button, Icon, DropdownMenu, Popover, and SegmentedControl primitives. Preserve actual persisted `Message.Assistant` model and usage facts; do not derive historical usage from current model configuration, invent Credits, add a fallback, gate, state machine, synthetic message, or duplicate pricing calculation. Desktop delivery only. Do not add, modify, update, or run UI automated tests, fixtures, or screenshot baselines.                                    |
| Sources read            | `AGENTS.md`; `CLAUDE.md`; both supplied reference screenshots; `specs/current/architecture/12-overlay-card-system.md`; `specs/records/2026-08/2026-08-05-composer-personal-model-usage-hover.md`; `Message.Assistant` and `TokenUsage` in `packages/opencorvus/src/session/message.ts`; `Session.getUsage`; `CardNode`; `tree-writer.ts`; `ChatBubble.tsx`; `CardHeaderChrome.tsx`; `chat-bubble.css`; `card.css`; and the existing Overlay UI primitives.                                                                                                                                                                                                |
| Whole-repository search | `Message.Assistant` already persists `providerID`, `modelID`, `cost`, input/output/reasoning/total Token, and cache read/write. `tree-writer.ts` is the only per-message usage and model projection owner, but it currently sums usage onto a card while discarding reasoning/cache detail and suppresses `CardNode.model` when multiple models contribute. `ChatBubble.tsx` is the only ordinary Conversation turn renderer and currently mounts timestamp plus `CardHeaderChrome` in hover-only identity-row chrome. `CardHeaderChrome` has one additional structured-card owner. Kobalte-backed Popover and SegmentedControl primitives already exist. |
| Independent review      | The user did not request multiple independent agents or a parallel audit. No sub-agent was created under the explicit delegation boundary; the primary Agent owns implementation and second review.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Git baseline            | Branch `work-v0.0.33beta-yr-0806` was clean at `0fccb4e358`, equal to `myhexin/work-v0.0.33beta-yr-0806`, after `git fetch myhexin`. This pushed commit is the pre-change checkpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Correction Recall — 2026-08-06

| Item | Evidence and requirement |
| --- | --- |
| User correction | The first implementation placed the control inside the visual card. Move it below the card as a sibling surface, and match the supplied reference's compact spacing, dark neutral action icons, quiet gray usage text and icon, and dashed usage underline. |
| Visibility contract | Do not mount the control while an assistant turn is `pending` or `running`, even when streaming has already produced partial text. After success, failure, or cancellation, mount it only when the turn owns non-empty answer text. Error copy, status copy, tool activity, and empty terminal cards do not qualify as output. A user-authored message is already a complete authored turn and remains eligible when it has non-empty text. |
| State evidence | `CardStatus` is `pending | running | idle | completed | error | skipped`; `session.status` projects active streaming and retry to `running`, terminal error to `error`, and terminal aborted to `completed` plus `terminalReason=aborted`. `collectCardAnswerText` is the existing single readable-answer source. |
| Layout ownership | `ChatBubble` must render `.chat-bubble` and `ConversationTurnControl` as siblings inside `.chat-bubble-shell`; the control must not inherit the card border, background, clipping, or padding. The control component remains the only extensible turn-action/usage surface. |
| Verification boundary | This is a User Interface (UI) correction. Do not add, modify, or run UI automated tests. Verify type/build contracts, then use the real page for resting, hover, active-stream, empty-terminal, and usage-popover inspection with fresh screenshots and a second manual review. |

## Root Cause And Design Decision

The engine already owns authoritative per-assistant-message usage and model identity.
The missing capability is in the Overlay projection and presentation:

1. `tree-writer.ts` projects model and usage through separate maps.
2. Card usage aggregation keeps only four totals, so reasoning and cache detail are
   unavailable to the renderer.
3. Multiple models intentionally collapse `CardNode.model` to `undefined`, which
   makes exact per-model querying impossible even though the source messages remain
   truthful.
4. Conversation actions and timestamp currently live in hover-only identity-row
   chrome rather than below the completed turn.

The repair therefore preserves one typed per-model usage projection on `CardNode`
and replaces the Conversation-only `CardHeaderChrome` mount with one bottom
`ConversationTurnControl`. Structured cards retain their existing header chrome.
This changes neither provider pricing nor persisted message data.

## Data Contract

`CardNode.usage` remains the aggregate source consumed by existing conversation
totals and gains complete current facts plus `models`:

- input, output, reasoning, cache-read, cache-write, total Token and USD cost;
- one deterministic entry per exact `providerID/modelID` observed on source
  assistant messages;
- chronological first-observation ordering and message count;
- no estimated or hypothetical alternative-model cost.

The compact row displays total USD cost and opens the exact breakdown. A future
credit system would require its own authoritative billing ledger; this control must
not relabel calculated USD cost as Credits.

## Component Ownership

| Owner                         | Responsibility                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tree-writer.ts`              | Project and aggregate each assistant message's exact model and complete usage into one `CardNode.usage` value.                                                                  |
| `ConversationTurnControl.tsx` | Own the Conversation bottom row, visible copy action, shared overflow actions, total usage trigger, per-model Popover, selection-local presentation, and hover/focus timestamp. |
| `ChatBubble.tsx`              | Supply the turn node and existing command callbacks, then mount the control once after expanded or collapsed content.                                                           |
| `CardHeaderChrome.tsx`        | Continue owning structured-card metadata and header overflow only; export the shared overflow action component rather than duplicate its callbacks or menu items.               |
| `chat-bubble.css`             | Own bottom-row layout, reference-aligned quiet icon treatment, hover/focus timestamp disclosure, and Popover density.                                                           |

## Implementation And Verification Plan

1. Commit and push this plan before editing product code.
2. Extend the existing message usage projection with reasoning, cache, and exact
   per-model aggregates while preserving all current aggregate consumers.
3. Extract the shared overflow action menu from `CardHeaderChrome` and implement
   `ConversationTurnControl` with existing primitives.
4. Replace the Conversation identity-row hover controls with the bottom control;
   delete retired Conversation-only CSS and update current architecture.
5. Add only positive non-UI tests for the complete projection result if an existing
   pure projection test surface can consume it without UI assertions. Do not inspect
   or run UI tests.
6. Run focused non-UI tests, Overlay typecheck, Overlay Vite build, document-health,
   historical-links, and `git diff --check`.
7. Start the real desktop page, exercise resting, pointer-hover, keyboard-focus,
   single-model and multi-model Popover states, capture task-bound screenshots, and
   personally review them. Correct visual defects and repeat.
8. Re-read the scoped diff and current architecture, commit with the `dsw-33987`
   prefix, push `myhexin`, and verify remote equality.

## Verification Evidence

Implementation and review completed against the current source projection:

- `bun test ./packages/overlay/test/turn-usage-projection.test.ts
./packages/overlay/test/format-usage.test.ts`: 21 positive non-UI tests passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay build:vite`: passed.
- `bun run typecheck`: all eight participating package checks passed.
- `bun run docs:check`: passed with 313 operations in 24 groups.
- `git diff --check`: passed before final review.
- The former `packages/opencorvus/test/script/historical-docs-links.test.ts`
  command is unavailable on this branch because automated tests were removed by
  the earlier `8ae01ff289` repository change; this implementation did not
  recreate or run a UI test.

The real OpenCorvus server first refused the existing user database with
`SCHEMA_RESET_REQUIRED` semantics and confirmed that it made no modification.
Visual review therefore used an isolated current-schema runtime at
`http://127.0.0.1:17878/ui/`, the actual Overlay build, the actual provider
transport, and an actual completed `hexin/gpt-5.4-mini` response. The persisted
turn reported 69,800 input, 18 output, 69,818 total Token, and USD 0 according to
that provider's authoritative zero-cost catalog entry. A preceding real Claude
request was rejected by the upstream gateway and correctly showed no invented
usage.

Manual review confirmed the quiet resting row, pointer-hover timestamp reveal,
native Popover interaction, exact single-model breakdown, omitted selector for a
single model, and unchanged row geometry between resting and hover states:

- `specs/artifacts/2026-08-06-conversation-turn-control-rest.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-hover.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-usage.png`

The multi-model aggregation and deterministic selector inputs are covered by the
positive pure projection test. No artificial multi-model browser fixture was
introduced to manufacture a visual state.

### Correction Verification — 2026-08-06

The correction moves `ConversationTurnControl` out of `.chat-bubble` and keeps
both as siblings under `.chat-bubble-shell`. The row is now outside the card's
border and background, uses dark neutral action icons, quiet gray usage/time
copy, a neutral usage icon, reference-aligned spacing, and the Chinese label
`共消耗`. `ChatBubble` mounts the row only when non-empty answer prose exists and
the assistant card is no longer `pending` or `running`; user-authored prose is
already a complete input turn. A real terminal provider-error card with no
answer prose rendered its error surface without an assistant turn control.

Verification passed without adding, modifying, or running User Interface (UI)
automated tests:

- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `bun run docs:check`
- `git diff --check`

The final Overlay build was loaded from `http://127.0.0.1:17879/ui/` against the
isolated real runtime. Resting, hover, usage-popover, and empty terminal states
were personally reviewed in the real page, then the production build was
reloaded and reviewed a second time:

- `specs/artifacts/2026-08-06-conversation-turn-control-outside-rest.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-outside-hover.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-outside-usage.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-empty-terminal.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-outside-final.png`

### Visual Refinement Recall — 2026-08-06

| Item | Evidence and requirement |
| --- | --- |
| User feedback | The card-external placement is correct, but the delivered row is visually unattractive in the supplied real-page screenshot. Refine it rather than moving it back into the card. |
| Observable defects | At the captured User Interface (UI) scale, the control's 32-pixel minimum height compounds with the chat row's 16-pixel margins and the virtual item's 8-pixel trailing padding, creating a large empty band before the next card. The generic timestamp includes a four-digit year, and the `5.1m tok` fallback makes auxiliary metadata visually dominate the action icons. |
| Design correction | Preserve the established Button, Icon, Popover, DropdownMenu, and SegmentedControl primitives. Tighten only the turn-control rhythm: reduce its control box and typography, remove redundant virtual trailing space when the rail exists, align it closely under the card, render a compact month/day/time stamp, and render zero-cost token usage as a concise uppercase magnitude while the Popover retains the complete Token and United States dollars (USD) facts. |
| Acceptance | The resting row reads as lightweight card footer chrome, not a separate blank panel. Copy and overflow stay dark enough to recognize; usage and hover time are quieter but legible; the timestamp appears only when the pointer is over the control row itself or keyboard focus is inside that row, never from hovering the surrounding conversation card; disclosure does not move preceding controls; and the next card begins with a compact, intentional gap. |
| Verification boundary | Do not add, modify, update, or run UI automated tests. Run typecheck, Internationalization (i18n) validation, the Vite production build, documentation checks, and `git diff --check`; then inspect resting, hover, and usage states on the real page at the scale demonstrated by the user, capture fresh screenshots, visually correct defects, and repeat a second review. |

### Visual Refinement Verification — 2026-08-06

The refined row uses the shared transparent text-disclosure chrome for the usage
trigger, so hovering `Turn usage` does not paint a background. The row itself is
the only pointer and focus disclosure owner: hovering either conversation card
keeps the timestamp hidden, while hovering or focusing the compact row reveals a
month/day/time label without moving the preceding controls. The row now occupies
only its content width and the redundant trailing virtual-item space is removed.

The final Overlay build was loaded from `http://127.0.0.1:17880/ui/` against the
isolated real runtime and the same completed `hexin/gpt-5.4-mini` turn. Resting,
card-hover, row-hover, transparent usage-trigger hover, and native usage Popover
states were personally reviewed. The build was then reloaded and the hover state
was reviewed a second time:

- `specs/artifacts/2026-08-06-conversation-turn-control-refined-rest.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-card-hover.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-refined-hover.png`
- `specs/artifacts/2026-08-06-conversation-turn-control-refined-usage.png`

Final non-UI validation passed:

- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `bun run docs:check`
- `git diff --check`

No User Interface (UI) automated test was added, modified, updated, or run.
