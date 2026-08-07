# Global Task List Lean Projection Restoration

## Recall

| Item                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement               | Repair the visible `tasks: API 500 global/tasks?limit=11` failure whose validation error reports a missing `workflow_binding`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Acceptance criteria            | `GET /global/tasks?limit=11` returns a successful, schema-valid global task list even when completed Tasks own completion artifacts written before the current full Task-detail contract; Task-list rows expose the current lean list contract; direct Task detail continues to expose and strictly validate the authoritative completion decision including its immutable workflow binding.                                                                                                                                                                |
| Hard constraints               | Fix the root projection boundary rather than adding a fallback, compatibility parser, route gate, database migration, or database mutation. Preserve the strict current completion-decision schema on full Task detail. Add only positive non-User Interface contract coverage. Do not run, add, or modify User Interface automated tests. Preserve unrelated worktree changes. Commit subjects start with `dsw-33987`; push the current main branch to `myhexin`.                                                                                          |
| Sources read                   | User screenshot; repository `AGENTS.md`; `packages/opencorvus/src/task-api/index.ts`; `packages/opencorvus/src/engine/store.ts`; `packages/opencorvus/src/engine/model.ts`; `packages/opencorvus/src/engine/completion-decision.ts`; `packages/opencorvus/src/engine/workflow-binding-facts.ts`; `packages/opencorvus/src/server/routes/orchestrator.ts`; the June Task-list lean-projection record; the August Work Ledger record that observed the same schema error.                                                                                     |
| Whole-repository grep evidence | Searches covered every `workflow_binding`, `readTaskWorkflowBinding`, `findTaskCompletionDecisionForTerminalTime`, `viewTask`, `viewTaskListTask`, `taskItems`, `getProjectBoard`, `getGlobalTaskBoard`, `GlobalTaskBoard`, `ProjectTaskSummary`, and `/global/tasks` route/test call point. `taskItems()` is shared by the project and global list routes; direct Task lookup and full board hydration own `viewTask()`; `viewTaskListTask()` still exists but has no production caller; `ProjectTaskSummary` currently references the full `Task` schema. |
| Independent agent feedback     | None. The user did not request sub-agents, and current collaboration policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Cause chain

1. `GET /global/tasks` calls `EngineService.getGlobalTaskBoard()`, which maps every persisted row through the shared `taskItems()` list projector.
2. The dedicated `viewTaskListTask()` projector still exists, but a later control-plane rewrite changed `taskItems()` back to the full `viewTask()` projector and changed `ProjectTaskSummary.task` back to the full `Task` schema.
3. `viewTask()` resolves the selected Task's authoritative completion decision. Its current strict schema correctly requires `workflow_binding`.
4. A completed Task in the existing local catalog owns an older completion-decision artifact without that newly required field.
5. Listing eleven Tasks therefore parses Task-detail-only completion evidence for an unrelated historical row, throws the Zod validation error, and converts the entire list request into HTTP 500.
6. Making `workflow_binding` optional would weaken the immutable current Task-detail contract and introduce compatibility logic. The root repair is to restore the established list/detail projection boundary: list routes use the lean list projector, while detail routes retain strict parsing.

## Call-site disposition

| Owner / call site                                                     | Decision                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskItems()`                                                         | Restore `viewTaskListTask()` as the single Task-list row projector and pass the existing queue revision through its input.                                                                                |
| `GET /task` and `GET /global/tasks`                                   | Keep their shared `taskItems()` path; both regain the same lean contract.                                                                                                                                 |
| `GET /task/:taskID`, selected Task board, and workbench compilation   | Keep `viewTask()` and strict completion-decision/workflow-binding parsing.                                                                                                                                |
| `ProjectTaskSummary` and therefore `ProjectBoard` / `GlobalTaskBoard` | Reference a dedicated `TaskListTask` schema derived from current `Task` fields owned by list rows.                                                                                                        |
| Completion-decision and workflow-binding readers/writers              | Preserve unchanged; no historical compatibility parser or synthetic binding is introduced.                                                                                                                |
| OpenAPI and generated SDK                                             | Regenerate from the restored transport schema using repository commands; do not hand-edit generated outputs.                                                                                              |
| Non-UI server regression                                              | Seed a completed Task with the older valid artifact shape and assert the global route returns the exact current lean Task row plus summary. This is a positive list-output contract, not a negative test. |

## Implementation plan

1. Restore the dedicated list projection and list transport schema.
2. Add one positive server regression that exercises the real `GET /global/tasks` route over an older completed Task artifact and validates the exact current lean response.
3. Run the targeted non-UI server test, TypeScript typecheck, route/OpenAPI generation checks, and required document-health tests.
4. Reproduce the request read-only against the currently running service if it already serves the updated process; do not restart or mutate the user's live application without approval.
5. Perform a second diff/contract review, commit only task-owned paths, fetch the latest remote branch, and push to `myhexin`.

## Progress

- [x] Reconstruct the route, projection, artifact-schema, and historical-record evidence.
- [x] Commit and push this pre-implementation plan.
- [x] Restore the list/detail projection boundary and positive API regression.
- [x] Complete generated-contract, static, targeted runtime, and second-review validation.
- [x] Commit and push the implementation.

## Validation record

- The positive real-route regression `global-task-list-projection.test.ts` passes. It seeds a completed Task plus a historical completion-decision artifact without `workflow_binding`, calls `GET /global/tasks?limit=11`, parses the response through `GlobalTaskBoard`, and matches the complete current lean row and summary.
- OpenAPI and the JavaScript SDK were regenerated through `packages/sdk/js` `bun run build`; the global and project Task-list response types now publish only the list-owned Task fields.
- OpenCorvus and SDK TypeScript checks pass. Route inventory and generated API documentation checks pass.
- Required historical links, document health, and product-document single-source checks pass with 62 tests and 1,144 assertions.
- A read-only request to the already-running `http://127.0.0.1:7878/global/tasks?limit=11` reproduced the original `workflow_binding` HTTP 500, proving the live process still serves the pre-repair code. It was not restarted or mutated without user approval.
- Second review confirmed `taskItems()` is the sole shared project/global list mapper and now calls `viewTaskListTask()`; direct Task lookup, Task mutation responses, and selected board hydration retain `viewTask()` and strict current completion-decision parsing.
