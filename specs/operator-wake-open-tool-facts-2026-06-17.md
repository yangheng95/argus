# Operator Wake Open Tool Facts - 2026-06-17

## Problem

The `resume` failure surfaced a task shape that was not covered by the existing
owner-orphan facts:

- The task is still active.
- `activeSessions=[]` after the sidecar process restarted.
- The task root session tree contains an assistant tool part with
  `state.status` in `pending` or `running`.
- No `run` / `goal_run` may exist yet, so `run_orphan` and
  `GoalDesc.is_orphaned` have nothing to project.

The incorrect 2026-06-17 attempt extended startup convergence to fail such
tasks. That was the wrong boundary: it made the host decide task lifecycle from
an open tool part and bypassed the orchestrator LLM's next real wake.

## Call-Site Audit

Command:

```powershell
rg "appendAndWakeTaskOperatorMessage|reopenActiveRunForOperatorWake|dispatchTaskLoop|interrupt: true|recordOrchestratorSessionErrorEnvelope|recordOrchestratorStreamError|recent_stream_failures|recent_agent_failures|recent_tool_execute_failures|toModelMessages|Session.treeInProject|Message.parts|PartTable" packages/opencorvus/src packages/opencorvus/test -n
```

Relevant findings:

| Area | Evidence | Decision |
| --- | --- | --- |
| Operator wake | `task-api/index.ts::appendAndWakeTaskOperatorMessage` persists a real user message, reopens stale blocked runs, then calls `dispatchTaskLoop(... interrupt: true)`. | Keep. This is the natural wake boundary. |
| Task loop | `orchestrator/loop.ts` runs one orchestrator decision pass and explicitly does not synthesize state-machine reactions. | Keep. Do not add queue gates. |
| Orchestrator stream failures | `orchestrator/agent.ts::recordOrchestratorSessionErrorEnvelope` writes `orchestrator-stream-error`; `describe.ts` renders it for the next wake. | Reuse the pattern conceptually: facts in describe, LLM decides. |
| Existing orphan facts | `goal-status.ts`, `workflow.ts`, and `describe.ts` already project owner-orphan goal/run facts without forcing redispatch. | Keep. The missing case is run-less open tool parts. |
| Message replay | `session/message.ts::toModelMessages` only replays completed/error tool parts. Pending/running tool parts are not provider-visible content. | Do not mutate message history to fabricate tool results. Surface the fact in describe instead. |
| Startup convergence | `engine/writer.ts::convergeDeadOwnerLiveExecution` handles live goal attempts by owner death. | Do not extend it to run-less open tool parts; that was the rejected hard-rule path. |

## Fix

1. Add a read-only describe projection for task-owned open tool calls that have
   no current-process session owner:
   - walk the task root session tree;
   - read persisted `part` rows whose type is `tool` and whose state is not
     `completed` / `error`;
   - exclude rows whose session currently has `SessionStatus` `streaming` or
     `retry`;
   - return session id, session kind, message id, part id, tool name, call id,
     persisted status, and timestamp.

2. Render those facts in `renderTaskDescription` as execution evidence:
   - state that the previous tool call has no current-process owner and no
     terminal tool result;
   - tell the orchestrator to decide from the evidence (`retry_task`,
     re-dispatch the relevant tool, `restart_from_stage`, `fail_task`, or ask
     the operator), without prescribing one path.

3. Do not change task/run/goal status from this projection.

4. Keep the rejected startup convergence extension reverted.

## Acceptance

- A task with a root/orchestrator session containing a `running` tool part and
  no current `SessionStatus` owner renders an "open tool call without current
  process owner" section in `renderTaskDescription`.
- The same shape with current-process `SessionStatus.streaming` does not render
  that stale-owner section.
- `describeTask` does not mutate `engine_task`, `engine_artifact`, `session`,
  `message`, or `part` rows.
- The startup convergence path does not fail run-less active tasks merely
  because they contain open tool parts.
