# Task lineage terminal notification — 2026-06-07

## Requirement

- When a child engine task reaches a terminal status, notify its parent task with a real task message so the parent orchestrator can resume.
- When a mission-owned task reaches a terminal status, notify the mission session with a real wake message.
- Superseded on 2026-06-26 by `specs/records/2026-06/2026-06-26-mission-task-parallel-subtasks.md`: a mission or parent task may create multiple independent child engine tasks. Dependent child work must queue behind its prerequisite instead of starting in parallel.

## Call-point inventory

| Surface                         | File                                                                                       | Decision                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Task terminal writes            | `packages/opencorvus/src/engine/state.ts`                                                  | Single notification trigger, because all completed/failed/cancelled task transitions pass through `updateTask`.   |
| Direct task creation            | `packages/opencorvus/src/task-api/index.ts`                                                | No mission/parent owner-wide serialization; channel/request idempotency remains the duplicate-ingress protection. |
| Mission task creation           | `packages/opencorvus/src/tool/panel.ts`                                                    | Keep provenance owner as `metadata.mission.session_id`; no separate lock here.                                    |
| Orchestrator follow-up creation | `packages/opencorvus/src/orchestrator/tools.ts`                                            | Keep parent owner as `metadata.parent_task_id`; no separate lock here.                                            |
| Parent task lineage read        | `packages/opencorvus/src/engine/store.ts`                                                  | Keep `metadata.parent_task_id` as single source.                                                                  |
| Mission task lineage read       | `packages/opencorvus/src/engine/store.ts` and `packages/opencorvus/src/mission/session.ts` | Keep `metadata.mission.{id,session_id}` as single source.                                                         |
| Generic subagent tool prompt    | `packages/opencorvus/src/tool/task.txt`                                                    | Keep dependency-aware parallel-agent guidance.                                                                    |
| Mission prompt                  | `packages/opencorvus/src/prompt/core/mission-core.txt`                                     | Permit multiple independent `create_task` calls; dependent work queues or waits for prerequisite completion.      |

## Implementation notes

- Notification uses existing natural message paths:
  - parent task: `EngineService.handleTaskMessage`, which appends a user message and wakes the task loop.
  - mission: `SessionWake.wake`, which appends a user message and wakes the mission session.
- No schema column is added. Parent and mission ownership remain JSON metadata single sources.
- The creation lock is process-local only for channel binding duplicate ingress. Mission/task dependency ordering is model-visible planning: independent children may run in parallel; dependent children must queue or wait.
