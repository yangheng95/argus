# Turn Occurrence Recovery and Status System Repair

Status: Implemented; final independent review in progress
Date: 2026-08-06
Owner: Codex

## Recall

### User requirements

1. Diagnose the message/status-management defects exposed by Task
   `tsk_fd2db26d40013ZSkimoocAQa0g` without treating its last abort or title as
   root-cause evidence.
2. Explain and systemically repair the defects rather than patching the Task
   status or Debug Info presentation.
3. Use independent Agents to review the plan and implementation, then fix the
   accepted findings.

### Acceptance criteria

- Complete the `redispatch_worker -> dispatch_agent` cutover so a coordination
  Turn releases its prompt owner and runtime before the successor Turn begins.
- Preserve exact Worker Turn, dispatch, workflow, lifecycle-event, and process
  occurrence authority across graceful backend shutdown and restart.
- Keep reusable Session current activity separate from append-only Turn and
  interruption history; a later successful Turn must not erase earlier durable
  failures.
- Project one physical shutdown occurrence with its complete affected
  Session/dispatch set, recovery fact, and successor evidence instead of
  presenting one uncorrelated abort incident per Session.
- Report Task activity separately from authoritative completion. A running
  Task must not appear 100 percent complete merely because it is active.
- Preserve natural Orchestrator decisions. Do not add a Host workflow gate,
  retry router, state machine, keyword classifier, fallback, or compatibility
  reader.
- Verify non-User-Interface contracts with positive tests. Verify Overlay
  presentation only through a real page, interaction, screenshot, and direct
  visual review; do not add, modify, or run User-Interface automation tests.
- Perform final independent read-only review, commit with the `dsw-33987`
  prefix, and push the main delivery branch to `git-cc` remote `myhexin`.

### Hard constraints

- `WorkerTurnDescriptor` and immutable dispatch lineage remain the sole Worker
  Turn and dispatch authority. New projections may reference them but must not
  copy them into a second authority.
- Process occurrence evidence is owned only by the managed sidecar supervisor;
  Queue consumes an exact locator and does not classify an unobserved exit.
- `prompt_profile.active` and existing Expert Squad workflow bindings remain
  unchanged.
- No database migration, implicit patch, compatibility payload reader, or
  automatic reset. Tests and benchmarks use isolated fresh databases. The
  current operator database is read-only evidence unless the user separately
  authorizes a maintenance reset.
- No new worktree, destructive Git command, User-Interface automated test, or
  negative test.
- Existing uncommitted changes in `packages/overlay/src-tauri/src/main.rs` and
  the managed-backend early-exit diagnostic record belong to another active
  change. This repair must preserve them and must not stage them as its own.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`
- `specs/records/2026-08/2026-08-05-contract-graph-and-goal-fact-projection-system-repair-plan.md`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/agent/worker-turn-descriptor.ts`
- `packages/opencorvus/src/agent/dispatch-outcome.ts`
- `packages/opencorvus/src/orchestrator/dispatch-turn-projection.ts`
- `packages/opencorvus/src/session/status.ts`
- `packages/opencorvus/src/session/status-publication.ts`
- `packages/opencorvus/src/engine/queue.ts`
- `packages/opencorvus/src/orchestrator/task-event.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/status/task-status-snapshot.ts`
- `packages/overlay/src/utils/debug-info.ts`

### Repository and incident evidence

Repository search covered coordination handoff cleanup, prompt-generation
ownership, runtime-contract replacement, Worker Turn descriptors, dispatch
lineage, process-shutdown recovery facts, Session lifecycle publication,
Agent-invocation projection, process incidents, Task activity progress, Debug
Info, and their focused tests.

The incident database and server logs establish this causal sequence:

1. A Research Studio worker produced a coordination handoff.
2. `completeProjectedWorkerTurn` published `idle` and returned without settling
   the prompt owner or disposing the installed runtime contract.
3. The successor continuation claimed a runtime-free message-write boundary
   and failed with `SessionRuntimeContract changed before message commit`.
4. Three explicit `http.shutdown` requests interrupted parent and worker
   Sessions in pairs, producing six downstream `MessageAbortedError` events.
