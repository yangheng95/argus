# Operator Message Add Goal Dispatch

Date: 2026-06-09

## Problem

Follow-up operator messages are already persisted as real task conversation
messages and wake the Orchestrator for active/failed tasks. Two gaps remain:

- A completed task currently records a follow-up message but does not wake the
  Orchestrator, even though the Orchestrator prompt treats terminal history as
  baseline evidence rather than context deletion.
- The Orchestrator has `modify_goal` for point contract repair and `architect`
  for full decomposition, but no direct tool for the common case where a new
  operator instruction adds one concrete goal to the current sealed graph. That
  pushes the model toward prose, unnecessary architect reruns, or scope escape.

## Call-Point Audit

Full-repo grep targets before implementation:

| Surface                                                                                        | Evidence                                                                                                                                | Decision                                                                                                   |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `EngineService.handleTaskMessage` / `continueTaskMessage` / `appendAndWakeTaskOperatorMessage` | Single task-message entry path records natural operator notes and dispatches `runTaskLoop`. Completed tasks early-return without wake.  | Reactivate completed tasks on follow-up messages; keep cancelled tasks terminal.                           |
| `orchestrator/agent.ts` `OrchestratorEvent.operatorMessage`                                    | Passes the new user text to tools and prompt; no host-side intent classifier.                                                           | Leave intact; the LLM decides whether the message needs a new goal.                                        |
| `orchestrator/tools.ts` `modify_goal`                                                          | Point-fix only; description forbids adding capability/scope.                                                                            | Add sibling `add_goal` for concrete new-scope goals.                                                       |
| `engine/persist.ts` `insertGoalRows` / `upsertGoalsFromArchitect`                              | Existing goal-row writers. `insertGoalRows` starts order at zero and is for batch plans; `upsertGoalsFromArchitect` is architect-owned. | Add `appendGoalToActiveGraph` as the single append writer.                                                 |
| `createExecutionRunRecord` / `build({ goalID })`                                               | Build creates/activates a run from the active plan and validates active spec/dependencies.                                              | New goal must attach to the active plan node when one exists so it can be dispatched normally.             |
| `prompt/core/orchestrator-core.txt`                                                            | Single source of Orchestrator decision discipline.                                                                                      | Tell the Orchestrator to use `add_goal` for a concrete new operator instruction inside current task scope. |

## Change

- Add an append-only goal writer that inserts a new `engine_goal`, attaches it to
  the active plan when present, and creates the matching plan node/dependency
  edges from the current goal graph.
- Add Orchestrator `add_goal`, schema-backed by the existing goal contract
  schema, for new operator instructions that expand the current task by one
  concrete buildable goal.
- Reactivate completed tasks on new operator messages so the Orchestrator can
  schedule follow-up goals in the same visible task conversation. Cancelled
  tasks remain terminal and only record the message.

This is not a host-side route gate: the message path still records natural
operator text and wakes the Orchestrator. The Orchestrator chooses `add_goal`,
`modify_goal`, `architect`, `propose_task`, or another tool from current
evidence.
