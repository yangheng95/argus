# Frontend Design Dispatch Diagnostics

Date: 2026-06-15

## Problem

`frontend_design` can look silent when the orchestrator has invoked the tool but the frontend-design runner has not created its session yet. Existing process logs are insufficient for UI/SSE diagnosis, and `conversation-recovery.succeeded` only proves selected-task stream recovery, not frontend-design agent entry.

The specific ambiguity is:

- Orchestrator selected `frontend_design`.
- The UI did not show a new frontend-design agent card for a long time.
- We need to prove whether execution stopped before `FrontendDesignAgent.analyze`, during visual evidence preparation, or after the runner session was created.

## Existing Call Points

Full-repo search for `frontend_design`, `FrontendDesignAgent.analyze`, `onSessionCreated`, `workflow.step.updated`, and `task.report` showed these relevant single sources:

- `packages/opencorvus/src/orchestrator/tools.ts`: the orchestrator `frontend_design` tool validates inputs, materializes visual evidence, calls `FrontendDesignAgent.analyze`, and receives `onSessionCreated`.
- `packages/opencorvus/src/frontend-design/agent.ts`: `FrontendDesignAgent.analyze` creates the actual runner session through `runAgentSession`.
- `packages/opencorvus/src/engine/model.ts`: `workflow.step.updated` is the existing task-scoped progress event schema.
- `packages/opencorvus/src/workbench/board.ts`: task step projection already consumes `workflow.step.updated`.
- `packages/overlay/src/services/event-policy.ts`: `workflow.step.updated` is already pass-through; unknown event types are not acceptable.
- `packages/opencorvus/src/tool/task-report.ts`: `task.report` exists, but overlay tree-writer currently treats it as no-op, so it is not the primary visible progress channel.

## Decision

Add dispatch diagnostics by emitting extra `workflow.step.updated` events for `frontend_design` with status `running` and precise summary text. Do not add a new event type, do not synthesize chat messages, and do not change agent prompt behavior.

Diagnostic summaries:

- `frontend_design dispatch: input accepted`
- `frontend_design dispatch: materializing Figma reference`
- `frontend_design dispatch: capturing URL screenshot`
- `frontend_design dispatch: materializing local material`
- `frontend_design dispatch: preparing live webpage evidence`
- `frontend_design dispatch: loading agent module`
- `frontend_design dispatch: visual input ready; calling agent analyze`
- `frontend_design dispatch: agent session created <sessionID>`
- `frontend_design dispatch: agent analyze returned`

Failure paths should emit an existing `workflow.step.updated` failed state through the existing close function; the failed summary remains the terminal workflow status.

## Test Plan

Add an orchestrator tool test that mocks `FrontendDesignAgent.analyze`, invokes `frontend_design` with an attachment, and asserts persisted `workflow.step.updated` events include:

- input accepted
- calling agent analyze
- agent session created
- agent analyze returned

This proves the observable event stream distinguishes "agent never entered" from "runner session created and then stalled".
