# Single Runtime Owner and Phase-Closure Recovery

Status: Implemented and independently reviewed
Date: 2026-08-04
Owner: Codex

## Recall

### User requirement

The operator asked for a deep investigation and then a root repair, independently
validated by another Agent, after a delivery Task reached a valid Integrity
`needs_correction` verdict but could not continue its Base Developer Session,
asked the operator whether to stop, and returned HTTP 404 when the operator
answered.

### Acceptance criteria

- A valid blocking review remains same-Task phase-closure work and can continue
  the exact original worker Session when its frozen runtime projection is still
  available.
- Different backend binaries or runtime projections cannot concurrently own the
  same global OpenCorvus database and recover the same Task.
- A Question interaction is answered by the same physical runtime that owns its
  pending waiter; a second process cannot expose the durable row and then answer
  it against an unrelated in-memory store.
- A local process, provider, projection, or Tool failure is not converted into
  an ordinary user question asking whether work should continue.
- Positive non-User-Interface contracts verify ownership conflict, isolated
  database independence, restart handoff ownership transfer, and the narrowed
  Orchestrator question authority.
- An independent read-only Agent reviews the cause, implementation risks, and
  final verification evidence.

### Hard constraints

- Preserve exact projected worker identity, package revision, model, complete
  system prompt, work scope, workflow occurrence, and Session continuity. Do
  not ignore `projectionHash` or substitute the current projection for history.
- Keep the Orchestrator as semantic scheduler; runtime ownership is a physical
  data-integrity boundary, not a workflow gate or retry policy.
- Use the current database DDL only. Do not add migrations, schema fallback, or
  compatibility readers.
- Do not add, modify, or run User-Interface automation tests.
- Preserve unrelated dirty worktree changes and do not create another worktree.

### Sources read

