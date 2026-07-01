# Compaction Part Card Projection Repair

Date: 2026-07-02

## Recall

- User report: `CardParts unsupported part type: compaction`.
- Acceptance criteria:
  - Completed compaction marker parts must not reach `CardParts`.
  - `CardParts` must keep throwing for genuinely unsupported rendered part
    types; no fallback renderer is allowed.
  - Hydrated conversation replay and live `message.part.updated` events must
    share the same visible-body classification.
  - Server conversation display metadata must not classify compaction-only
    marker messages as displayable UI content.
  - Regression tests must pin the control-marker behavior.
- Hard constraints:
  - No fallback / compatibility rendering.
  - No second card model or component-local placement policy.
  - Preserve compaction markers in persisted session history because
    `Message.filterCompacted()` and pruning use them as durable boundaries.
  - Do not weaken `CardParts unsupported part type` for unknown part types.
- Sources read:
  - `specs/current/architecture/12-overlay-card-system.md`
  - `specs/records/2026-06/2026-06-30-conversation-persisted-part-corruption-visibility.md`
  - `specs/records/2026-06/2026-06-14-marker-on-anchor-compaction-boundary.md`
  - `packages/overlay/src/components/CardParts.tsx`
  - `packages/overlay/src/utils/message-part.ts`
  - `packages/overlay/src/services/tree-writer.ts`
  - `packages/transport-protocol/src/index.ts`
  - `packages/opencorvus/src/session/message.ts`
  - `packages/opencorvus/src/session/compaction.ts`
  - `packages/opencorvus/src/conversation/view.ts`
  - `packages/opencorvus/test/session/session-control.test.ts`
  - `packages/overlay/test/agent-role-routing.test.ts`
  - `packages/opencorvus/test/server/conversation-view.test.ts`
- Whole-repository grep:
  - `rg "CardParts|unsupported part type|part type" -n`
  - `rg "compaction" -n`
  - `rg -n 'isCardBodyMessagePart|KNOWN_PART_TYPES|type: "compaction"|CompactionPart|Session\.messages|filterCompacted|updatePart|SessionCompaction\.create|Context compaction checkpoint' packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
  - `rg -n 'conversationMessageHasDisplay|conversationPartHasDisplay|messagePartHasDisplay|message.*parts.*some|latestAcrossSessions|ConversationView|hydrateConversationView|VisibleMessagePart' packages/opencorvus/src packages/opencorvus/test/server packages/sdk/openapi.json packages/sdk/js/src/gen/types.gen.ts`
- Independent agent feedback:
  - Not collected in this turn. The available multi-agent tool explicitly
    disallows spawning subagents unless the user asks for delegation or
    parallel agent work, so this record preserves the gap instead of faking a
    review.

## Root Cause

`SessionCompaction.process()` correctly persists a `type: "compaction"` marker
on the source user message after a structured handoff succeeds. That marker is
part of session history and remains necessary for `Message.filterCompacted()`
and compaction pruning.

The overlay projection layer treated almost every non-boundary persisted part
as a card body part. `CardParts.tsx`, however, only renders a narrower explicit
set. This created a dual-source mismatch: a durable control marker entered the
card body path, then the renderer correctly threw
`CardParts unsupported part type: compaction`.

The server-side conversation view had the same broad display predicate, so a
compaction-only marker message could also be classified as displayable metadata
even though the overlay cannot render it as body content.

## Implementation Plan

1. Add the explicit displayable/renderable message part type contract to the
   shared `@opencorvus-ai/transport-protocol` package.
2. Make the overlay message-part classifier use that shared rendered-body type
   predicate.
3. Make `CardParts` reuse that same classifier for its "known rendered part"
   check, preserving strict errors for unknown rendered types.
4. Align backend `conversationPartHasDisplay()` with the same shared
   displayable part predicate so compaction-only marker messages are not
   advertised as UI content.
5. Add regression coverage for compaction markers in the shared protocol,
   overlay part ordering, and backend conversation display classification.

## Verification Plan

- `bun test packages/overlay/test/agent-role-routing.test.ts`
- `bun test packages/opencorvus/test/server/conversation-view.test.ts`
- `bun test packages/transport-protocol/test/contract.test.ts`
- `bun test packages/opencorvus/test/session/session-control.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/transport-protocol typecheck`
- `git diff --check -- <touched files>`

## Implementation

- Added `CONVERSATION_DISPLAY_MESSAGE_PART_TYPES` and
  `isConversationDisplayMessagePartType()` /
  `isConversationRenderableMessagePartType()` to the shared transport protocol
  package.
- Replaced overlay body projection's broad "not control" predicate with the
  shared rendered body part predicate.
- Removed `CardParts.tsx`'s local known-type copy and routed its strict
  fallback check through the shared overlay rendered-part classifier.
- Replaced server conversation display's broad predicate with the shared
  displayable part predicate so compaction-only marker messages are not
  projected as UI display content.
- Added regressions for `compaction`, `snapshot`, `agent`, and `retry` as
  non-display/control parts, while keeping `part-error` displayable.

## Verification

- Passed:
  - `bun test packages/transport-protocol/test/contract.test.ts`
  - `bun test packages/overlay/test/agent-role-routing.test.ts`
  - `bun test packages/opencorvus/test/server/conversation-view.test.ts`
  - `bun test packages/opencorvus/test/session/session-control.test.ts`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `bun run --cwd packages/transport-protocol typecheck`
  - `bun run --cwd packages/overlay typecheck`
  - `bun run --cwd packages/opencorvus typecheck`
  - `bun test packages/overlay/test/conversation-rendering-i18n.test.ts`
  - Isolated overlay visual load check:
    - Started Vite with `node .\node_modules\vite\bin\vite.js --config vite.config.ts --host 127.0.0.1 --port 5177` from `packages/overlay`.
    - Captured `.scratch/compaction-card-projection-overlay.png` with Node-launched Playwright.
    - Reviewed screenshot: overlay loads the workspace-required state; no blank page or global render crash. Console contained the expected backend `ERR_CONNECTION_REFUSED` because the isolated Vite page was not connected to a running OpenCorvus server.
  - `git diff --check -- packages/transport-protocol/src/index.ts packages/transport-protocol/test/contract.test.ts packages/overlay/src/utils/message-part.ts packages/overlay/src/components/CardParts.tsx packages/opencorvus/src/conversation/view.ts packages/overlay/test/agent-role-routing.test.ts packages/opencorvus/test/server/conversation-view.test.ts specs/records/2026-07/2026-07-02-compaction-part-card-projection.md specs/records/2026-07/README.md`
