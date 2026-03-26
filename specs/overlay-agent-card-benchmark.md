# Overlay Agent Card Benchmark

## Task Definition

Repair the overlay conversation pipeline so sub-agent cards stream incrementally without remounting, preserve explicit fold/unfold state while live events are pruned, and stop coupling UI state to render-time synthetic keys.

## Input -> Output

- Input:
  - Transcript messages from `packages/overlay/src/store/messages.ts`
  - Live `agent.updated` SSE events for a selected task
  - User expand/collapse actions on agent cards and completed tool outputs
- Output:
  - Stable agent-card identities in the overlay conversation
  - Explicit collapse state preserved across live pruning updates
  - Tool output expansion state stored outside transient DOM state

## Environment

- Workspace: `D:\myhexin-local\argus-opencode`
- Package: `packages/overlay`
- Runtime: Bun test runner

## Timeout Strategy

- Unit benchmark commands must use an inactivity-based timeout:
  - treat output progress as activity
  - only fail if there is no new output for the configured window
- This work uses focused Bun test commands whose runtime stays well below the inactivity window.

## Acceptance Criteria

1. A live-only agent card keeps the same card id after more than 12 live events.
2. An explicit collapse survives the live-event pruning window shift.
3. Transcript-backed agent cards use stable session-derived ids rather than `startTime/index`.
4. Completed tool output expansion is controlled by reactive UI state, not DOM class toggling.
5. Focused overlay tests pass after the refactor.
