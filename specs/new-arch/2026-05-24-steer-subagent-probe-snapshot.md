# steer_subagent Probe Snapshot for Live Build Ownership

Date: 2026-05-24

## Problem

`steer_subagent` cannot answer the orchestrator's legitimate "is this build child still active?" question. For a live-owned build session it currently returns a structural error, while `recover_stale_build` refuses streaming/retry sessions and `read_context` exposes no activity timestamp. The orchestrator can only blind-wait even though the underlying stream activity gate already tracks last chunk/activity time.

The existing invariant from `2026-05-21-build-orchestrator-interruption-stabilization.md` remains correct: generic steering must not inject messages into build/stage sessions because that bypasses the `SessionRuntimeContract` and reopens the G1/G2/G3 race class. The missing behavior is a read-only activity probe, not a direct reply.

## Root Cause

| Surface | Current behavior | Impact | Disposition |
| --- | --- | --- | --- |
| `packages/opencorvus/src/orchestrator/tools.ts:4008-4053` | `steer_subagent` resolves the target, detects `kind === "build"`, and returns `Error: steer_subagent cannot generically steer build session ...` when live ownership exists. | The orchestrator cannot inspect a live-owned build child through the intended child-control tool. | Replace the live-owned build error response with a read-only snapshot. Keep no-`replyAgentSession` invariant. |
| `packages/opencorvus/src/orchestrator/tools.ts:4174-4178` | `recover_stale_build` refuses `SessionStatus` values `streaming` and `retry`. | A live streaming build cannot use recovery to confirm staleness. | Leave unchanged; recovery remains the destructive action after evidence exists. |
| `packages/opencorvus/src/orchestrator/tools.ts:3789-3790` | `read_context` exposes latest goal run id/status but no session activity age. | Prompt guidance alone cannot tell the orchestrator whether a child is stalled. | Snapshot path supplies activity data in the existing `steer_subagent` envelope. |
| `packages/opencorvus/src/util/stream-activity.ts:47,171` | `StreamActivityGate.lastActivityAt()` exists internally. | Single source exists but is not projected to orchestrator tools. | Surface this value through the existing session activity/status projection rather than adding a parallel store. |
| `packages/opencorvus/src/build/agent.ts:1523` and `packages/opencorvus/src/llm/activity.ts:580` | Build/executor and LLM activity already use `withStreamActivity`. | Activity is already chunk-driven; duplicating timestamps elsewhere would violate single source. | Register/project the existing gate activity against the session id where the active session stream is known. |

## Alternatives

| Option | Decision | Reason |
| --- | --- | --- |
| A. Prompt-only fix | Rejected | `read_context` has no activity timestamp or age field, so the prompt would still lack evidence. |
| B. Add a new `probe_subagent` tool | Rejected | It creates a new tool surface for behavior that belongs inside `steer_subagent`'s "look at/contact child" semantic envelope. |
| C. Make `steer_subagent` inject an out-of-band build reply | Rejected | Violates the 2026-05-21 spec invariant and reopens direct-reply pollution/race incidents. |
| D. Auto-downgrade `steer_subagent` for live-owned build sessions to a read-only snapshot | Accepted | Preserves the data-integrity gate, uses the existing tool surface, and gives the orchestrator enough evidence to wait or call `recover_stale_build`. |

## Snapshot Shape

For `kind === "build"` with a live ownership row, `steer_subagent` returns:

```text
Activity snapshot for live-owned build child session <child_session_id>:
  child_session_id=<child_session_id>
  status=<SessionStatus.get(session_id).type>
  last_activity_at=<epoch_ms>
  age_ms=<Date.now() - last_activity_at>
  owner_tool_part=<owner_tool_part_id>
  owner_ownership=<owner_ownership_id>
  goal_run=<goal_run_id or "n/a">
Reason recorded: <reason>
Note: build sessions cannot accept injected steering messages. To act on this snapshot, either keep waiting, or - if age_ms is large AND status indicates no progress - call recover_stale_build.
```

Required fields:

- `status`: existing `SessionStatus.get()` result type, with retry/terminal details allowed if the local projection already carries them.
- `last_activity_at`: epoch milliseconds from the same `StreamActivityGate.lastActivityAt()` source used by the active stream.
- `age_ms`: `Date.now() - last_activity_at`.
- `owner_tool_part_id`: from the live build ownership row.
- `owner_ownership_id`: from the live build ownership row.
- `child_session_id`: the resolved child session id.
- `child_goal_run_id`: from target resolution or ownership payload when available.

Terminal build sessions without live ownership keep the existing structural response: `Use build({ goalID, request }) for a fresh stage-attempt runtime contract instead.`

## Amendment to 2026-05-21 Invariant

This spec amends `2026-05-21-build-orchestrator-interruption-stabilization.md` section 3 only for the live-owned build response shape. The invariant remains:

- `steer_subagent` must not call `replyAgentSession` for build/stage sessions.
- Build retry/recovery remains the only path that changes build ownership/runtime state.

The amended live-owned behavior is a read-only probe snapshot. It does not append messages, wake the build agent through generic reply, cancel ownership, or retry the goal.

## Implementation Plan

1. Grep all `StreamActivityGate` / `withStreamActivity` / `lastActivityAt` readers and reuse the existing stream activity source.
2. Project the active session's `lastActivityAt()` through the existing session status/activity surface used by orchestrator tools.
3. Replace only the live-owned `kind === "build"` `steer_subagent` response with the snapshot string.
4. Preserve the terminal-without-owner build branch unchanged.
5. Update the orchestrator prompt so it describes non-build steering versus live-owned build snapshots.

## Test Plan

- Replace existing `steer_subagent` build-error assertions in `packages/opencorvus/test/orchestrator/tools.test.ts` with snapshot assertions for `status`, `last_activity_at`, `age_ms`, `owner_tool_part`, and `child_session_id`.
- Add a regression test that a live-owned build target returns the snapshot and does not call `EngineService.replyAgentSession`.
- Add a non-build child test showing `steer_subagent` still calls `replyAgentSession`.
- Add/keep a build session with no live owner test asserting the existing fresh-build structural response remains unchanged.
- Run the targeted suite:

```sh
bun test packages/opencorvus/test/orchestrator/tools.test.ts
```

Pre-push hooks must then run normally on push: typecheck, api:routes-check, and docs:check.
