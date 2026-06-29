# A2A Stale Cancel Terminal Status Repair

Status: implemented
Date: 2026-06-29

## Evidence

Task `tsk_f0e5c0272001djBGw2eLvbkgkH` recorded a pending
`agent_coordination_request` for build session
`ses_0f1678eb0ffe74F80LH6lnrFn8` / goal run `2f326d19`. The worker later
published:

- `session.status terminal/completed` at protocol seq 405.
- `goal_run.updated status=completed` at protocol seq 407.

A later `respond_agent_coordination(decision="cancel_worker")` wrote:

- `session.status terminal/aborted` at protocol seq 417.
- `agent.coordination.action status=completed` at protocol seq 419.

That sequence did not cancel live work. It changed the visible terminal reason
for an already completed worker because the running process had lost the
in-memory `SessionStatus` latch after restart and the cancel path required a
new durable `terminal/aborted` event.

The event stream also shows display G11 (`order_index=10`,
`gol_f0e934db300bIoLn2foGLBRFow`) only started running at seq 525, after the
stale cancel action. The cancel action targeted `order_index=0`, not G11.

Independent DB audit (2026-06-29) confirmed:

- the only `cancel_worker` / `terminal aborted` sequence targets G1
  `gol_f0e934db3001679MGlnfH360Dr` / goal_run `2f326d19`;
- G11 `gol_f0e934db300bIoLn2foGLBRFow` / goal_run `caa70dbd` has no matching
  cancel/abort/coordination event;
- G1 `goal_run.status` stayed `completed`, while only its session status was
  polluted by the later aborted projection.

## Call-Site Recall

`rg "cancel_worker|respond_agent_coordination|agent_coordination_request|SessionStatus.*aborted|cancel_status"` reviewed:

- `packages/opencorvus/src/orchestrator/tools.ts`
  - `respond_agent_coordination` cancel branch.
  - `findAgentCoordinationCancelStatusEvent`.
  - `cancelLiveOwnedBuild`.
- `packages/opencorvus/src/engine/agent-coordination.ts`
  - request/response/action artifact claim and completion helpers.
- `packages/opencorvus/src/session/status.ts`
  - in-process terminal guard. The guard is not durable across restart.
- `packages/opencorvus/test/orchestrator/tools.test.ts`
  - existing cancel_worker action tests.
- `packages/overlay/src/services/tree-writer.ts`
  - phase card identity, `phaseSessionID`, and `session.status` projection.
- `packages/overlay/src/store/card-tree.ts`
  - phase card owner fields.
- `packages/overlay/test/tree-writer-hierarchy.test.ts`
  - phase-absorbed build/session lifecycle tests.
- `specs/new-arch/2026-06-26-enterprise-a2a-protocol-root-repair.md`
  - old cancel_worker contract requiring a durable aborted status event.

## Root Cause

The A2A cancel path treated "cancel_worker action completed" and "target
session must now have terminal/aborted" as the same fact. That is correct only
for live or already aborted workers.

For a stale coordination request whose worker already has a durable terminal
non-aborted status, the authoritative fact is the prior terminal status. The
request still needs a response/action so the mailbox stops blocking, but the
worker outcome must not be rewritten.

A second projection issue can make the operator experience look like "the
running G11 was cancelled" even when the backend did not abort G11:

- overlay phase/step card IDs are attempt-invariant (`step:<goalID>:build`) so
  early streaming messages and board rebuilds share one rolling phase card;
- before this repair, a late older phase session could overwrite
  `phaseSessionID` on that rolling card;
- `session.status` then applied to the card via the old session's
  `activeCardID` without checking the phase card still belonged to that
  session.

The backend event stream stayed correct, but controls and lifecycle projection
could be visually attached to the wrong currently-running phase card.

## Repair

`respond_agent_coordination(decision="cancel_worker")` now reads the latest
durable `session.status` event for the target session before mutating runtime
state.

- The stale-close path is evaluated before requiring the worker to still have
  current live ownership. A pending request is already the durable proof that
  the worker was task-owned at request creation time.
- If the latest durable status is `terminal` and the reason is not `aborted`,
  the tool completes the A2A action as a stale terminal worker close and
  preserves that status.
- If the latest durable status is `terminal/aborted`, the tool completes from
  the existing cancellation status.
- Otherwise the existing live-cancel behavior remains: abort live ownership,
  goal run, or child session and require a durable `terminal/aborted` event.

The single source for completed/error terminal worker status is the durable
`session.status` event stream; the in-memory `SessionStatus` latch is not used
to infer prior terminal completion after process restart.

Requests authorized by live tool ownership now persist the ownership provenance
on the request artifact:

- `session_ownership_source`
- `tool_ownership_id`
- `tool_ownership_artifact_id`

This fixes the detached-worker boundary found by the independent algorithm
audit: if a request was valid only because a live ownership row existed, the
response side must not re-derive that proof from current live ownership after
the worker has already completed. `cancel_worker` therefore also accepts a
request-bound terminal tool ownership row as stale-close evidence when no
task-scoped `session.status` event exists for that detached session. It closes
the A2A action with `stale_terminal_ownership` and does not write an aborted
session status.

Request replay checks the persisted invocation before resolving current
ownership. New requests still require current ownership. Replayed requests use
the existing request artifact as the durable invocation proof, so a completed
ownership cannot make a replayed worker message fail after restart.

Overlay phase cards keep their attempt-invariant IDs, but now record
`phaseSessionOrderKey` beside `phaseSessionID`. A phase owner can only be
replaced by a timeline-newer session event. `session.status` / `session.error`
updates are applied to a phase card only when the card's current
`phaseSessionID` still matches the status session. Late stale lifecycle events
are discarded instead of mutating the current phase card.

## Verification

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination cancel_worker"`
- `bun test packages/opencorvus/test/engine/agent-coordination.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/agent-coordination.test.ts --test-name-pattern "request and response accept a live tool ownership|request persists, emits"`
- `bun test packages/overlay/test/tree-writer-hierarchy.test.ts --test-name-pattern "phase card ignores stale lifecycle"`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`

During verification, the Windows test fixture exposed a SQLite `EBUSY` cleanup
race when a post-commit/background effect reopened the test database between
`Database.close()` and file removal. `Database.close()` now checkpoints and
truncates the WAL before closing, and the fixture closes the test DB again on
every busy-removal retry before forcing GC and sleeping.

The cancel-worker regression test also exposed an un-awaited
`Bus.publish(SessionStatus.Event.Status, ...)` path. Session lifecycle
publishing is asynchronous because bridge subscribers persist protocol events.
Tests and the cancel recovery projection now await that publish before
expecting durable status rows or resetting the test database.
