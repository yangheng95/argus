# Frontend Design Wake State Projection Fix

Date: 2026-06-20

## Problem

Task `tsk_ee2f28193001NrCw84Cv6c3sFW` repeated `frontend_design` after a
successful first run. The second orchestrator wake received a misleading
prompt:

- `Frontend Research Brief` was visible.
- `frontend_design` completion facts were absent from the task description.
- Stage progress rendered `frontend_design [PENDING]`.

This is a prompt projection and state recovery bug, not a frontend-design
agent bug and not a host scheduling problem.

## Recall

- `2026-06-14-frontend-design-mobile-reference-image.md`: `frontend_design`
  and `frontend_research` are single-shot task-scope handoff producers; later
  repair belongs to downstream agents that consume persisted evidence.
- `2026-06-15-orchestrator-workflow-alignment.md`: MiniWorkflow is advisory
  prompt state, not a hidden state machine or host gate.
- `2026-06-15-frontend-design-dispatch-diagnostics.md`: frontend-design
  dispatch diagnostics prove entry into the agent, but they do not replace
  durable completion projection.
- `2026-06-20-runtime-isolation-second-repair.md`: task runtime artifacts and
  prompt reads must derive from the task primary facts, not ambient runtime
  state.

## Call-Point Audit

Commands run before this plan:

- `rg -n "frontend_design|frontend design|Frontend Design|decision_log|renderWorkflowPrompt|renderTaskDescription|TaskDesc|tsk_ee2f28193001NrCw84Cv6c3sFW" specs packages/opencorvus/src packages/opencorvus/test -S`
- `rg --files specs packages/opencorvus/src packages/opencorvus/test | rg "(workflow|describe|orchestrator|frontend|decision|runtime|task).*\\.(md|ts|txt)$"`
- `rg -n "describeTask|renderTaskDescription|renderWorkflowPrompt|frontend_research|TaskDesc|ResearchBriefDesc" packages/opencorvus/src/engine/describe.ts packages/opencorvus/src/orchestrator/agent.ts packages/opencorvus/src/engine/workflow.ts`
- `rg -n "findLatestFrontend|frontend.*artifact|DecisionLog|decision_log|findLatest.*Brief|findTask" packages/opencorvus/src/engine/store.ts packages/opencorvus/src/engine/describe.ts packages/opencorvus/src/frontend-design packages/opencorvus/src/orchestrator/tools.ts -S`
- `rg -n "renderWorkflowPrompt\\(" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "projectTaskSteps\\(|FRONTEND_DESIGN|frontend_design.*completed|frontend-template.md" packages/opencorvus/src packages/opencorvus/test -S`

Relevant implementation facts:

| Surface                                         | Current behavior                                                                                                                                                 | Required change                                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/engine/describe.ts`    | `TaskDesc` projects deep research and frontend research, but no frontend-design handoff facts from `decision_log`.                                               | Add a typed `frontend_design` handoff projection with completion booleans, materialized report/manifest paths, present/missing keys, latest decision id, and latest updated time. Render it beside frontend research. |
| `packages/opencorvus/src/engine/workflow.ts`    | `projectTaskSteps()` can infer `frontend_design` completion from decision-log keys, but the required key list is local to workflow.                              | Move the frontend-design completion key list to the frontend-design handoff module and reuse it from workflow and describe.                                                                                           |
| `packages/opencorvus/src/orchestrator/agent.ts` | `buildSystemParts()` calls `renderWorkflowPrompt(workflow, workflowState)` without `task.id`, so task-scope steps cannot be projected from persisted task facts. | Pass `task.id` so `renderWorkflowPrompt()` calls `projectTaskSteps()` and shows completed frontend-design when decision-log facts exist.                                                                              |
| Tests                                           | Existing workflow test checks `projectTaskSteps()` directly but not the rendered prompt used by orchestrator.                                                    | Add regression tests for task description handoff rendering and workflow prompt DONE rendering with taskID.                                                                                                           |

## Decisions

1. Do not add a host-side repeated-call blocker, gate, or route bypass.
   The orchestrator LLM must decide from truthful persisted context.

2. Use `decision_log phase=frontend_design` as the canonical completion fact.
   The materialized files remain read-only projections; their paths are
   rendered as pointers, not used as an alternate source of truth.

3. Keep partial frontend-design entries visible as partial facts.
   Complete is derived from the shared completion key set; missing keys are
   rendered so an interrupted first run can be diagnosed honestly.

4. Do not invent a session pointer.
   The current decision-log schema stores decision id and timestamp, not
   producing session id. The prompt should render the decision pointer and
   updated time that actually exist.

5. Treat the frontend-research evidence wording inconsistency as secondary.
   This repair may adjust tests only if a prompt contradiction breaks focused
   coverage; it must not distract from the state projection root cause.

## Acceptance

- `describeTask()` returns frontend-design handoff facts when
  `decision_log phase=frontend_design` contains persisted handoff entries.
- `renderTaskDescription()` includes `## Frontend Design Handoff`, report and
  manifest paths, `has_public_report=true`, `has_evidence_source_manifest=true`,
  `is_complete=true`, and the latest decision timestamp.
- `renderWorkflowPrompt(workflow, state, taskID)` shows `frontend_design`
  `[DONE]` when all frontend-design completion keys exist.
- `Orchestrator.buildSystemParts()` passes `task.id` into
  `renderWorkflowPrompt()`.
- No fallback, no repeated-call blocker, no host gate.
- Focused tests and `packages/opencorvus` typecheck pass.
