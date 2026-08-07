# Terminal Tool Time Order Contract

Date: 2026-06-30

DB means Database. UI means User Interface.

## Recall

- User report: overlay card render failed with:
  - `tool part prt_f18a72dde001bId9nE7Dd1ITqM end time must be later than start time`
  - `tool part prt_f18a6afd60019AxjbEVjqF6qeE end time must be later than start time`
- Screenshot evidence shows `Card render failed` for two tool cards.
- Read before implementation:
  - `specs/records/2026-06/2026-06-28-tool-pending-start-time-contract.md`
  - `packages/overlay/src/utils/tool-card-node.ts`
  - `packages/opencorvus/src/engine/writer.ts`
  - `packages/opencorvus/src/session/message.ts`
  - `packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts`
- Whole-repository grep:
  - `rg -n "end time must be later than start time|endedAt|startedAt|tool part" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test specs/records/2026-06`
  - `rg -n "abort-open-tool-parts|Session.updatePart|state.time|end: now|end: Date.now" packages/opencorvus/src packages/opencorvus/test`
- Current DB evidence from
  `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`:
  - terminal tool parts scanned: 4471
  - invalid terminal tool parts: 3
  - all invalid rows have `originSite = "engine.writer.abort-open-tool-parts"`,
    `message = "Server shutdown: http.shutdown"`, `tool = "apply_patch"`, and
    `state.time.start === state.time.end`.

## Root Cause

`engine.writer.abortOpenToolParts()` terminalizes pending tool parts during
server shutdown. For a pending part, it used the current shutdown timestamp as
both the synthetic start and the terminal end:

```ts
const now = Date.now()
const start = part.state.status === "running" ? part.state.time.start : now
time: { start, end: now }
```

When `start` is derived from the same `now`, terminal tool rows can persist with
`end === start`. The overlay is correct to reject that shape because tool card
duration is backend-owned and must not be inferred from render time.

## Acceptance

- `Message.ToolStateCompleted` and `Message.ToolStateError` reject
  `time.end <= time.start`.
- `abortOpenToolParts()` preserves a pending tool part's real
  `state.time.start` and writes `end > start`.
- `abortOwnedToolPart()` also writes `end > start`.
- Existing overlay `toolToCardNode()` remains strict.
- No frontend fallback, no DB migration, no hidden timestamp inference in UI.

## Validation Plan

- `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/session/message.test.ts --test-name-pattern "terminal tool state requires end time after start"`
- `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts --test-name-pattern "pending tool parts|legacy global"`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## Implementation

- Added a terminal tool time helper in `engine/writer.ts` so shutdown abort
  paths write `end = max(observedAt, start + 1)`.
- `abortOpenToolParts()` now preserves the existing pending/running
  `state.time.start`; it no longer invents `start` from the same shutdown
  timestamp used for `end`.
- `abortOwnedToolPart()` uses the same terminal tool time helper.
- `Message.ToolStateCompleted` and `Message.ToolStateError` now reject
  `time.end <= time.start`.
- Shutdown tests assert the errored tool part keeps its original start and has
  an end timestamp greater than start.

## Verification

- Passed:
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/session/message.test.ts --test-name-pattern "terminal tool state requires end time after start|tool pending state requires"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts --test-name-pattern "pending tool parts|legacy global"`
  - `bun run --cwd packages/opencorvus typecheck`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `bunx prettier --check packages/opencorvus/src/engine/writer.ts packages/opencorvus/src/session/message.ts packages/opencorvus/test/session/message.test.ts packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts specs/records/2026-06/2026-06-30-terminal-tool-time-order-contract.md specs/records/2026-06/README.md`
  - `git diff --check -- packages/opencorvus/src/engine/writer.ts packages/opencorvus/src/session/message.ts packages/opencorvus/test/session/message.test.ts packages/opencorvus/test/engine/shutdown-active-task-sessions.test.ts specs/records/2026-06/2026-06-30-terminal-tool-time-order-contract.md specs/records/2026-06/README.md`
- Current DB residual:
  - A read-only scan still finds the three already persisted bad terminal tool
    rows from `engine.writer.abort-open-tool-parts`. This source repair prevents
    new rows with that shape; it does not mutate existing runtime DB rows.
