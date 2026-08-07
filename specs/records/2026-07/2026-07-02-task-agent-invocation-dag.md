# Task Agent Invocation DAG

Date: 2026-07-02
Status: Planned

## Recall

| Item | Detail |
| --- | --- |
| User request | The task query API is confusing; expose an agent-call DAG that contains only agents that actually ran and their relationships. The current API can return agents that never executed. |
| Acceptance criteria | Task query surfaces return `agentInvocationDAG`; nodes are created only from durable task session-tree rows for real agent sessions; pending workflow/goal template steps never create DAG nodes; parent/child edges represent actual session parentage with non-agent infrastructure sessions collapsed; panel `query_task`, task board, and task status snapshots expose the same DAG shape. |
| Hard constraints | No fallback or compatibility path; no workflow-template-derived agent list; no double source; no broad git reset; do not touch the existing user change in `packages/opencorvus/src/provider/models-snapshot.ts`; test every code change. |
| Sources read | `AGENTS.md`, `specs/README.md`, `specs/current/architecture/01-agents.md`, `specs/current/architecture/13-agent-communication-matrix.md`, `specs/records/2026-06/2026-06-25-agent-rail-execution-ledger-source.md`, `specs/records/2026-06/2026-06-29-scheduler-owned-child-task-lineage.md`, `packages/opencorvus/src/task-api/index.ts`, `packages/opencorvus/src/workbench/board.ts`, `packages/opencorvus/src/status/task-status-snapshot.ts`, `packages/opencorvus/src/conversation/view.ts`, `packages/opencorvus/src/orchestrator/task-event.ts`, `packages/opencorvus/src/engine/model.ts`, `packages/opencorvus/src/engine/store.ts`, `packages/opencorvus/src/tool/panel.ts`, `packages/opencorvus/src/panel/capability.ts`, `packages/opencorvus/src/session/session.sql.ts`, `packages/opencorvus/src/session/index.ts`, and focused tests under `packages/opencorvus/test/status`, `test/panel`, `test/workbench`, `test/server`. |
| Whole-repository search evidence | Grep covered `getBoard/getBrief/getProjectBoard/getGlobalTaskBoard`, `agentView/projectConversationAgentView/listTaskConversationAgentSessions`, `TaskStatusDetail/taskStatusDetailFromBoard`, `query_task/includeChildren/includeInteractions`, `Session.createNext/Session.create`, `kind: "orchestrator"/"requirements"/"architect"/"build"/"explore"/"assistant"`, `parent_id/parentSessionID/goal_id`, and overlay workflow/agent rail consumers. |
| Independent agent feedback | Not obtained. The available sub-agent tool explicitly forbids spawning sub-agents unless the user asks for sub-agents, delegation, or parallel agent work; this request did not authorize that. |

## Problem

There are two different concepts in current task projections:

1. Workflow progress: `board.workflow` and `board.goalWorkflows` describe the configured workflow and goal phases. These can legitimately contain `pending` or `skipped` steps that never created an agent session.
2. Agent execution: `session` rows under the task root are the durable ledger of actual agent sessions. `session.kind`, `session.parent_id`, `session.goal_id`, metadata, and latest `session.status` event are the authority.

Programmatic task queries currently expose workflow-shaped data without a separate actual agent-call graph. Callers can misread pending workflow steps as executed agents.

## Source Contract

- Source of nodes: task session tree only, starting from `engine_task.session_id`.
- Source of identity: `session.kind`; for `assistant` sessions created by the task tool, the metadata key used by that tool supplies the concrete subagent name.
- Source of edges: `session.parent_id`; non-agent infrastructure sessions such as `root`, `executor`, and `system` are not DAG nodes, but children under them attach to the nearest actual agent ancestor when one exists.
- Source of status: latest durable `protocol_event(type="session.status")` for each session.
- Non-sources: workflow registry, workflow step status, goal step status, active-session process latches, message cards, and overlay component state.

## Call Sites

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `orchestrator/task-event.ts` | Lists task conversation agent session ledger for `agentView`. | Extend ledger row data with title/metadata and add a reusable DAG projection from the same ledger rows. |
| `engine/model.ts` | Task board/status schemas have workflow fields but no execution DAG. | Add `AgentInvocationDAG` schema and include it in `TaskBoard`. |
| `workbench/board.ts` | Compiles workflow/goal progress and board tag without session-ledger versioning. | Add `agentInvocationDAG` to board and include session-tree updates in the board tag. |
| `status/task-status-snapshot.ts` | Compresses workflow/goal steps into status detail. | Preserve workflow progress but add `agentInvocationDAG`; do not synthesize DAG nodes from workflow steps. |
| `tool/panel.ts` | `query_task` returns task result, optional children, optional pending interaction count. | Include the board's `agentInvocationDAG` in each successful row and child summary row. |
| Tests | Existing tests cover active sessions and conversation agent view, not query DAG. | Add focused tests for board DAG projection, status snapshot non-synthesis, and panel query output. |

## Plan

1. Move the task-tool subagent metadata key into a tiny shared module so DAG projection can read the concrete subagent name without duplicating a string.
2. Extend the task session ledger row with `title` and `metadata`, then add `agentInvocationDAGForTask(taskID)` beside the existing session-tree ledger source.
3. Add `AgentInvocationNode`, `AgentInvocationEdge`, and `AgentInvocationDAG` schemas to `engine/model.ts`; wire `TaskBoard.agentInvocationDAG`.
4. Add the DAG to `compileBoard` and make `boardTag` include the session-tree ledger count/update watermark.
5. Add `agentInvocationDAG` to `TaskStatusDetail` and panel `query_task` rows.
6. Add tests proving actual sessions appear with relationships, pending workflow steps do not create nodes, panel query includes the same DAG, and board ETag changes when a new agent session row is inserted.
7. Run focused tests, document-health link test for the new spec, typecheck if focused tests pass, then review the diff.

## Acceptance

- A task with root -> orchestrator -> requirements/build/explore sessions returns DAG nodes for orchestrator and actual workers only.
- A task with workflow pending steps but no matching session rows returns an empty DAG node list.
- `executor` containers and the task root are excluded as nodes; actual build children keep a relationship to the nearest actual agent ancestor when one exists.
- `assistant` sessions created by the task tool show their concrete subagent name from task-tool metadata.
- Panel `query_task` includes the DAG in successful task rows and child rows.
- Task status snapshots include the DAG but keep workflow/goal progress unchanged.
- Board snapshot tags change when a new task session-tree agent row is inserted.
- Focused tests and relevant spec link tests pass.
