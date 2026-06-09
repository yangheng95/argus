# Task lineage terminal notification — 2026-06-07

## Requirement

- When a child engine task reaches a terminal status, notify its parent task with a real task message so the parent orchestrator can resume.
- When a mission-owned task reaches a terminal status, notify the mission session with a real wake message.
- A single mission or parent task may create only one new engine task at a time. Creation must be serialized by the source owner, not left to parallel tool calls.

## Call-point inventory

| Surface                         | File                                                                                       | Decision                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Task terminal writes            | `packages/opencorvus/src/engine/state.ts`                                                  | Single notification trigger, because all completed/failed/cancelled task transitions pass through `updateTask`. |
| Direct task creation            | `packages/opencorvus/src/task-api/index.ts`                                                | Serialize `EngineService.createTask` by mission session or parent task metadata.                                |
| Mission task creation           | `packages/opencorvus/src/tool/panel.ts`                                                    | Keep provenance owner as `metadata.mission.session_id`; no separate lock here.                                  |
| Orchestrator follow-up creation | `packages/opencorvus/src/orchestrator/tools.ts`                                            | Keep parent owner as `metadata.parent_task_id`; no separate lock here.                                          |
| Parent task lineage read        | `packages/opencorvus/src/engine/store.ts`                                                  | Keep `metadata.parent_task_id` as single source.                                                                |
| Mission task lineage read       | `packages/opencorvus/src/engine/store.ts` and `packages/opencorvus/src/mission/session.ts` | Keep `metadata.mission.{id,session_id}` as single source.                                                       |
| Generic subagent tool prompt    | `packages/opencorvus/src/tool/task.txt`                                                    | Replace parallel-agent guidance with one new task per parent turn.                                              |
| Mission prompt                  | `packages/opencorvus/src/prompt/core/mission-core.txt`                                     | Replace split/parallel language with one `create_task` per wake.                                                |

## Implementation notes

- Notification uses existing natural message paths:
  - parent task: `EngineService.handleTaskMessage`, which appends a user message and wakes the task loop.
  - mission: `SessionWake.wake`, which appends a user message and wakes the mission session.
- No schema column is added. Parent and mission ownership remain JSON metadata single sources.
- The creation lock is process-local and keyed by the owner that is already persisted on the task creation input. It protects concurrent tool executions in the same process; persisted request IDs and DB uniqueness still own idempotency.