- `specs/current/architecture/03-control.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-08/2026-08-02-phase-local-build-closure-orchestration.md`
- `specs/records/2026-08/2026-08-03-agent-session-continuation-and-prism-planner.md`
- `specs/records/2026-08/2026-08-03-task-closure-residual-escape-removal.md`
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`
- Task Debug Info, runtime database messages and lineage Artifacts for
  `tsk_fcb998cde001bftZ522Z3zwrY5`
- Packaged sidecar log `2026-08-04T065714-11972-1.log`

### Whole-repository search

The investigation covered `continuation_dispatch_id`, dispatch lineage,
`ProjectedWorkerIdentity`, `WorkerTurnDescriptor`, current projected-agent
resolution, existing-Session runner checks, Question pending ownership,
durable Engine interactions, interaction reply routes, server listen/restart
handoff, managed sidecar ownership, database path ownership, Orchestrator
decision epochs, and the generic versus Orchestrator-specific Question Tool
descriptions.

### Independent Agent feedback

One independent read-only Agent was explicitly requested. It did not delegate
further. It confirmed that strict projected-worker comparison is the correct
fixed-closure boundary; the fault is that ordinary/current-source `serve` does
not participate in managed ownership and can share the packaged sidecar's
global database. It also confirmed that durable interaction rows do not own
Question waiters, which remain process-local, and warned that the unrelated
in-progress dispatch-Turn changes add new persisted-payload structure breaks
without repairing the dual-runtime root cause.

## Proven incident chain

1. Integrity produced valid blocking repair evidence.
2. The Orchestrator selected same-Task Base Developer phase closure.
3. A current-source backend recovered the Task from the same global database
   while the packaged sidecar remained live.
4. The recovered backend projected a different Base Developer identity. The
   lineage resolver correctly refused to present it as the frozen historical
   worker.
5. The Orchestrator misclassified that local runtime fault as an external
   confirmation requirement and opened an ordinary Question.
6. The packaged sidecar exposed the durable interaction row, but its local
   Question store did not own the current-source process's waiter, so reply
   returned `Question request not found`.
7. The Task remained active until the operator explicitly cancelled it.

## Design

### One global database, one physical server runtime

`Database.Path()` is the canonical ownership scope. Every `Server.listen`
caller acquires one process-reentrant `RuntimeServerOwnership` lease before any
server-global service initializes or any listener binds. A different process
or process identity receives a typed conflict containing the canonical database
path and existing owner metadata. It does not bind a listener and cannot run
Task recovery.

Multiple listeners inside the same process may share the lease because they
share the same Question, Permission, Instance, Bus, and database runtime. A
server releases its reference exactly once when stopped; the last listener
releases the filesystem lease.

Development that must run beside a packaged application uses an explicit
isolated `OPENCORVUS_HOME`, producing a different `Database.Path()` and a
different ownership scope. It never shares the production database.

### Restart transfer

The existing restart handoff remains the only replacement protocol. The parent
first quiesces the old listener so no new Task execution can enter, while still
retaining the database runtime lease. It then completes started-Task recovery,
freezes affected Task roots, persists their process-shutdown recovery handoffs,
cancels every process-owned prompt, and waits for those prompt loops to finish.
Only after that durable settlement does it release the runtime lease. A physical bind probe
confirms that Windows has released the socket before the replacement process is
created. The replacement then acquires the same database lease and listener
before it starts Task recovery.

Listener quiescence and runtime-ownership release are separate handoff phases.
A settlement failure occurs only after ingress is closed and leaves the runtime
lease held. Restart restores `Server.listen` and managed ownership before
releasing the Task-root handoff or running recovery in the old process.
If restore succeeds, the old process releases its shutdown handoff and runs the
same started-Task recovery path. If restore cannot reacquire ownership, Task
execution remains frozen and the failure stays explicit. No process may resume
Task execution without first owning the database runtime.

Ordinary shutdown uses the same admission boundary without creating a
replacement: quiesce the listener while retaining the database lease, settle
the complete post-quiescence prompt-owner snapshot, then release runtime and
managed ownership. A settlement failure rejects shutdown and retains ownership
until fail-close process exit; it cannot expose a second runtime while an old
prompt is still executing.

On Windows, the native process supervisor still places ordinary children in a
kill-on-close Job Object, but that Job explicitly permits breakaway. Only the
restart replacement command is marked detached; the native helper creates it
with `CREATE_BREAKAWAY_FROM_JOB` and without assigning a replacement cleanup
Job. Thus closing the old server's supervisor Job cannot kill the new physical
runtime after successful handoff. Portable Operating System Interface (POSIX)
hosts use the corresponding detached process-group launch for the same
replacement-only contract.

### Fixed worker continuation

Projected-worker identity checks remain strict. The only backend allowed to
recover the Task is now the unique runtime owner, so an unrelated binary cannot
take recovery ownership and manufacture a different projection. If a lawful
replacement still cannot reproduce the frozen projection, the typed dispatch
failure must expose stored/current identity evidence and remain local recovery
work; it is not permission to ask the operator whether to continue or to fail
the business Task.

### Orchestrator Question authority

The Orchestrator-specific Question Tool describes only operator-owned missing
authority: credentials or inaccessible facts only the operator can provide,
irreversible/destructive approval, and an irreducible externally meaningful
product choice. Local runtime, process, provider, projected-worker, repository,
or Tool failure must use the named recovery/dispatch/wait/lifecycle surface and
cannot be reframed as a continue-versus-stop question.

## Verification

Completed non-User-Interface evidence:

- Runtime ownership and real cross-process server transfer: 7/7 focused tests
  passed before the final restart-order expansion; the exact ownership subset
  remained green in later focused runs.
- Final restart and shutdown lifecycle group passed 9/9, including 6 real
  Windows handoff tests covering fixed port,
  resolved port zero, durable settlement before replacement creation,
  post-release cleanup failure with successful old-listener restoration, and a
  physically closed listener restored after partial quiesce failure, plus a
  typed listener-release timeout. Managed conflict and parent-exit shutdown
  passed in the same group.
- The settlement-order test uses a real old listener and starts an HTTP request
  after quiescence but before settlement completes. That request resolves only
  from the replacement listener, while the recorded order is exactly
  `listener-quiesced` → `durable-settlement` → `replacement-created`.
- Process settlement: the writer contract proves one owned prompt is cancelled
  and settled while its Task-root handoff stays active, then a recovery wake
  executes after the lifecycle owner explicitly releases that handoff.
- Question and runtime message surfaces: the real pending Question HTTP reply
  resolves its exact waiter and publishes its answered event; App restart
  acceptance, managed serve conflict, and Orchestrator Question-authority
  contracts passed.
- Observable Orchestrator infrastructure flow: `loop-prepare-baseline` passed
  7/7, including exposure of Git infrastructure failure without deciding the
  Task outcome; the real `respond_agent_coordination` redispatch action test
  passed and persisted its visible pending action through the production Tool
  path. The scheduler runtime projection test passed with the explicit rule
  that one audit-to-Build or infrastructure repair failure cannot become a
  continue-or-stop Question or business Task failure.
- Process supervision: 41/41 Shell plus restart tests passed before the final
  lifecycle expansion; native Rust tests and formatting passed.
- `packages/opencorvus` and repository-wide TypeScript typechecks passed.
- `docs:check` passed with 311 operations across 24 groups. After exact staging,
  historical links, product-doc single-source, and document health passed 70/70
  with 1,188 expectations.
- `api:routes-check` remains blocked by a concurrent unrelated dispatch-action
  enum change whose generated OpenAPI removes `continue_worker` while the
  tracked SDK file still contains it. This repair does not regenerate or claim
  that separate API work.

The first independent review confirmed the dual-runtime/Question-waiter root
cause and strict projected-worker identity. Two subsequent reviews found and
then drove closure of restart lifecycle races: replacement recovery before old
prompt settlement, and restore releasing Task handoff before reacquiring the
runtime lease. The final independent result is recorded below after review of
the corrected ordering and failure contracts.

Final independent review approved delivery with no remaining Priority 1 or
Priority 2 findings. It independently ran the managed-serve, runtime-ownership,
and restart-handoff suites: 11/11 passed, including real managed restart,
fixed/port-zero replacement, partial physical-quiesce restoration, and complete
runtime-lease reference release.