5. Recovery facts retained affected Session identities but not the exact
   committed dispatch/workflow occurrences. One retry reused a stale source
   dispatch and failed `continuation source dispatch does not match`.
6. The same reusable Session later completed. Latest-Session projection hid
   both durable intermediate failures, while `taskProcessIncidents` displayed
   only the six generic `session.error` abort symptoms.

The current non-User-Interface test
`runner-terminal-prompt-owner.test.ts` still asserts that coordination handoff
retains both the prompt owner and runtime. That expectation belongs to the
deleted direct-continuation paradigm and conflicts with the accepted
`redispatch_worker -> dispatch_agent` successor contract.

### Independent Agent feedback

Three one-level read-only reviewers audited runtime/continuation,
recovery/process occurrence, and status/projection boundaries. They did not
modify files or delegate.

- The runtime reviewer conditionally accepted the proven handoff leak but
  rejected a two-call cleanup patch. The obsolete
  `ProjectedWorkerExecutionAdapter.continueSession` Application Binary
  Interface and its current-architecture text must be deleted with the stale
  owner-retention test. Coordination, completion, failure, interruption, and
  cancellation must use one physical Turn settlement boundary. Failure to
  release prompt/runtime identity cannot be logged and swallowed as success.
- The recovery reviewer rejected Session-only handoff facts. Graceful shutdown
  currently writes the weak handoff, then rewrites the parent open
  `dispatch_agent` Tool Part as a generic error; abrupt recovery separately
  preserves lineage. Both paths must use one lineage-bearing interruption
  resolver. The recovery wake must continue carrying only the recovery fact ID;
  Task description must strictly read that fact by ID and render its exact
  anchors rather than copying them into a second wake payload.
- The projection reviewer rejected WorkerTurnDescriptor as a universal
  occurrence identity because Orchestrator, Mission, and ordinary assistant
  executions do not own one, and one prompt generation may produce multiple
  assistant messages. A uniform prompt-generation occurrence must precede
  projection repair. Session topology and execution history must remain
  separate, while Board, status, conversation, and Debug surfaces consume one
  Task execution projection.
- The reviewers identified existing negative tests in the touched runner,
  recovery, Session-status, and Task-event paths. Those tests cannot be reused
  as acceptance evidence. They must be deleted or rewritten around complete
  positive outputs. They also identified Overlay Debug/status source and
  rendering tests as prohibited User-Interface automation; touched tests must
  be deleted without running them.

The bounded follow-up accepted the converged occurrence anchor with these
mandatory boundaries:

- the globally unique `input_message_id` is the occurrence identity; Session
  identity is a validated relation, not half of a second composite ID;
- occurrence start is the actual selected durable input message, not prompt
  owner acquisition, because one standby owner may process multiple wake
  messages;
- every projected WorkerTurnDescriptor must carry one required message
  authority even when no DispatchTurn exists; DispatchTurn may reference it
  but cannot own a second copy;
- newborn/pre-commit Sessions are preparation facts, not executions;
- direct runtime continuation deletion and unified settlement are accepted;
- recovery is accepted after adding the strict precommit-Session variant.

The reviewed design is accepted for implementation.

## Single-source repair model

### Execution occurrence authority

One prompt generation is anchored by the globally unique exact durable input
user-message ID. Its Session and Task identities are validated relations, not a
second composite occurrence identity. The input message is created once before
the generation starts and remains the common authority for Orchestrator,
Mission, ordinary assistant, and projected Worker execution. Multiple
assistant messages produced inside the same generation reference that same
input occurrence.

Occurrence start is published only after SessionLoop selects the actual durable
input message. Prompt owner acquisition alone does not start an occurrence; one
standby owner can process more than one wake message.

Projected Workers additionally bind the occurrence through
one required `WorkerTurnDescriptor.messageAuthority.user_message_id`.
`DispatchTurn` references that canonical descriptor authority rather than
owning a second optional copy. The descriptor and immutable `DispatchTurn`
remain the sole projected Worker
configuration and dispatch authority; the occurrence fact references their
identities and never copies their payload into another authority.

A failure before a new input message commit has no durable execution
occurrence. Recovery represents a created-only Session as
`affected_created_session`, and a prepared Worker as the distinct
`affected_prepared_worker_turn` variant carrying its exact descriptor and
dispatch lineage. Neither variant fabricates a message occurrence. A failure
after the input message commit is an `affected_execution` bound to that exact
input message. A caller-side failure belongs to the exact Tool execution or
committed dispatch fact that exists at that cut.

