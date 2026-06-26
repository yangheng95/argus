# Mission And Task Parallel Subtasks (2026-06-26)

## Requirement

- Mission and task-owned child work may fan out into multiple engine tasks when the child scopes are independent.
- Parallel child tasks are allowed only when no child depends on another child's output, artifact, decision, or owned files.
- Dependent child work must be queued behind the prerequisite: keep it in Mission frontier/handoff until the prerequisite is terminal, or set the task queue flag only when a visible queued task record is explicitly needed.
- Remove owner-wide "one child task" restrictions for Mission and task follow-up creation. Keep channel/request idempotency protections because they prevent duplicate ingress, not dependency scheduling.

## Call-point inventory

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `packages/opencorvus/src/prompt/core/mission-core.txt` | Says Mission dispatches one task per wake and never issues multiple `create_task` calls. | Permit multiple `create_task` calls in one wake only for independent scopes; require dependent scopes to remain queued in mission state or use `queue=true` when a visible queued record is needed. |
| `packages/opencorvus/src/orchestrator/tools.ts` `propose_task` description | Says each parent task can create at most one inheriting child task. | Permit multiple child tasks from the same parent when independent; require dependent child work to queue/wait instead of starting in parallel. |
| `packages/opencorvus/src/orchestrator/tools.ts` `propose_task` execution | Rejects if `findChildrenOfTask(parent)` returns any child. | Remove the existing-child rejection; keep `metadata.parent_task_id` as lineage. |
| `packages/opencorvus/src/engine/task-creation-owner.ts` | Serializes createTask calls by `metadata.mission.session_id` and `metadata.parent_task_id`. | Stop owner-wide serialization for mission/task lineage; keep channel binding serialization only. |
| `packages/opencorvus/test/**` | Tests pin one-task-per-wake and one-child descriptions plus owner serialization. | Update assertions and add regression coverage for a second independent child task. |
| `specs/task-lineage-terminal-notification-2026-06-07.md` | Historical plan says mission/parent task may create only one new task at a time. | Mark that creation restriction superseded by dependency-aware parallelism while preserving terminal notification lineage. |

## Acceptance

- Mission prompt contains the no-dependency-only parallel rule and no longer pins one task per wake.
- `propose_task` tool description no longer pins one inheriting child per parent.
- `propose_task` can create an independent child even when the parent already has a child task.
- `taskCreationOwnerKeys` does not return mission or parent-task keys; channel binding remains serialized.
- Targeted tests cover the prompt/tool description, second child creation, and owner-key behavior.
