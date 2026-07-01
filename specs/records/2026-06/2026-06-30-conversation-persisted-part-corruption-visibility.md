# Conversation Persisted Part Corruption Visibility

Date: 2026-06-30

DB means Database. UI means User Interface.

## Recall

- User report: selecting task `tsk_f17e432c2001tH12z7TjZFKf7M` failed with
  HTTP 500 on
  `/task/tsk_f17e432c2001tH12z7TjZFKf7M/conversation?tail_limit=8`.
- The response was:
  `Session.persistedPart: persisted part prt_f191327490014aLU7JVu9jsV2T violates Message.VisiblePart: state.time.end: tool terminal end time must be later than start time`.
- User requirement after diagnosis: do not let one exception make the whole
  message panel fail to show messages.
- Current DB evidence:
  - `prt_f191327490014aLU7JVu9jsV2T` is a `browser_preview` tool part.
  - It was written by `engine.writer.abort-open-tool-parts`.
  - Failure message is `Server shutdown: http.shutdown`.
  - `state.time.start === state.time.end === 1782832115267`.
  - The owning message is `msg_f191304c7001kph73gHZFi20rm`, assistant/build,
    `MessageAbortedError: external abort signal fired`.
  - The owning build session belongs to deleted goal
    `gol_f18f17d31001vRhlokZSzIqMEu`.
- Read before implementation:
  - `specs/records/2026-06/2026-06-28-tool-pending-start-time-contract.md`
  - `specs/records/2026-06/2026-06-30-terminal-tool-time-order-contract.md`
  - `packages/opencorvus/src/session/message.ts`
  - `packages/opencorvus/src/server/routes/orchestrator.ts`
  - `packages/opencorvus/src/conversation/view.ts`
  - `packages/overlay/src/components/CardParts.tsx`
  - `packages/overlay/src/utils/message-part.ts`
- Whole-repository grep:
  - `rg -n "part-error|persisted part|Message.VisiblePart|VisibleMessagePart|CardParts unsupported part type|conversation.*500|corrupt.*part" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/records/2026-06 specs/current/architecture`
  - `rg -n "unsupportedPartFallback|KNOWN_PART_TYPES|CardParts\\(|messagePartHasDisplayContent|conversationPartHasDisplay|persistedPart\\(|latestAcrossSessions|Message\\.parts\\(|Session\\.messages\\(" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`

## Root Cause

`Message.persistedPart()` parses each stored row as `Message.VisiblePart`.
When a single persisted part is corrupt, the helper throws. The bounded task
conversation hydrate path calls `Message.latestAcrossSessions()`, so one bad
part aborts the whole `/task/:taskID/conversation` response before the overlay
can show the surrounding messages.

The strict write contract is correct: invalid tool lifecycle state must not be
accepted as valid tool state. The fragile behavior is treating one corrupt
historical part as a fatal error for the whole conversation read model.

## Acceptance

- Corrupt persisted part rows remain visibly marked as corrupt; they are not
  skipped, hidden, or repaired in the UI.
- `Message.ToolStateCompleted` and `Message.ToolStateError` still reject
  `time.end <= time.start`.
- `Session.messages()`, `Message.latestAcrossSessions()`, and `Message.parts()`
  return a visible diagnostic part for a corrupt persisted row instead of
  throwing the whole transcript read.
- The diagnostic part preserves backend identity fields: `id`, `sessionID`,
  `messageID`, `orderKey`, and a machine-readable issue list.
- Overlay `CardParts` renders this diagnostic part as an error block.
- Unknown frontend part types remain render errors; the new diagnostic is an
  explicit public part type, not a generic catch-all fallback.

## Validation Plan

- `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/session/part-delta.test.ts --test-name-pattern "corrupt persisted part"`
- `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/session/message.test.ts --test-name-pattern "terminal tool state requires end time after start"`
- `bun test --timeout 70000 packages/overlay/test/conversation-rendering-i18n.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## Implementation

- Added `Message.PartErrorPart` as a formal visible message part type with
  backend identity fields, a diagnostic message, issue list, and original
  persisted `type` / `tool` labels.
- `Message.persistedPart()` now returns `part-error` when a stored row violates
  `Message.VisiblePart` instead of throwing the entire transcript read.
- Normal write schemas still reject invalid terminal tool state; the corrupt
  row remains corrupt and is not repaired or hidden by the UI.
- Overlay `CardParts` renders `part-error` as an explicit error block. Unknown
  part types still throw `CardParts unsupported part type`.
- OpenAPI and SDK generated artifacts were regenerated so `PartErrorPart` is
  part of the public conversation contract.

## Verification

- Passed:
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/session/part-delta.test.ts --test-name-pattern "corrupt persisted part"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "visible diagnostics for corrupt persisted parts"`
  - `bun test --timeout 70000 packages/overlay/test/conversation-rendering-i18n.test.ts`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/session/message.test.ts --test-name-pattern "terminal tool state requires end time after start"`
  - `bun run --cwd packages/opencorvus typecheck`
  - `bun run --cwd packages/overlay typecheck`
  - `bun run --cwd packages/sdk/js typecheck`
  - `bun run api:routes-check`
  - `bun run docs:check`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `git diff --check -- <touched files>`