### Worker Turn authority

`WorkerTurnDescriptor` plus its immutable `DispatchTurn` remains the sole
authority for a projected Worker Turn. Coordination, completion, failure, and
interruption settle the current physical prompt/runtime ownership. A later
continuation creates a successor descriptor and installs a new runtime only
after the authority bundle commits.

### Lifecycle fact authority

Durable lifecycle facts reference the exact execution occurrence. They do not
make Session identity synonymous with one invocation. Current Session activity,
Turn history, incident history, and Task Board summaries are projections of the
same facts for different questions; none is a second writer.

### Process occurrence authority

The managed sidecar supervisor records the physical process occurrence and
shutdown source. The replacement backend references that evidence while
persisting one Task recovery fact containing the complete affected
Session/descriptor/dispatch/workflow set. Unmanaged or unobserved exits retain
an explicit unknown physical cause.

## Implementation batches

### Batch 1 - coordination Turn ownership convergence

- Replace the coordination-only early return and the current cleanup helpers
  with one physical Worker Turn settlement boundary used by coordination,
  completion, failure, interruption, and cancellation while preserving the
  correct durable outcome fact.
- Return a typed infrastructure failure with exact occurrence/descriptor/
  dispatch references when prompt or runtime identity release fails. Resource
  close failure after identity release remains separate infrastructure
  evidence and does not rewrite the real Turn result.
- Delete `ProjectedWorkerExecutionAdapter.continueSession`,
  `ProjectedWorkerContinuationTurn`, their fixtures/tests, and the current
  architecture text that still describes direct runtime continuation.
- Remove the stale test that treats retained prompt/runtime ownership as the
  positive contract.
- Add one positive real-run contract that completes a coordination Turn and
  then a same-Session redispatch successor with exact descriptor and dispatch
  lineage evidence.

### Batch 2 - exact shutdown recovery occurrence

- Project each process-owned subject through a strict union: an
  `affected_execution` with Session and durable input-message identity, an
  `affected_created_session` with only Session creation identity, or an
  `affected_prepared_worker_turn` with mandatory descriptor and dispatch
  lineage but no fabricated execution identity.
- Resolve each committed projected Worker execution to its latest compatible
  WorkerTurnDescriptor and exact dispatch-lineage locator during shutdown
  settlement; parse and cross-check dispatch/workflow fields from those sole
  authorities instead of copying them into the recovery fact.
- Persist one recovery fact per Task and interruption occurrence with the
  complete affected set and optional exact predecessor process-evidence
  locator.
- Project that exact authority into the recovery wake so the Orchestrator does
  not rediscover the current lineage by search or reuse an older dispatch.
- Extend infrastructure failure outcomes with exact available occurrence
  authority rather than error text inference.

### Batch 3 - occurrence-aware lifecycle and current activity

- Bind durable worker lifecycle publication to the exact descriptor/current
  input message/dispatch occurrence already committed for that Turn.
- Preserve Session current activity as a latest projection while separately
  projecting append-only Turn occurrence history.
- Rename the current one-node-per-Session graph surface to Session invocation
  topology and expose Turn occurrences explicitly; do not call a reusable
  Session node one invocation.

### Batch 4 - incident and Task status projection

- Build incidents from canonical failure/interruption occurrence facts rather
  than the `session.error` event type alone.
- Link affected parent/worker Turns, process evidence, recovery fact, and
  successor dispatch without erasing the original incident.
- Separate activity counts from authoritative completion. Remove the current
  running-ratio percentage; expose completion only from an explicit workflow
  or Goal delivery contract.
- Derive Board summary text from current prompt/Turn/coordination facts so an
  actively executing dispatch is not described as waiting for a scheduler
  decision.

### Batch 5 - managed process occurrence observability

- Complete the already-designed supervisor-owned atomic running/exited process
  envelope and predecessor handoff without overlapping the separate uncommitted
  early-exit diagnostic change.
- Bind replacement-process recovery facts to the exact predecessor envelope.
- Preserve the shutdown caller/source when known and explicit unknown cause
  otherwise.

