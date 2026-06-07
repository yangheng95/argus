# Goal Dispatch Visible Process Fix

Date: 2026-06-05

## Evidence

Live task `tsk_e975973ab001NqYoiU26S6v0hq` looked active in the overlay, but its
goal strip stayed at `0/5` and every goal stayed `pending`.

Project-scoped HTTP and read-only SQLite probes showed:

- `engine_artifact` contained only `frontend_research_brief` and
  `architect_contract_graph`.
- `engine_artifact[kind='run']` was empty.
- `engine_artifact[kind='goal_run_attempt']` was empty.
- `engine_artifact[kind='orchestrator-stream-error']` was empty.
- The operator note `卡住了吗` woke the orchestrator, and the orchestrator
  assistant message ended with `finish='stop'`, no tool calls.
- That assistant text claimed a follow-up implementation task had been created
  and asked the user whether to start it, but no `propose_task` tool call or
  follow-up task row existed.

The process was invisible because there was no goal execution process to show.
The orchestrator stopped with plain text instead of dispatching real work.

## Root Cause

This is an orchestrator prompt discipline failure. The model treated a status
question as permission to narrate progress and ask for confirmation, then
fabricated a follow-up task fact in text. The existing prompt forbids workflow
bypass and passive plain text after non-pass integrity, but it did not pin the
broader invariant that process facts must come from tools/artifacts and that an
active workflow with pending goals and no run must continue through real
dispatch, not a status reply.

Per rule 6.1, this should be fixed in prompt/tool discipline rather than by
adding a host-side state gate that auto-dispatches goals.

## Call-Point Audit

Relevant call sites and sources searched before changing prompt text:

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Single source of orchestrator decision discipline. | Add explicit process-fact and pending-goal dispatch invariant. |
| `packages/opencorvus/src/orchestrator/loop.ts` | Single-pass loop, no host auto-rewake by design. | Leave unchanged; do not add state-machine dispatch. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Persists real orchestrator messages and tool calls. | Leave unchanged; the issue was a valid `finish='stop'` model choice. |
| `packages/opencorvus/src/orchestrator/tools.ts` | `build` and `propose_task` are the real mutation surfaces. | Leave unchanged; no tool was called in the bad wake. |
| `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` | Current prompt text regression tests. | Add assertions for the new invariant. |

## Fix

Add a prompt-only invariant:

- Do not claim a task, subtask, run, goal attempt, tool result, file change,
  checkpoint, push, or review exists unless the current task record or a tool
  result proves it.
- If the next action is to create follow-up work, call `propose_task`; do not
  say it was created.
- If an active workflow has pending goals, no active build, no terminal
  integrity verdict, and no external blocker, do not answer with only status
  text or ask whether to proceed. Dispatch `build({ goalID })` for the first
  eligible pending goal or dispatch the smallest real tool needed before build.

