# Orchestrator Goal Complete Delete Tools

## Recall

- User request: "赋予调度器标记goal完成和删除goal的能力".
- Acceptance:
  - Orchestrator-visible tools include a goal completion tool and a goal deletion tool.
  - Completing a goal changes the derived goal status through the existing `goal_run_attempt` artifact source, not through `engine_goal` cache fields.
  - Deleting a goal reuses the existing cascade/prune writer and does not create a second deletion path.
  - Live goal work is not silently overwritten: explicit completion/deletion must reject goals with live goal_run facts or live build tool ownership.
  - Prompt/tool-pool/test coverage must teach and expose the new scheduler abilities.
- Hard constraints:
  - No fallback/compatibility path.
  - No host-side scheduling gate; Orchestrator decides from visible facts and tools persist explicit facts.
  - No state-machine transition guard; status is derived from `goal_run_attempt` facts.
  - Do not create new worktrees or reset the repository.
  - Existing uncommitted changes at task start: `packages/opencorvus/test/server/project-routes.test.ts`, `packages/overlay/test/browser/agent-reply-box-primitives.test.ts`, and `packages/overlay/src-tauri/target-codex-repaired/`; avoid touching them.
- Read landed documents:
  - `specs/current/architecture/03-control.md`
  - `specs/current/architecture/16-unified-teardown.md`
  - `specs/current/architecture/99-principles.md`
  - `specs/README.md`
  - `specs/records/2026-06/README.md`
- Full-repo grep results:
  - `delete_goal` already exists in `panel/capability.ts`, `tool/panel.ts`, and `EngineService.deleteGoal`, but is excluded from mission/panel coordination and is not an Orchestrator private tool.
  - `deleteGoal` writer exists in `engine/persist.ts` and delegates to `deleteGoalRowsForTask`, which prunes dependent goal and plan-node references.
  - `goalStatusByID` and `describeGoal` derive goal status from `goal_run_attempt` artifact tips.
  - `updateGoalRun` appends to the existing goal-run artifact stream and emits goal-run/status events.
  - `add_goal` / `modify_goal` are defined in `orchestrator/tools.ts`; `modify_goal` already rejects live goal_run and live build ownership.
  - `AgentToolPool.ORCHESTRATOR_PRIVATE_TOOL_IDS` exposes `add_goal` and `modify_goal`, but not complete/delete goal tools.
- Independent agent feedback:
  - Not collected because the active tool policy permits spawning sub-agents only when the user explicitly asks for sub-agents/delegation/parallel agent work. This task did not include that authorization. Local grep and this Recall record are the substitute evidence source for this implementation.

## Plan

1. Add `completeGoal` to `engine/persist.ts`. It will:
   - require an existing goal;
   - reject live tip attempts and live build ownership at the caller layer;
   - append a completed `goal_run_attempt` fact for never-dispatched goals;
   - update a terminal non-passed tip to `completed` through `updateGoalRun`;
   - no-op explicitly when already completed and not superseded.
2. Add `complete_goal` and `delete_goal` Orchestrator tools in `orchestrator/tools.ts`.
   - Both check current task ownership.
   - Both reject live goal_run and live build ownership.
   - `delete_goal` calls the existing `deleteGoal` writer.
   - `complete_goal` calls the new writer and reports the resulting goal_run id/status.
3. Expose tools in `AgentToolPool` and orchestrator prompt.
4. Add targeted tests in `packages/opencorvus/test/orchestrator/tools.test.ts` and `packages/opencorvus/test/agent/agent.test.ts`.
5. Run focused tests plus spec link health.
