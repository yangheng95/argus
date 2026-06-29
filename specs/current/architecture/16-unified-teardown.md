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
- Structured outputs belong to the shared session runtime. Agent-specific
  finalizer tools are allowed only when they are the actual user-visible
  evidence contract for that agent, not a second hidden state source.
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

Schema-changing work in this unpublished project resets the local database and
rebuilds the schema. Migration scripts and legacy compatibility layers are not
part of the architecture.

## Worktree And Process Cleanup

Worktree deletion is an irreversible filesystem operation and must go through
the owning cleanup path. Cleanup code reads current worktree ownership and
attempt evidence; it must not restore old content with `git reset`, infer state
from stale status columns, or hide failure behind a best-effort branch.

If a task or agent is interrupted, the next orchestrator pass reads the visible
conversation and artifacts, then decides whether to resume, retry, ask, or stop.
Infrastructure may report orphaned resources as facts, but it must not convert
those facts into an automatic workflow transition.

## Section Anchors

Some code comments cite this chapter for the historical migration that removed
old runtime branches. The current meanings are:

- Section 3: shared `SessionLoop` / `SessionPrompt` runtime and structured
  output contract.
- Section 5: artifact-backed evidence and build/verification result storage.
- Section 6: database reset for schema changes and single cleanup ownership for
  worktrees/processes.

These anchors are maintained for source readability only. They are not a
compatibility ledger and do not preserve the deleted pre-June plan.
