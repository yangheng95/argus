# 16 — Minimal Session Runtime Contract

This chapter is the current architecture contract for the session runtime. The
deleted pre-June teardown plan is not retained as a spec file; references to
that older work must stay as natural-language lineage only.

## Current Contract

OpenCorvus task execution is a conversation-led system:

1. User and operator input enter a visible session.
2. The orchestrator reads the conversation, artifacts, task board, and evidence.
3. Specialist agents run as real agent sessions with their own tools and
   reasoning loops.
4. The orchestrator decides the next action from visible evidence, not from a
   hard-coded state transition table.

The runtime must not reintroduce host-side route gates, retry state machines,
compatibility branches, hidden synthetic messages, or fallback execution paths.

## Runtime Surface

- `SessionLoop` and `SessionPrompt` are the shared execution substrate.
- Specialist surfaces may be invoked through orchestrator tools, but the tool
  boundary must open a real child agent session rather than collapse the
  specialist into a plain function.
- Domain tools may incrementally record typed artifacts. They never finalize a
  Session or gate facts already produced in that Session.
- Stream errors, tool results, interactions, and terminal status must surface in
  the same visible message/event flow consumed by the overlay.

## Orchestrator Ownership

The orchestrator owns global task coordination. Sub-agents own their assigned
scope and evidence, but they do not own cross-goal scheduling, task completion,
or operator-facing truth.

Allowed coordination facts:

- persisted session messages and tool results
- `engine_artifact` records
- task board projections
- explicit operator interactions
- worktree ownership records

Disallowed coordination mechanisms:

- status enums that encode a fixed workflow
- route or middleware branches that decide which agent should run
- automatic retry policies that bypass the orchestrator's visible reasoning
- hidden messages that only the model or only the UI can see
- compatibility reads that silently accept old payload shapes

Targeted sub-agent operator steer is not task-root operator input and is not a
child-session direct reply. It enters through
`EngineService.operatorSteerAgentSession(...)` /
`POST /task/:taskID/session/:sessionID/operator-steer`, writes an
`origin="operator_steer"` durable coordination request, and wakes the
orchestrator to decide the visible action through the existing coordination
request/response/action chain.

## Evidence And Storage

`engine_artifact` is the durable evidence surface for run attempts, build
outcomes, verification evidence, integrity attempts, and coordination records.
Task and goal views are projections over current records; they are not second
truth sources.

The current complete DDL is the only final physical SQLite schema. An empty
database is created transactionally from that DDL. A non-empty database whose
complete table, constraint, index, trigger, virtual-table, and generated
shadow-object fingerprint equals the current DDL opens directly. An exact
historical fingerprint may advance only through the repository's ordered,
single-direction migration registry. Before any mutation, OpenCorvus copies
the DB, Write-Ahead Log (WAL), and Shared Memory (SHM) files to a
checksum-manifested maintenance backup while exclusive ownership and the
read-only inspection connection keep the original file set stable. It then
closes that connection before reopening for migration. The complete
migration chain runs under one immediate transaction and commits only after
the resulting schema exactly equals the current DDL, foreign keys have no
violations, and SQLite integrity is `ok`.

There is no inferred same-column row copier, compatibility reader, stale-schema
fallback, automatic reset, schema-refresh projection, or second active
database source. Unknown drift fails closed as typed
`SCHEMA_MIGRATION_REQUIRED` without modifying the database. A schema-changing
release must register and positively test its exact predecessor transition in
the same commit. Explicit reset remains a separately authorized operation for
discarded or structurally damaged data, not a normal release boundary.

Exact persisted Chat/Work session list, claim, and transcript hydration reads
require canonical project identity and SQLite storage, but do not require
runtime package or Task Artifact recovery. Those GET routes remain readable
when strict runtime bootstrap rejects missing execution evidence. Mutations,
prompts, event streams, Task Artifact access, Agent access, and execution
continue to require full runtime bootstrap; the read boundary must not accept,
fabricate, or rewrite missing runtime resources.

## Worktree And Process Cleanup

Worktree deletion is an irreversible filesystem operation and must go through
the owning cleanup path. Cleanup code reads current worktree ownership and
attempt evidence; it must not restore old content with `git reset`, infer state
from stale status columns, or hide failure behind a best-effort branch.

If a task or agent is interrupted, the next orchestrator pass reads the visible
conversation and artifacts, then decides whether to resume, retry, ask, or stop.
Infrastructure may report orphaned resources as facts, but it must not convert
those facts into an automatic workflow transition.

Projected worker teardown resolves the immutable `dispatch_agent` lineage edge
to one exact child Session. Cancellation succeeds only when the current process
owns that Session's actual `SessionPromptState` controller; missing physical
ownership is reported without mutating historical outcomes. It must not
synthesize a terminal Session status, reconstruct execution from persisted
status rows, or poll for evidence created by its own fallback. A late producer
result after an authoritative cancellation is an idempotent observation of the
already recorded cancellation fact, not a competing completion.

## Section Anchors

Some code comments cite this chapter for the historical migration that removed
old runtime branches. The current meanings are:

- Section 3: shared `SessionLoop` / `SessionPrompt` runtime and structured
  output contract.
- Section 5: artifact-backed evidence and build/verification result storage.
- Section 6: transactional database migration and single cleanup ownership for
  worktrees/processes.

These anchors are maintained for source readability only. They are not a
compatibility ledger and do not preserve the deleted pre-June plan.