### Batch 6 - verification and independent closure

- Run focused positive non-User-Interface contracts for Worker Turn ownership,
  same-Session redispatch, process recovery crash cuts, occurrence projection,
  incident aggregation, and Task activity/completion semantics.
- Run package and repository typecheck, API route agreement, documentation
  health, and diff checks required by the touched surfaces.
- Exercise a real streamed Task with an isolated fresh database, interrupt the
  managed backend at controlled points, and inspect durable protocol,
  descriptor, lineage, recovery, and Board evidence.
- Open the real Overlay page, inspect Debug Info and status presentation, take
  task-bound screenshots, and directly review them. Do not create or run a
  repeatable User-Interface assertion.
- Obtain final independent read-only diff and evidence reviews. Resolve every
  blocker/high/medium finding before commit and push.

## Outcome

Implementation and verification are complete. Three independent read-only
reviewers accepted the final recovery, runtime, and projection design without
remaining blocker, high, or medium findings.

Implemented evidence:

- `inputMessageID` is now the durable execution-occurrence identity in the
  lifecycle event, Task execution projection, conversation hydrate/live store,
  Tree Writer ownership, Agent rail focus, Board incidents, status snapshot,
  and Debug Info. Session topology remains a separate graph.
- Worker descriptors require exact user-message authority. Coordination,
  completion, error, cancellation, and interruption converge on one physical
  Worker Turn settlement boundary; the obsolete direct-continuation runtime
  interface and its stale tests are deleted.
- Cross-worktree lifecycle publication now routes through the durable Session
  to its canonical host project and waits for cross-instance protocol
  persistence before the worker returns. A positive contract proves a Build
  worktree terminal fact and two successive occurrences on one Session.
- The supervisor writes schema-v2 atomic process envelopes containing exact
  predecessor, observation, executable/build, log, shutdown source, exit code
  or signal, and terminal time. Recovery consumes only the exact locator handed
  to the replacement process; unmanaged processes retain an explicit unknown
  physical cause.
- Recovery facts use the strict created/prepared/execution subject union and
  store the complete affected set once per Task/process occurrence. An older
  ordinary wake drains first and the exact recovery wake remains queued rather
  than being suppressed.
- Task activity counts no longer masquerade as completion percentage. Recovery
  incidents remain visible beside a later completed occurrence, while generic
  Session errors covered by the recovery fact are grouped under that process
  occurrence.
- Prohibited Overlay source/DOM/snapshot tests found in the touched paths were
  deleted without execution. The real Overlay was opened against an isolated
  fresh database, a Task was selected, and its terminal failure presentation
  was visually inspected from a live screenshot.

Final verification evidence:

- The isolated streamed Task `tsk_fd65b565a001wdBFoCGoZIupkz` reached the
  authoritative `failed` terminal state for a typed provider/model error. Its
  real Overlay projection showed the matching Task title, `Failed` label,
  canonical project directory, and online connection. The reviewed screenshot
  is `.tmp/turn-status-overlay-qa.png`; this is a one-time visual artifact, not
  an automated User-Interface test or baseline.
- Focused contracts passed for Session prompt hydration (15 tests, 81
  assertions), coding/project promotion (23 tests, 149 assertions), the core
  occurrence batch (44 tests, 203 assertions), Task conversation routes (24
  tests, 190 assertions), protocol bridge (8 tests), and the positive transient
  rename contention scenario (1 test, 12 assertions). One parallel native
  process-supervisor collision was isolated to peer cleanup; the affected
  Session contract then passed standalone with 15 tests and 81 assertions.
- OpenCorvus and Overlay typechecks passed. The generated JavaScript Software
  Development Kit typecheck and build passed. Rust formatting and compilation
  checks passed. API route agreement passed all 6 rules across 33 files.
  Documentation checks passed 311 operations across 24 groups; historical link
  health passed 2 tests, and standalone document health passed 60 tests with
  1,134 assertions.
- The recovery reviewer, runtime reviewer, and projection reviewer each issued
  a final `ACCEPT`. The projection review's initial findings were resolved by
  removing Session-latest lookup fallbacks, deleting prohibited negative tests,
  and proving the real atomic rename succeeds after typed transient contention.
